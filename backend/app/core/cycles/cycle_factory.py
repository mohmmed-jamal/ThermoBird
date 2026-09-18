"""
cycle_factory.py — Maps cycle_type strings to solver instances.

Usage:
    from app.core.cycles import get_solver
    solver = get_solver("rankine")
    result = solver.run(inputs)
"""

from typing import Dict
from .base_cycle import BaseCycleSolver
from .rankine import RankineSolver
from .brayton import BraytonSolver
from .vapor_compression import VaporCompressionSolver
from .vapor_absorption import VaporAbsorptionSolver

# All recognised cycle_type strings → solver class
_REGISTRY: Dict[str, type] = {
    # Power cycles
    "rankine":             RankineSolver,
    "steam_rankine":       RankineSolver,   # alias
    "orc":                 RankineSolver,   # Organic Rankine → same topology, different fluid
    "brayton":             BraytonSolver,
    "gas_turbine":         BraytonSolver,   # alias
    # Refrigeration cycles
    "vapor_compression":   VaporCompressionSolver,
    "vcr":                 VaporCompressionSolver,   # alias
    "refrigeration":       VaporCompressionSolver,   # alias
    "vapor_absorption":    VaporAbsorptionSolver,
    "var":                 VaporAbsorptionSolver,    # alias
    "absorption":          VaporAbsorptionSolver,    # alias
}

SUPPORTED_CYCLES = sorted(_REGISTRY.keys())

# Cache one instance per solver class (they are stateless)
_instances: Dict[type, BaseCycleSolver] = {}


def get_solver(cycle_type: str) -> BaseCycleSolver:
    """
    Return a cached solver instance for the given cycle_type string.
    Raises ValueError for unknown cycle types.
    """
    key = cycle_type.lower().strip()
    cls = _REGISTRY.get(key)
    if cls is None:
        raise ValueError(
            f"Unknown cycle type '{cycle_type}'. "
            f"Supported: {SUPPORTED_CYCLES}"
        )
    if cls not in _instances:
        _instances[cls] = cls()
    return _instances[cls]
