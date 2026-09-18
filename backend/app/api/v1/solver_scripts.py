"""
Solver Scripts API — save, list, load, and delete named TBS solver results.
"""
from typing import List, Optional, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.simulation import SolverScript

router = APIRouter(prefix="/solver-scripts", tags=["Solver Scripts"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SolverScriptSave(BaseModel):
    name: str
    script: str
    result_json: Optional[Any] = None
    variable_count: Optional[int] = None
    execution_time_ms: Optional[float] = None
    success: Optional[bool] = None


class SolverScriptRow(BaseModel):
    id: int
    name: str
    script: str
    result_json: Optional[Any]
    variable_count: Optional[int]
    execution_time_ms: Optional[float]
    success: Optional[bool]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", response_model=SolverScriptRow, status_code=status.HTTP_201_CREATED)
async def save_solver_script(
    body: SolverScriptSave,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Persist a named solver script + its results to the DB."""
    row = SolverScript(
        owner_id=user.id,
        name=body.name,
        script=body.script,
        result_json=body.result_json,
        variable_count=body.variable_count,
        execution_time_ms=body.execution_time_ms,
        success=body.success,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("", response_model=List[SolverScriptRow])
async def list_solver_scripts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return all solver scripts owned by the current user, newest first."""
    result = await db.execute(
        select(SolverScript)
        .where(SolverScript.owner_id == user.id)
        .order_by(SolverScript.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{script_id}", response_model=SolverScriptRow)
async def get_solver_script(
    script_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await _get_owned(script_id, user.id, db)
    return row


@router.delete("/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_solver_script(
    script_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await _get_owned(script_id, user.id, db)
    await db.delete(row)
    await db.commit()


# ── Helper ────────────────────────────────────────────────────────────────────

async def _get_owned(script_id: int, user_id: int, db: AsyncSession) -> SolverScript:
    result = await db.execute(
        select(SolverScript).where(
            SolverScript.id == script_id,
            SolverScript.owner_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Solver script not found")
    return row
