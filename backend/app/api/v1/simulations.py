"""
Simulations API - Component-based thermodynamic cycle simulations.
Fully async — all DB calls use await + select().
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.simulation import Simulation, SimulationComponent, SimulationConnection
from app.schemas import (
    SimulationCreate, SimulationUpdate, SimulationResponse,
    SimulationDetailResponse, SimulationWithComponents,
    ComponentCreate, ComponentUpdate, ComponentResponse,
    ConnectionCreate, ConnectionResponse,
    RunSimulationRequest, SimulationResultsResponse,
)
from app.services.simulation_service import SimulationService

router = APIRouter(prefix="/simulations", tags=["Simulations"])


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_owned_simulation(
    simulation_id: int, user: User, db: AsyncSession
) -> Simulation:
    """Load simulation (with all relationships) and verify ownership; raise 404 if missing."""
    result = await db.execute(
        select(Simulation)
        .where(
            Simulation.id == simulation_id,
            Simulation.owner_id == user.id,
        )
        .options(
            selectinload(Simulation.components).selectinload(
                SimulationComponent.outgoing_connections
            ),
            selectinload(Simulation.components).selectinload(
                SimulationComponent.incoming_connections
            ),
            selectinload(Simulation.connections),
            selectinload(Simulation.results),
        )
    )
    sim = result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Simulation not found")
    return sim


# ── Simulation CRUD ───────────────────────────────────────────────────────────

@router.post("", response_model=SimulationResponse, status_code=status.HTTP_201_CREATED)
async def create_simulation(
    simulation: SimulationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_sim = Simulation(
        owner_id=current_user.id,
        name=simulation.name,
        description=simulation.description,
        cycle_type=simulation.cycle_type,
        is_public=simulation.is_public,
        status="draft",
    )
    db.add(db_sim)
    await db.commit()
    await db.refresh(db_sim)
    return db_sim


@router.post("/with-components", response_model=SimulationDetailResponse,
             status_code=status.HTTP_201_CREATED)
async def create_simulation_with_components(
    data: SimulationWithComponents,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_sim = Simulation(
        owner_id=current_user.id,
        name=data.name,
        description=data.description,
        cycle_type=data.cycle_type,
        is_public=data.is_public,
        status="draft",
    )
    db.add(db_sim)
    await db.flush()

    for comp in data.components:
        db.add(SimulationComponent(
            simulation_id=db_sim.id,
            component_type=comp.component_type,
            component_name=comp.component_name,
            position_x=comp.position_x,
            position_y=comp.position_y,
            parameters=comp.parameters.model_dump(),
            constraints=comp.constraints,
        ))

    await db.flush()

    for conn in data.connections:
        db.add(SimulationConnection(
            simulation_id=db_sim.id,
            from_component_id=conn.from_component_id,
            to_component_id=conn.to_component_id,
            from_port=conn.from_port,
            to_port=conn.to_port,
            fluid_name=conn.fluid_name,
            mass_flow_rate=conn.mass_flow_rate,
        ))

    await db.commit()
    await db.refresh(db_sim)
    return db_sim


@router.get("", response_model=List[SimulationResponse])
async def list_simulations(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Simulation)
        .where(Simulation.owner_id == current_user.id)
        .order_by(Simulation.created_at.desc())
        .offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.get("/{simulation_id}", response_model=SimulationDetailResponse)
async def get_simulation(
    simulation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_owned_simulation(simulation_id, current_user, db)


@router.patch("/{simulation_id}", response_model=SimulationResponse)
async def update_simulation(
    simulation_id: int,
    updates: SimulationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sim = await _get_owned_simulation(simulation_id, current_user, db)
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(sim, field, value)
    await db.commit()
    await db.refresh(sim)
    return sim


@router.delete("/{simulation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_simulation(
    simulation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sim = await _get_owned_simulation(simulation_id, current_user, db)
    await db.delete(sim)
    await db.commit()


# ── Component Management ──────────────────────────────────────────────────────

@router.post("/{simulation_id}/components", response_model=ComponentResponse,
             status_code=status.HTTP_201_CREATED)
async def add_component(
    simulation_id: int,
    component: ComponentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_simulation(simulation_id, current_user, db)
    db_comp = SimulationComponent(
        simulation_id=simulation_id,
        component_type=component.component_type,
        component_name=component.component_name,
        position_x=component.position_x,
        position_y=component.position_y,
        parameters=component.parameters.model_dump(),
        constraints=component.constraints,
    )
    db.add(db_comp)
    await db.commit()
    await db.refresh(db_comp)
    return db_comp


@router.get("/{simulation_id}/components", response_model=List[ComponentResponse])
async def list_components(
    simulation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sim = await _get_owned_simulation(simulation_id, current_user, db)
    return sim.components


@router.patch("/{simulation_id}/components/{component_id}",
              response_model=ComponentResponse)
async def update_component(
    simulation_id: int,
    component_id: int,
    updates: ComponentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_simulation(simulation_id, current_user, db)
    result = await db.execute(
        select(SimulationComponent).where(
            SimulationComponent.id == component_id,
            SimulationComponent.simulation_id == simulation_id,
        )
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")

    for field, value in updates.model_dump(exclude_unset=True).items():
        if field == "parameters" and value is not None:
            value = value.model_dump()
        setattr(comp, field, value)
    await db.commit()
    await db.refresh(comp)
    return comp


@router.delete("/{simulation_id}/components/{component_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_component(
    simulation_id: int,
    component_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_simulation(simulation_id, current_user, db)
    result = await db.execute(
        select(SimulationComponent).where(
            SimulationComponent.id == component_id,
            SimulationComponent.simulation_id == simulation_id,
        )
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")
    await db.delete(comp)
    await db.commit()


# ── Connection Management ─────────────────────────────────────────────────────

@router.post("/{simulation_id}/connections", response_model=ConnectionResponse,
             status_code=status.HTTP_201_CREATED)
async def add_connection(
    simulation_id: int,
    connection: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_simulation(simulation_id, current_user, db)

    # Verify both components belong to this simulation
    for cid in (connection.from_component_id, connection.to_component_id):
        r = await db.execute(
            select(SimulationComponent).where(
                SimulationComponent.id == cid,
                SimulationComponent.simulation_id == simulation_id,
            )
        )
        if not r.scalar_one_or_none():
            raise HTTPException(status_code=400,
                                detail=f"Component {cid} not found in simulation")

    db_conn = SimulationConnection(
        simulation_id=simulation_id,
        from_component_id=connection.from_component_id,
        to_component_id=connection.to_component_id,
        from_port=connection.from_port,
        to_port=connection.to_port,
        fluid_name=connection.fluid_name,
        mass_flow_rate=connection.mass_flow_rate,
    )
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    return db_conn


@router.get("/{simulation_id}/connections", response_model=List[ConnectionResponse])
async def list_connections(
    simulation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sim = await _get_owned_simulation(simulation_id, current_user, db)
    return sim.connections


@router.delete("/{simulation_id}/connections/{connection_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    simulation_id: int,
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_simulation(simulation_id, current_user, db)
    result = await db.execute(
        select(SimulationConnection).where(
            SimulationConnection.id == connection_id,
            SimulationConnection.simulation_id == simulation_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    await db.delete(conn)
    await db.commit()


# ── Run Simulation ────────────────────────────────────────────────────────────

@router.post("/{simulation_id}/run", response_model=SimulationResultsResponse)
async def run_simulation(
    simulation_id: int,
    run_params: RunSimulationRequest = RunSimulationRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run the thermodynamic simulation and return complete results."""
    # Ownership check — raises 404 if not found
    await _get_owned_simulation(simulation_id, current_user, db)

    service = SimulationService(db)
    return await service.run_simulation(
        simulation_id=simulation_id,
        ambient_temperature=run_params.ambient_temperature,
        ambient_pressure=run_params.ambient_pressure,
        tolerance=run_params.tolerance,
        max_iterations=run_params.max_iterations,
    )


@router.get("/{simulation_id}/results", response_model=SimulationResultsResponse)
async def get_simulation_results(
    simulation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get existing simulation results without re-running."""
    await _get_owned_simulation(simulation_id, current_user, db)

    service = SimulationService(db)
    results = await service.get_simulation_results(simulation_id)

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No results found. Run the simulation first.",
        )
    return results
