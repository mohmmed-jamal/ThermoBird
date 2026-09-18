"""
ThermoBird v2 — Transient Analysis Engine
All transient simulation code lives here, isolated from the v1 steady-state core.
"""
from .ode_solver import solve_transient
from .tbs_transient import parse_transient_script

__all__ = ["solve_transient", "parse_transient_script"]
