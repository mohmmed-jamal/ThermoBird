"""
TheroBird application package initialization.
Imports all models to ensure they're registered with SQLAlchemy Base.
"""
from app.database import Base, engine
from app.models.user import User
from app.models.simulation import (
    Simulation,
    SimulationComponent,
    SimulationConnection,
    ComponentState,
    SimulationResult,
    SystemMetrics,
)

__all__ = [
    "Base",
    "engine",
    "User",
    "Simulation",
    "SimulationComponent",
    "SimulationConnection",
    "ComponentState",
    "SimulationResult",
    "SystemMetrics",
]
