"""
Regenerator — closed heat exchanger with two inlets and two outlets
(hot stream heats cold stream; streams do NOT mix).

Topology
--------
  hot_inlet  ──► [REGENERATOR] ──► hot_outlet
  cold_inlet ──►                ──► cold_outlet

Typical use
-----------
• Rankine cycle: turbine bleed steam (hot) pre-heats feed water (cold)
  before entering the boiler  →  raises cycle efficiency
• Brayton cycle: turbine exhaust (hot) pre-heats compressed air (cold)
  before the combustor        →  reduces fuel consumption

Parameters
----------
effectiveness : float, 0–1, default 0.85
    ε = Q_actual / Q_max
    Q_max = Ċ_min · (T_hot_in − T_cold_in)
pressure_drop_hot  : float Pa, default 0
pressure_drop_cold : float Pa, default 0
"""
from __future__ import annotations
import math
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.components.base import (
    BaseComponent,
    ComponentType,
    ComponentResult,
    ThermodynamicState,
    PortType,
)

logger = logging.getLogger(__name__)


class Regenerator(BaseComponent):
    """
    Closed regenerative heat exchanger: 2 inlets → 2 outlets (no mixing).

    Both streams keep their identities; the hot stream loses heat and the
    cold stream gains exactly the same amount (no external heat source/sink).
    """

    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        super().__init__(component_id, name, ComponentType.REGENERATOR, parameters)

    # ── Port layout ───────────────────────────────────────────────────────────

    def _initialize_ports(self) -> None:
        self.add_port("hot_inlet",   PortType.HOT_INLET)
        self.add_port("hot_outlet",  PortType.HOT_OUTLET)
        self.add_port("cold_inlet",  PortType.COLD_INLET)
        self.add_port("cold_outlet", PortType.COLD_OUTLET)

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_parameters(self) -> Tuple[bool, List[str]]:
        errors: List[str] = []
        eps = self.get_parameter("effectiveness", 0.85)
        if not (0 < eps <= 1):
            errors.append(f"effectiveness must be in (0, 1], got {eps}")
        for side in ("hot", "cold"):
            dp = self.get_parameter(f"pressure_drop_{side}", 0)
            if dp < 0:
                errors.append(f"pressure_drop_{side} must be ≥ 0, got {dp}")
        return len(errors) == 0, errors

    # ── Main calculation ──────────────────────────────────────────────────────

    def calculate(self) -> ComponentResult:
        try:
            ok, errs = self.validate_parameters()
            if not ok:
                return ComponentResult(success=False,
                                       error_message="; ".join(errs))

            hot_in  = self.get_inlet_state("hot_inlet")
            cold_in = self.get_inlet_state("cold_inlet")

            if hot_in is None or cold_in is None:
                return ComponentResult(success=False,
                                       error_message="Both hot_inlet and cold_inlet states are required")

            eps  = self.get_parameter("effectiveness", 0.85)
            dp_h = self.get_parameter("pressure_drop_hot",  0.0)
            dp_c = self.get_parameter("pressure_drop_cold", 0.0)

            # Mass flows (fall back to 1 kg/s each if not set)
            mdot_h = hot_in.mass_flow  or self.get_parameter("hot_mass_flow",  1.0)
            mdot_c = cold_in.mass_flow or self.get_parameter("cold_mass_flow", 1.0)

            warnings: List[str] = []

            if hot_in.temperature <= cold_in.temperature:
                warnings.append(
                    f"Hot inlet ({hot_in.temperature:.1f} K) ≤ cold inlet "
                    f"({cold_in.temperature:.1f} K) — no heat can be recovered"
                )

            # ── Maximum transferable heat ─────────────────────────────────
            h_hot_at_cold_in  = self._h_at_T(hot_in.fluid,  cold_in.temperature, hot_in.pressure)
            h_cold_at_hot_in  = self._h_at_T(cold_in.fluid, hot_in.temperature,  cold_in.pressure)

            Q_max_h = mdot_h * (hot_in.enthalpy  - h_hot_at_cold_in)
            Q_max_c = mdot_c * (h_cold_at_hot_in  - cold_in.enthalpy)

            Q_max = min(max(Q_max_h, 0.0), max(Q_max_c, 0.0))
            Q     = eps * Q_max  # actual heat transferred

            # ── Outlet states ─────────────────────────────────────────────
            h_hot_out  = hot_in.enthalpy  - Q / mdot_h
            h_cold_out = cold_in.enthalpy + Q / mdot_c

            P_hot_out  = hot_in.pressure  - dp_h
            P_cold_out = cold_in.pressure - dp_c

            try:
                hot_out = self.calculate_properties(
                    hot_in.fluid, "P", P_hot_out, "H", h_hot_out)
                hot_out.mass_flow = mdot_h
            except Exception as e:
                return ComponentResult(success=False,
                                       error_message=f"Hot outlet calc failed: {e}")

            try:
                cold_out = self.calculate_properties(
                    cold_in.fluid, "P", P_cold_out, "H", h_cold_out)
                cold_out.mass_flow = mdot_c
            except Exception as e:
                return ComponentResult(success=False,
                                       error_message=f"Cold outlet calc failed: {e}")

            if cold_out.temperature > hot_out.temperature:
                warnings.append(
                    f"Temperature crossover: cold outlet ({cold_out.temperature:.1f} K) "
                    f"> hot outlet ({hot_out.temperature:.1f} K)"
                )

            self.set_outlet_state(hot_out,  "hot_outlet")
            self.set_outlet_state(cold_out, "cold_outlet")

            # ── Second-law quantities ─────────────────────────────────────
            Sgen_h = mdot_h * (hot_out.entropy  - hot_in.entropy)
            Sgen_c = mdot_c * (cold_out.entropy - cold_in.entropy)
            Sgen   = Sgen_h + Sgen_c
            T0     = 298.15
            Ex_dest = T0 * Sgen

            # Actual effectiveness (may differ if Q_max was limited)
            eps_actual = Q / Q_max if Q_max > 1e-9 else 0.0

            lmtd = self._lmtd(hot_in, hot_out, cold_in, cold_out)

            return ComponentResult(
                success=True,
                inlet_state=hot_in,
                outlet_state=hot_out,
                work=0.0,
                heat=Q,
                efficiency=eps_actual,
                entropy_generation=Sgen,
                exergy_destruction=Ex_dest,
                warnings=warnings,
                metadata={
                    "hot_inlet":          hot_in.to_dict(),
                    "hot_outlet":         hot_out.to_dict(),
                    "cold_inlet":         cold_in.to_dict(),
                    "cold_outlet":        cold_out.to_dict(),
                    "heat_recovered_W":   Q,
                    "effectiveness":      eps_actual,
                    "Q_max_W":            Q_max,
                    "lmtd_K":             lmtd,
                    "temp_rise_cold_K":   cold_out.temperature - cold_in.temperature,
                    "temp_drop_hot_K":    hot_in.temperature   - hot_out.temperature,
                },
            )

        except Exception as exc:
            logger.error("Regenerator '%s' failed: %s", self.name, exc, exc_info=True)
            return ComponentResult(success=False,
                                   error_message=f"Regenerator calculation failed: {exc}")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _h_at_T(self, fluid: str, T: float, P: float) -> float:
        st = self.calculate_properties(fluid, "T", T, "P", P)
        return st.enthalpy

    def _lmtd(
        self,
        hi: ThermodynamicState, ho: ThermodynamicState,
        ci: ThermodynamicState, co: ThermodynamicState,
    ) -> Optional[float]:
        """Log-mean temperature difference (counter-flow)."""
        try:
            dT1 = hi.temperature - co.temperature
            dT2 = ho.temperature - ci.temperature
            if dT1 <= 0 or dT2 <= 0:
                return None
            if abs(dT1 - dT2) < 1e-6:
                return dT1
            return (dT1 - dT2) / math.log(dT1 / dT2)
        except Exception:
            return None
