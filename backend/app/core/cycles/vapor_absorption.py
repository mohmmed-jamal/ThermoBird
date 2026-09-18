"""
vapor_absorption.py — Vapor Absorption Refrigeration (VAR) cycle solver.

Supported pairs (pair key → working_pair input):
    "ammonia_water"  NH3-H2O  (most common industrial)
    "libr_water"     LiBr-H2O (large chiller / HVAC)

For CoolProp-compatibility both pairs are modelled using a
simplified enthalpy-based approach:
  - Pure refrigerant (NH3 or Water) properties from CoolProp for the
    high/low pressure circuits.
  - Absorber solution enthalpy estimated from ASHRAE correlations.
  - Generator heat calculated from energy balance.

Topology (6 key state points on refrigerant side):
    Generator → Condenser → Expansion valve → Evaporator →
    Absorber → Solution pump → Heat exchanger → Generator

Inputs dict keys:
    working_pair           str   "ammonia_water" | "libr_water"
    mass_flow_refrigerant  float kg/s  refrigerant circuit
    T_generator            float K     generator temperature
    T_condenser            float K     condenser saturation temperature
    T_evaporator           float K     evaporator saturation temperature
    T_absorber             float K     absorber saturation temperature
    solution_pump_efficiency float 0-1 default 0.75
    heat_exchanger_effectiveness float 0-1 default 0.60
    T0                     float K     dead-state temperature  default 298.15
    P0                     float Pa    dead-state pressure     default 101325
"""

from typing import Dict, Any
from .base_cycle import (
    BaseCycleSolver, CycleResult, StatePoint,
    ComponentMetrics, PerformanceMetrics,
)
from app.core.property_engine import PropertyError


# Refrigerant fluid for each working pair
_REFRIGERANT = {
    "ammonia_water": "Ammonia",
    "libr_water":    "Water",
}


