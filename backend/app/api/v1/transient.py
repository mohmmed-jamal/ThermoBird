"""
ThermoBird v2 — Transient Analysis API routes.

POST   /api/v1/transient/run          Submit job, returns job_id immediately
POST   /api/v1/transient/parse        Parse TBS script → component config
GET    /api/v1/transient/{id}/status  Poll progress
GET    /api/v1/transient/{id}/result  Fetch completed result
GET    /api/v1/transient/jobs         List user's jobs
"""
from __future__ import annotations
import asyncio
from datetime import datetime, UTC
from typing import List

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.transient import TransientJob
from app.schemas.transient import (
    TransientRunRequest,
    TransientJobStatus,
    TransientResult,
    TransientMetadata,
)
from app.core.transient.ode_solver import solve_transient
from app.core.transient.tbs_transient import parse_transient_script, ast_to_solver_config

from pydantic import BaseModel

router = APIRouter(prefix="/transient", tags=["transient-v2"])


# ── Request/Response schemas for parse endpoint ───────────────────────────────

class ParseScriptRequest(BaseModel):
    source: str


class ParseScriptResponse(BaseModel):
    fluid: str
    t_end: float
    t_steps: int
    state_vars: dict[str, float]
    derivatives: dict[str, str]
    components: list[dict]
    connections: list[dict]
    errors: list[str]


# ── POST /transient/parse ─────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseScriptResponse)
async def parse_script(body: ParseScriptRequest):
    """
    Parse a TBS script and return transient component configuration.

    Supports two modes automatically:
      - Explicit transient syntax (state x = ..., dx/dt = ...)
      - Standard steady-state TBS scripts (components inferred from variables)

    The fluid is detected from WorkingFluid$ or Fluid$ assignments.
    Components are inferred from variable name patterns (P_boil, eta_turbine, etc.)
    """
    errors: list[str] = []

    try:
        ast = parse_transient_script(body.source)
    except ValueError as e:
        # Syntax error in explicit transient declarations — still attempt inference
        errors.append(str(e))
        # Fall back: minimal AST with fluid detection only
        from app.core.transient.tbs_transient import (
            TransientScriptAST, infer_components_from_script, _RE_WORKING_FLUID
        )
        ast = TransientScriptAST()
        m = _RE_WORKING_FLUID.search(body.source)
        if m:
            ast.fluid = m.group(1)

    try:
        config = ast_to_solver_config(ast)
    except Exception as e:
        errors.append(f"Component inference failed: {e}")
        config = {"components": []}

    return ParseScriptResponse(
        fluid=ast.fluid,
        t_end=ast.t_end,
        t_steps=ast.t_steps,
        state_vars=ast.state_vars,
        derivatives=ast.derivatives,
        components=config.get("components", []),
        connections=config.get("connections", []),
        errors=errors,
    )


# ── POST /transient/run ───────────────────────────────────────────────────────

@router.post("/run", response_model=TransientJobStatus, status_code=202)
async def run_transient(
    body: TransientRunRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    config = {
        "fluid":               body.fluid,
        "t_span":              [0.0, body.t_end],
        "t_eval_steps":        body.t_steps,
        "T0":                  body.T0,
        "P0":                  body.P0,
        "rtol":                body.rtol,
        "atol":                body.atol,
        "solver_method":       body.solver_method,
        "stiffness_detection": body.stiffness_detection,
        "components":          [c.model_dump() for c in body.components],
        "connections":         [c.model_dump(by_alias=True) for c in body.connections],
    }

    job = TransientJob(
        owner_id=current_user.id,
        simulation_id=body.simulation_id,
        config=config,
        status="pending",
        progress=0.0,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(_run_job, job.id, config)
    return TransientJobStatus(job_id=job.id, status="pending", progress=0.0)


# ── GET /transient/{job_id}/status ───────────────────────────────────────────

@router.get("/{job_id}/status", response_model=TransientJobStatus)
async def get_job_status(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = await _get_job_or_404(db, job_id, current_user.id)
    return TransientJobStatus(
        job_id=job.id,
        status=job.status,
        progress=job.progress or 0.0,
        error_msg=job.error_msg,
    )


# ── GET /transient/{job_id}/result ───────────────────────────────────────────

@router.get("/{job_id}/result", response_model=TransientResult)
async def get_job_result(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = await _get_job_or_404(db, job_id, current_user.id)
    if job.status != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"Job {job_id} is '{job.status}' — result not available yet.",
        )
    r = job.result or {}
    meta_raw = r.get("metadata", {})
    return TransientResult(
        job_id=job.id,
        success=r.get("success", False),
        t=r.get("t", []),
        variables=r.get("variables", {}),
        derived=r.get("derived", {}),
        metadata=TransientMetadata(**meta_raw) if meta_raw else None,
        errors=r.get("errors", []),
    )


# ── GET /transient/jobs ───────────────────────────────────────────────────────

@router.get("/jobs", response_model=List[TransientJobStatus])
async def list_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TransientJob)
        .where(TransientJob.owner_id == current_user.id)
        .order_by(TransientJob.created_at.desc())
        .limit(50)
    )
    jobs = result.scalars().all()
    return [
        TransientJobStatus(
            job_id=j.id, status=j.status,
            progress=j.progress or 0.0, error_msg=j.error_msg,
        )
        for j in jobs
    ]


# ── Background task ───────────────────────────────────────────────────────────

async def _run_job(job_id: int, config: dict) -> None:
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        job = await db.get(TransientJob, job_id)
        if job is None:
            return

        job.status     = "running"
        job.started_at = datetime.now(UTC)
        job.progress   = 0.05
        await db.commit()

        try:
            loop   = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, solve_transient, config)

            job.result    = result
            job.status    = "completed" if result.get("success") else "failed"
            job.error_msg = "; ".join(result.get("errors", [])) or None
            job.progress  = 1.0
        except Exception as exc:
            job.status    = "failed"
            job.error_msg = str(exc)
            job.progress  = 0.0

        job.finished_at = datetime.now(UTC)
        await db.commit()


# ── Helper ────────────────────────────────────────────────────────────────────

async def _get_job_or_404(db: AsyncSession, job_id: int, owner_id: int) -> TransientJob:
    result = await db.execute(
        select(TransientJob)
        .where(TransientJob.id == job_id, TransientJob.owner_id == owner_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail=f"Transient job {job_id} not found.")
    return job
