"""
ThermoBird Unified Simulation API
Handles steady-state, transient, and parametric analysis
"""

from __future__ import annotations
import asyncio
import json
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.dependencies import get_db, get_current_user
from app.models.user import User
from app.core.simulation import SimulationEngine, SimulationConfig, SimulationMode
from app.core.simulation.types import SimulationResult as SimResultType

router = APIRouter(prefix="/simulation", tags=["simulation-v3"])


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Models
# ═══════════════════════════════════════════════════════════════════════════════

class ComponentConfig(BaseModel):
    """Canvas component configuration"""
    id: str
    type: str
    name: str = ""
    position: dict = Field(default_factory=dict)
    parameters: dict = Field(default_factory=dict)


class ConnectionConfig(BaseModel):
    """Canvas connection configuration"""
    from_id: str = Field(..., alias="from")
    to_id: str = Field(..., alias="to")
    from_port: str = "outlet"
    to_port: str = "inlet"
    fluid: str = "Water"


class SimulationRequest(BaseModel):
    """Unified simulation request"""
    mode: str = Field(..., description="steady_state | transient | parametric")
    
    # Canvas configuration
    components: List[ComponentConfig]
    connections: List[ConnectionConfig]
    
    # Working fluid
    fluid: str = "Water"
    
    # Dead state
    T0: float = 298.15
    P0: float = 101325.0
    
    # Transient settings
    t_end: float = 600.0
    t_steps: int = 500
    solver_method: str = "Auto"
    stiffness_detection: bool = True
    rtol: float = 1e-4
    atol: float = 1e-6
    
    # Steady-state settings
    max_iterations: int = 100
    tolerance: float = 1e-6


class SimulationResponse(BaseModel):
    """Simulation response"""
    success: bool
    mode: str
    cycle_type: str
    
    # Results
    time: Optional[List[float]] = None
    state_points: List[dict] = []
    component_results: dict = {}
    
    # Global metrics
    W_net: Optional[float] = None
    Q_in: Optional[float] = None
    eta_thermal: Optional[float] = None
    
    # Metadata
    execution_time_ms: int = 0
    errors: List[str] = []


class SolverMethodInfo(BaseModel):
    """Available solver method"""
    id: str
    name: str
    description: str
    good_for: str
    stiffness: str


# ═══════════════════════════════════════════════════════════════════════════════
# API Routes
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/run", response_model=SimulationResponse)
async def run_simulation(
    request: SimulationRequest,
    _current_user: User = Depends(get_current_user)
):
    """
    Run unified simulation (steady-state or transient)
    """
    # Build configuration
    config = SimulationConfig(
        mode=SimulationMode(request.mode),
        components=[c.model_dump(by_alias=True) for c in request.components],
        connections=[c.model_dump(by_alias=True) for c in request.connections],
        fluid=request.fluid,
        T0=request.T0,
        P0=request.P0,
        t_end=request.t_end,
        t_steps=request.t_steps,
        solver_method=request.solver_method,
        stiffness_detection=request.stiffness_detection,
        rtol=request.rtol,
        atol=request.atol,
        max_iterations=request.max_iterations,
        tolerance=request.tolerance
    )
    
    # Run simulation
    engine = SimulationEngine()
    result = engine.run(config)
    
    # Convert to response
    response = SimulationResponse(
        success=result.success,
        mode=result.mode.value,
        cycle_type=result.cycle_type,
        state_points=result.state_points,
        component_results=result.component_results,
        execution_time_ms=result.execution_time_ms,
        errors=result.errors
    )
    
    # Add time series for transient
    if result.mode == SimulationMode.TRANSIENT:
        response.time = result.time
        
        # Extract global metrics from final time point
        if result.time_points:
            final = result.time_points[-1]
            response.W_net = final.W_net
            response.Q_in = final.Q_in
            response.eta_thermal = final.eta_thermal
    
    elif result.mode == SimulationMode.STEADY_STATE and result.steady_state:
        response.W_net = result.steady_state.W_net
        response.Q_in = result.steady_state.Q_in
        response.eta_thermal = result.steady_state.eta_thermal
    
    return response


@router.post("/run-stream")
async def run_simulation_stream(
    request: SimulationRequest,
    _current_user: User = Depends(get_current_user)
):
    """
    Run transient simulation with SSE streaming for real-time updates
    """
    if request.mode != "transient":
        raise HTTPException(status_code=400, detail="Streaming only available for transient mode")
    
    async def event_generator():
        config = SimulationConfig(
            mode=SimulationMode.TRANSIENT,
            components=[c.model_dump(by_alias=True) for c in request.components],
            connections=[c.model_dump(by_alias=True) for c in request.connections],
            fluid=request.fluid,
            T0=request.T0,
            P0=request.P0,
            t_end=request.t_end,
            t_steps=request.t_steps,
            solver_method=request.solver_method
        )
        
        engine = SimulationEngine()
        
        # Send initial status
        yield f"data: {json.dumps({'status': 'initializing', 'progress': 0})}\n\n"
        await asyncio.sleep(0.1)
        
        # Run simulation (simplified streaming)
        # In production, would yield progress updates during the ODE solve process
        result = engine.run(config)
        
        if result.success:
            # Send final result
            data_dict = {
                'status': 'completed',
                'progress': 1.0,
                'result': {
                    'cycle_type': result.cycle_type,
                    'time': result.time,
                    'state_points': result.state_points
                }
            }
            yield f"data: {json.dumps(data_dict)}\n\n"
        else:
            data_dict = {
                'status': 'failed',
                'error': result.errors[0] if result.errors else 'Unknown error'
            }
            yield f"data: {json.dumps(data_dict)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/solvers", response_model=List[SolverMethodInfo])
async def list_solvers(
    _current_user: User = Depends(get_current_user)
):
    """List available ODE solver methods"""
    return [
        SolverMethodInfo(
            id="Auto",
            name="Auto-select",
            description="Automatically selects best method based on system stiffness",
            good_for="General purpose, recommended",
            stiffness="Auto-detect"
        ),
        SolverMethodInfo(
            id="RK45",
            name="Runge-Kutta 4(5)",
            description="Explicit method for non-stiff systems",
            good_for="Quick estimates, educational",
            stiffness="Non-stiff"
        ),
        SolverMethodInfo(
            id="Radau",
            name="Radau IIA",
            description="Implicit method for stiff systems",
            good_for="Power cycles, thermal transients",
            stiffness="Stiff"
        ),
        SolverMethodInfo(
            id="BDF",
            name="Backward Differentiation",
            description="Variable-order implicit method",
            good_for="Very stiff systems",
            stiffness="Very stiff"
        ),
        SolverMethodInfo(
            id="LSODA",
            name="LSODA",
            description="Auto-switching Adams/BDF method",
            good_for="Unknown stiffness",
            stiffness="Auto-detect"
        )
    ]


@router.get("/component-types")
async def list_component_types(
    _current_user: User = Depends(get_current_user)
):
    """List available component types with their transient models"""
    from app.core.simulation.components.registry import COMPONENT_REGISTRY
    
    return [
        {
            "type": name,
            "icon": model["icon"],
            "category": model["category"],
            "description": model["description"],
            "has_transient": model["odes"] is not None,
            "state_vars": model["state_vars"]
        }
        for name, model in COMPONENT_REGISTRY.items()
    ]
