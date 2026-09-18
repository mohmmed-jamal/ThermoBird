"""
ThermoBird v2 — Transient Pydantic schemas.
Request/response types for the /api/v1/transient/* endpoints.
"""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Request ───────────────────────────────────────────────────────────────────

class ComponentConfig(BaseModel):
    id: Optional[str] = Field(None, description="Component identifier from canvas/solver graph")
    type: str = Field(..., description="Component type: boiler | turbine | condenser | pump")
    params: dict[str, Any] = Field(default_factory=dict)
    initial_conditions: dict[str, float] = Field(default_factory=dict)


class ConnectionConfig(BaseModel):
    from_id: str = Field(..., alias="from")
    to_id: str = Field(..., alias="to")
    from_port: str = "outlet"
    to_port: str = "inlet"


class TransientRunRequest(BaseModel):
    """POST /transient/run"""
    fluid:          str   = Field("Water",  description="CoolProp fluid name")
    t_end:          float = Field(600.0,    description="Simulation end time [s]")
    t_steps:        int   = Field(500,      description="Number of output time points")
    components:     list[ComponentConfig] = Field(..., min_length=1)
    connections:    list[ConnectionConfig] = Field(default_factory=list)
    simulation_id:  Optional[int] = Field(None, description="Optional parent simulation ID")
    T0:             float = Field(298.15,   description="Dead-state temperature [K]")
    P0:             float = Field(101_325.0,description="Dead-state pressure [Pa]")
    rtol:           float = Field(1e-4)
    atol:           float = Field(1e-6)
    
    # Solver method selection (v2 feature)
    solver_method:  str   = Field("Auto",   description="ODE solver method: RK45 | Radau | BDF | LSODA | Auto")
    stiffness_detection: bool = Field(True, description="Auto-detect stiffness and switch methods")

    # TBS script mode (alternative to components list)
    tbs_script:     Optional[str] = Field(None, description="TBS transient script source")


class TransientScriptRequest(BaseModel):
    """POST /transient/run-script — run from TBS source directly"""
    script:         str
    simulation_id:  Optional[int] = None
    canvas_components: Optional[list[dict]] = None


# ── Response ──────────────────────────────────────────────────────────────────

class TransientJobStatus(BaseModel):
    """GET /transient/{job_id}/status"""
    job_id:    int
    status:    str          # pending | running | completed | failed
    progress:  float        # 0.0 → 1.0
    error_msg: Optional[str] = None


class TransientMetadata(BaseModel):
    fluid:          str
    t_span:         list[float]
    n_steps:        int
    solver_nfev:    int
    execution_ms:   int
    solver_message: str
    solver_method:  Optional[str] = None
    stiff:          Optional[Any] = None


class TransientResult(BaseModel):
    """GET /transient/{job_id}/result"""
    job_id:    int
    success:   bool
    t:         list[float]
    variables: dict[str, list[float]]   # state var name → time series
    derived:   dict[str, list[float]]   # derived qty name → time series
    metadata:  Optional[TransientMetadata] = None
    errors:    list[str] = Field(default_factory=list)


class SolverMethodInfo(BaseModel):
    """GET /transient/solvers — Available ODE solver methods"""
    id: str
    name: str
    description: str
    good_for: str
    stiffness: str
    educational_only: bool