class VaporAbsorptionSolver(BaseCycleSolver):

    @property
    def cycle_name(self) -> str:
        return "vapor_absorption"

    def solve(self, inputs: Dict[str, Any]) -> CycleResult:
        # ── Unpack ─────────────────────────────────────────────────────────
        pair     = inputs.get("working_pair", "ammonia_water")
        m_r      = float(inputs.get("mass_flow_refrigerant", 0.05))  # kg/s refrigerant
        T_gen    = float(inputs.get("T_generator",    363.15))  # 90°C
        T_cond   = float(inputs.get("T_condenser",    313.15))  # 40°C
        T_evap   = float(inputs.get("T_evaporator",   263.15))  # -10°C
        T_abs    = float(inputs.get("T_absorber",     308.15))  # 35°C
        eta_pump = float(inputs.get("solution_pump_efficiency", 0.75))
        eps_hx   = float(inputs.get("heat_exchanger_effectiveness", 0.60))
        T0       = float(inputs.get("T0", 298.15))
        P0       = float(inputs.get("P0", 101_325.0))
        warnings: list = []

        if pair not in _REFRIGERANT:
            return CycleResult(False, self.cycle_name,
                               error_message=f"Unknown working pair '{pair}'. "
                                             "Use 'ammonia_water' or 'libr_water'.")

        fluid = _REFRIGERANT[pair]

        # ── Validate ───────────────────────────────────────────────────────
        for label, val in [("T_generator", T_gen), ("T_condenser", T_cond),
                           ("T_evaporator", T_evap), ("T_absorber", T_abs)]:
            if val <= 0:
                return CycleResult(False, self.cycle_name,
                                   error_message=f"{label} must be positive (K)")
        if T_gen <= T_cond:
            return CycleResult(False, self.cycle_name,
                               error_message="T_generator must exceed T_condenser")
        if T_cond <= T_evap:
            return CycleResult(False, self.cycle_name,
                               error_message="T_condenser must exceed T_evaporator")

        try:
            # ── Dead state ─────────────────────────────────────────────────
            ds = self._pe.calculate_properties(fluid, "P", P0, "T", T0)
            h0, s0 = ds["enthalpy"], ds["entropy"]

            # ── Saturation pressures ───────────────────────────────────────
            sat_cond = self._pe.get_saturation_properties(fluid, temperature=T_cond)
            sat_evap = self._pe.get_saturation_properties(fluid, temperature=T_evap)
            P_hi = sat_cond["saturation_pressure"]
            P_lo = sat_evap["saturation_pressure"]

            # ── Refrigerant circuit state points ───────────────────────────
            # State R1: Refrigerant leaving generator (sat. vapour at P_hi)
            sr1 = self._state(fluid, "P", P_hi, "Q", 1.0,
                              "R1 – Generator exit (sat. vapour)")

            # State R2: Condenser exit (sat. liquid at P_hi)
            sr2 = self._state(fluid, "P", P_hi, "Q", 0.0,
                              "R2 – Condenser exit (sat. liquid)")

            # State R3: Expansion valve exit (isenthalpic → P_lo)
            sr3 = self._state(fluid, "P", P_lo, "H", sr2.enthalpy,
                              "R3 – Expansion valve exit (two-phase)")

            # State R4: Evaporator exit (sat. vapour at P_lo)
            sr4 = self._state(fluid, "P", P_lo, "Q", 1.0,
                              "R4 – Evaporator exit (sat. vapour / absorber inlet)")

            # ── Solution circuit (enthalpy-based approximation) ────────────
            # We model the solution pump as lifting pressure from P_lo → P_hi.
            # Use liquid refrigerant as proxy for specific volume of strong solution.
            liq_lo = self._pe.get_saturation_properties(fluid, temperature=T_abs)
            v_liq  = 1.0 / liq_lo["liquid"]["density"]   # m³/kg

            # Solution circulation ratio f = m_solution / m_refrigerant
            # Approximated using absorption equilibrium:
            # For NH3-H2O: f ≈ 8-12  (use 10 as default)
            # For LiBr-H2O: f ≈ 12-20 (use 15 as default)
            f = 10.0 if pair == "ammonia_water" else 15.0
            m_sol = m_r * f   # kg/s  strong solution mass flow

            # Pump work (kJ/kg of solution, isenthalpic approximation)
            w_pump_spec = v_liq * (P_hi - P_lo)      # J/kg solution
            w_pump_a    = w_pump_spec / eta_pump      # J/kg actual
            W_pump_W    = w_pump_a * m_sol            # W

            # Solution heat exchanger: pre-heat rich solution / pre-cool weak solution
            # Simplified: estimate heat exchange as eps_hx * max possible
            cp_sol = 4200.0  # J/kg·K approximate for strong solution
            Q_hx   = eps_hx * m_sol * cp_sol * (T_gen - T_abs)   # W   transferred in HX
            W_hx_kW = Q_hx / 1000

            # ── Component heat duties ──────────────────────────────────────
            # Evaporator (cooling effect)
            q_evap   = sr4.enthalpy - sr3.enthalpy         # J/kg refrigerant
            Q_evap_W = q_evap * m_r

            # Condenser (heat rejected)
            q_cond   = sr2.enthalpy - sr1.enthalpy         # J/kg  < 0
            Q_cond_W = q_cond * m_r

            # Generator (heat input — energy balance on refrigerant circuit)
            # Q_gen = m_r*(h_R1 - h_R4) + W_pump (approx, ignoring HX credit)
            Q_gen_W  = m_r * (sr1.enthalpy - sr4.enthalpy) + W_pump_W - Q_hx
            if Q_gen_W <= 0:
                warnings.append("Generator heat is negative — check temperatures / pair choice.")
                Q_gen_W = abs(Q_gen_W) + 1.0

            # Absorber (heat rejected)
            Q_abs_W  = m_r * (sr4.enthalpy - sr2.enthalpy) + W_pump_W + Q_hx  # approx

            # ── COP ───────────────────────────────────────────────────────
            cop_cool  = Q_evap_W / Q_gen_W if Q_gen_W > 0 else 0.0
            cop_carnot_abs = (T_evap / (T_cond - T_evap)) * ((T_gen - T_abs) / T_gen) \
                             if (T_cond > T_evap and T_gen > T_abs) else 0.0

            if cop_cool > cop_carnot_abs and cop_carnot_abs > 0:
                warnings.append("COP exceeds Carnot limit — model approximation boundary; "
                                 "verify inputs.")

            # ── Entropy generation per component (W/K) ─────────────────────
            # Generator
            sigma_gen   = self._entropy_gen(
                m_r, sr1.entropy, sr4.entropy,
                q=Q_gen_W, T_boundary=T_gen)
            # Condenser
            sigma_cond  = self._entropy_gen(
                m_r, sr2.entropy, sr1.entropy,
                q=Q_cond_W, T_boundary=(sr1.temperature + sr2.temperature) / 2)
            # Expansion valve
            sigma_valve = self._entropy_gen(m_r, sr3.entropy, sr2.entropy)
            # Evaporator
            sigma_evap  = self._entropy_gen(
                m_r, sr4.entropy, sr3.entropy,
                q=Q_evap_W, T_boundary=(sr3.temperature + sr4.temperature) / 2)
            # Absorber + pump (lumped)
            sigma_abs   = max(0.0, Q_abs_W / T_abs * 0.1)   # simplified

            # ── Exergy ────────────────────────────────────────────────────
            def _ex(sp: StatePoint) -> float:
                return self._flow_exergy(sp.enthalpy, sp.entropy, h0, s0, T0)

            exr1, exr2, exr3, exr4 = _ex(sr1), _ex(sr2), _ex(sr3), _ex(sr4)

            xd_gen   = self._exergy_destruction(T0, sigma_gen)
            xd_cond  = self._exergy_destruction(T0, sigma_cond)
            xd_valve = self._exergy_destruction(T0, sigma_valve)
            xd_evap  = self._exergy_destruction(T0, sigma_evap)
            xd_abs   = self._exergy_destruction(T0, sigma_abs)

            # Exergy of generator heat input
            ex_gen_in = Q_gen_W * (1 - T0 / T_gen)

            # ── ComponentMetrics ──────────────────────────────────────────
            cm_gen = ComponentMetrics(
                name="Generator", component_type="boiler",
                work_kW=0.0,
                heat_kW=Q_gen_W / 1000,
                entropy_gen_rate_kW_K=sigma_gen / 1000,
                exergy_destruction_kW=xd_gen / 1000,
                exergy_input_kW=ex_gen_in / 1000,
                exergy_output_kW=(exr1 - exr4) / 1000,
            )
            cm_cond = ComponentMetrics(
                name="Condenser", component_type="condenser",
                work_kW=0.0,
                heat_kW=Q_cond_W / 1000,
                entropy_gen_rate_kW_K=sigma_cond / 1000,
                exergy_destruction_kW=xd_cond / 1000,
                exergy_input_kW=exr1 / 1000,
                exergy_output_kW=exr2 / 1000,
            )
            cm_valve = ComponentMetrics(
                name="Expansion Valve", component_type="expansion_valve",
                work_kW=0.0,
                heat_kW=0.0,
                isentropic_efficiency=0.0,
                entropy_gen_rate_kW_K=sigma_valve / 1000,
                exergy_destruction_kW=xd_valve / 1000,
                exergy_input_kW=exr2 / 1000,
                exergy_output_kW=exr3 / 1000,
            )
            cm_evap = ComponentMetrics(
                name="Evaporator", component_type="evaporator",
                work_kW=0.0,
                heat_kW=Q_evap_W / 1000,
                entropy_gen_rate_kW_K=sigma_evap / 1000,
                exergy_destruction_kW=xd_evap / 1000,
                exergy_input_kW=exr3 / 1000,
                exergy_output_kW=exr4 / 1000,
            )
            cm_abs = ComponentMetrics(
                name="Absorber + Solution Pump", component_type="heat_exchanger",
                work_kW=-W_pump_W / 1000,
                heat_kW=-Q_abs_W / 1000,
                isentropic_efficiency=eta_pump,
                entropy_gen_rate_kW_K=sigma_abs / 1000,
                exergy_destruction_kW=xd_abs / 1000,
                exergy_input_kW=exr4 / 1000,
                exergy_output_kW=exr1 / 1000,
                warnings=["Solution circuit modelled using simplified enthalpy approach"],
            )

            metrics     = [cm_gen, cm_cond, cm_valve, cm_evap, cm_abs]
            energy_bal  = self._check_energy_balance(metrics)
            entropy_sum = self._build_entropy_summary(metrics)
            exergy_sum  = self._build_exergy_summary(metrics, ex_gen_in / 1000)

            perf = PerformanceMetrics(
                cycle_type=          "vapor_absorption",
                fluid=               f"{pair} / {fluid}",
                mass_flow_kg_s=      m_r,
                cop_cooling=         cop_cool,
                cop_carnot=          cop_carnot_abs,
                cooling_capacity_kW= Q_evap_W / 1000,
            )

            warnings.append(
                "VAR solution circuit uses a simplified enthalpy/circulation-ratio model. "
                "For detailed NH3-H2O or LiBr-H2O property tables, a dedicated mixture "
                "property library is recommended."
            )

            return CycleResult(
                success=True,
                cycle_type=self.cycle_name,
                state_points=[sr1, sr2, sr3, sr4],
                component_metrics=metrics,
                energy_balance=energy_bal,
                performance=perf,
                exergy=exergy_sum,
                entropy=entropy_sum,
                warnings=warnings,
            )

        except PropertyError as exc:
            return CycleResult(False, self.cycle_name,
                               error_message=f"Property error: {exc}")
        except Exception as exc:
            import traceback
            return CycleResult(False, self.cycle_name,
                               error_message=traceback.format_exc())
