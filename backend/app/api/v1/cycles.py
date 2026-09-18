"""
TheroBird v3 — Cycles API Router

NOTE: The /cycles/solve endpoint runs the solver but deliberately skips
DB persistence because the current DB models (owner_id int, SimulationResult
with metrics JSONB) don't match the legacy field names this route was written
against.  All canvas-driven simulations should use /simulations/{id}/run
which goes through SimulationService and the correct models.

The /cycles/history, /cycles/{id}, and /cycles/canvas/* endpoints are also
legacy and are retained only for backward-compatibility with the old frontend;
they are not actively used by the current UI.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.schemas import CycleRequest, CycleResponse
from app.core.cycle_engine import run_full_analysis
from app.dependencies import get_current_user

router = APIRouter(prefix="/cycles", tags=["Cycles (legacy)"])


@router.post("/solve", response_model=None, status_code=200)
async def solve_cycle(
    body: CycleRequest,
    user=Depends(get_current_user),
):
    """
    Stateless cycle solver — runs the engine and returns results without
    persisting anything to the database.  Use /simulations/{id}/run for
    the full canvas-based workflow with DB persistence.
    """
    inputs = body.model_dump(exclude={"name", "save_canvas", "canvas_json"})
    try:
        results, duration_ms = run_full_analysis(inputs)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Solver error: {e}")

    if not results.get("success"):
        raise HTTPException(
            status_code=422,
            detail=results.get("error_message", "Solver returned failure"),
        )

    return {
        "simulation_id":   "stateless",
        "cycle_type":      body.cycle_type,
        "working_fluid":   body.working_fluid if hasattr(body, "working_fluid") else inputs.get("fluid", "Water"),
        "run_duration_ms": duration_ms,
        **results,
    }
