"""
Mixing Chamber (Open Feedwater Heater) — 2 inlets, 1 outlet.

Topology
--------
  inlet_1 ──►
              [MIXING CHAMBER] ──► outlet   (mass & energy balance)
  inlet_2 ──►

Physics
-------
  Conservation of mass:    ṁ₁ + ṁ₂ = ṁ_out
  Conservation of energy:  ṁ₁·h₁ + ṁ₂·h₂ = ṁ_out·h_out   (adiabatic)

The outlet pressure equals the lower of the two inlet pressures
(the streams must be at compatible pressures in practice; the engine
sets both inlets to the same pressure before calling this).

Typical use
-----------
• Open feedwater heater: bled steam (inlet_1) + cold feedwater (inlet_2)
  → saturated liquid (outlet)
• Steam desuperheater
• Generic adiabatic mixing of two streams of the SAME fluid

Parameters
----------
outlet_quality : float, optional
    Force the outlet to a target quality (e.g. 0 for sat. liquid).
    If omitted the outlet state is computed purely from the energy balance.
pressure_drop : float Pa, default 0
"""
from __future__ import annotations
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


class MixingChamber(BaseComponent):
    """
    Adiabatic mixing chamber: 2 inlets → 1 outlet.

    Commonly used as an open feedwater heater in regenerative Rankine cycles.
    """

    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        super().__init__(component_id, name, ComponentType.MIXING_CHAMBER, parameters)

    # ── Port layout ───────────────────────────────────────────────────────────

    def _initialize_ports(self) -> None:
        self.add_port("inlet_1", PortType.INLET)   # e.g. bleed steam
        self.add_port("inlet_2", PortType.INLET)   # e.g. cold feedwater
        self.add_port("outlet",  PortType.OUTLET)

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_parameters(self) -> Tuple[bool, List[str]]:
        errors: List[str] = []
        dp = self.get_parameter("pressure_drop", 0)
        if dp < 0:
            errors.append(f"pressure_drop must be ≥ 0, got {dp}")
        x_out = self.get_parameter("outlet_quality")
        if x_out is not None and not (0 <= x_out <= 1):
            errors.append(f"outlet_quality must be in [0, 1], got {x_out}")
        return len(errors) == 0, errors

    # ── Main calculation ──────────────────────────────────────────────────────

    def calculate(self) -> ComponentResult:
        try:
            ok, errs = self.validate_parameters()
            if not ok:
                return ComponentResult(success=False, error_message="; ".join(errs))

            in1 = self.get_inlet_state("inlet_1")
            in2 = self.get_inlet_state("inlet_2")

            if in1 is None or in2 is None:
                return ComponentResult(
                    success=False,
                    error_message="Both inlet_1 and inlet_2 states are required"
                )

            mdot1 = in1.mass_flow or self.get_parameter("mass_flow_1", 1.0)
            mdot2 = in2.mass_flow or self.get_parameter("mass_flow_2", 1.0)

            warnings: List[str] = []

            # Warn if fluids differ (mixing different fluids is not supported)
            if in1.fluid.lower() != in2.fluid.lower():
                warnings.append(
                    f"Inlet fluids differ: '{in1.fluid}' vs '{in2.fluid}'. "
                    f"Using '{in1.fluid}' for outlet."
                )

            # ── Mixing energy balance (adiabatic) ─────────────────────────
            mdot_out = mdot1 + mdot2
            h_out    = (mdot1 * in1.enthalpy + mdot2 * in2.enthalpy) / mdot_out

            # Outlet pressure — use the lower inlet pressure
            dp      = self.get_parameter("pressure_drop", 0.0)
            P_out   = min(in1.pressure, in2.pressure) - dp

            fluid = in1.fluid

            # ── Compute outlet state ──────────────────────────────────────
            x_forced = self.get_parameter("outlet_quality")
            try:
                if x_forced is not None:
                    outlet = self.calculate_properties(fluid, "P", P_out, "Q", float(x_forced))
                else:
                    outlet = self.calculate_properties(fluid, "P", P_out, "H", h_out)
                outlet.mass_flow = mdot_out
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Outlet state calculation failed: {e}"
                )

            self.set_outlet_state(outlet, "outlet")

            # ── Entropy generation: Σṁ·s_out − Σṁᵢ·sᵢ ≥ 0 ──────────────
            Sgen = (mdot_out * outlet.entropy
                    - mdot1 * in1.entropy
                    - mdot2 * in2.entropy)
            T0      = 298.15
            Ex_dest = T0 * max(Sgen, 0.0)

            # Enthalpy balance check
            h_balance_err = abs(mdot_out * outlet.enthalpy
                                - mdot1 * in1.enthalpy
                                - mdot2 * in2.enthalpy)
            if h_balance_err > 10 * mdot_out:   # >10 J/kg error
                warnings.append(
                    f"Energy balance residual {h_balance_err/mdot_out:.1f} J/kg "
                    f"— check inlet conditions"
                )

            return ComponentResult(
                success=True,
                inlet_state=in1,       # primary inlet for display
                outlet_state=outlet,
                work=0.0,
                heat=0.0,              # adiabatic
                efficiency=None,
                entropy_generation=max(Sgen, 0.0),
                exergy_destruction=Ex_dest,
                warnings=warnings,
                metadata={
                    "inlet_1":          in1.to_dict(),
                    "inlet_2":          in2.to_dict(),
                    "outlet":           outlet.to_dict(),
                    "mass_flow_in1":    mdot1,
                    "mass_flow_in2":    mdot2,
                    "mass_flow_out":    mdot_out,
                    "h_outlet_J_kg":    h_out,
                    "T_outlet_K":       outlet.temperature,
                    "x_outlet":         outlet.quality,
                    "bleed_fraction":   mdot1 / mdot_out,
                },
            )

        except Exception as exc:
            logger.error("MixingChamber '%s' failed: %s", self.name, exc, exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Mixing chamber calculation failed: {exc}"
            )
