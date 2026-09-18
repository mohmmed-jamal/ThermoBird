"""
ThermoBird v2 — Transient thermo utilities
CoolProp wrappers safe to call inside a tight ODE loop.
All functions accept SI units (K, Pa, J/kg, J/kg·K).
"""
from __future__ import annotations
from functools import lru_cache
from typing import Optional
from CoolProp.CoolProp import PropsSI


def cp(T_K: float, P_Pa: float, fluid: str) -> float:
    """Isobaric specific heat [J/kg·K]."""
    return PropsSI("C", "T", T_K, "P", P_Pa, fluid)


def enthalpy(T_K: float, P_Pa: float, fluid: str) -> float:
    """Specific enthalpy [J/kg]."""
    return PropsSI("H", "T", T_K, "P", P_Pa, fluid)


def entropy(T_K: float, P_Pa: float, fluid: str) -> float:
    """Specific entropy [J/kg·K]."""
    return PropsSI("S", "T", T_K, "P", P_Pa, fluid)


def density(T_K: float, P_Pa: float, fluid: str) -> float:
    """Density [kg/m³]."""
    return PropsSI("D", "T", T_K, "P", P_Pa, fluid)


def sat_temperature(P_Pa: float, fluid: str) -> float:
    """Saturation temperature at given pressure [K]."""
    return PropsSI("T", "P", P_Pa, "Q", 0, fluid)


def sat_enthalpy_liquid(P_Pa: float, fluid: str) -> float:
    return PropsSI("H", "P", P_Pa, "Q", 0, fluid)


def sat_enthalpy_vapor(P_Pa: float, fluid: str) -> float:
    return PropsSI("H", "P", P_Pa, "Q", 1, fluid)


def flow_exergy(h: float, s: float, h0: float, s0: float, T0: float) -> float:
    """
    Specific flow exergy [J/kg].
    ex = (h - h0) - T0 * (s - s0)
    """
    return (h - h0) - T0 * (s - s0)


def dead_state(T0: float, P0: float, fluid: str) -> tuple[float, float]:
    """Return (h0, s0) at dead state — cached per unique (T0, P0, fluid)."""
    h0 = PropsSI("H", "T", T0, "P", P0, fluid)
    s0 = PropsSI("S", "T", T0, "P", P0, fluid)
    return h0, s0
