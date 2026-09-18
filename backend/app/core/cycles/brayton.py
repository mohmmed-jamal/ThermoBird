"""
brayton.py — Brayton (gas turbine) cycle solver.

Topology (4 state points):
    1 → Compressor → 2 → Combustor/Heat-adder → 3 → Turbine → 4 → Heat-rejector → 1

Inputs dict keys:
    fluid                  str    default "Air"
    mass_flow              float  kg/s
    P_low                  float  Pa   compressor inlet pressure  default 101325
    T_inlet                float  K    compressor inlet temperature  default 288.15
    pressure_ratio         float  P_high / P_low  default 10.0
    T_turbine_inlet        float  K    max cycle temperature
    compressor_efficiency  float  0-1  default 0.85
    turbine_efficiency     float  0-1  default 0.87
    T0                     float  K    dead-state temperature  default 298.15
    P0                     float  Pa   dead-state pressure     default 101325
"""

from typing import Dict, Any
from .base_cycle import (
    BaseCycleSolver, CycleResult, StatePoint,
    ComponentMetrics, PerformanceMetrics,
)
from app.core.property_engine import PropertyError


class BraytonSolver(BaseCycleSolver):

    @property
    def cycle_name(self) -> str:
        return "brayton"

    def solve(self, inputs: Dict[str, Any]) -> CycleResult:
        # ── Unpack ─────────────────────────────────────────────────────────
        fluid    = inputs.get("fluid", "Air")
        m_dot    = float(inputs.get("mass_flow", 1.0))
        P_lo     = float(inputs.get("P_low",           101_325))
        T_in     = float(inputs.get("T_inlet",          288.15))
        r_p      = float(inputs.get("pressure_ratio",    10.0))
        T_ti     = float(inputs.get("T_turbine_inlet", 1400.0))
        eta_c    = float(inputs.get("compressor_efficiency", 0.85))
        eta_t    = float(inputs.get("turbine_efficiency",    0.87))
        T0       = float(inputs.get("T0", 298.15))
        P0       = float(inputs.get("P0", 101_325.0))
        warnings: list = []

        P_hi = P_lo * r_p

        # ── Validate ───────────────────────────────────────────────────────
        if r_p <= 1:
            return CycleResult(False, self.cycle_name,
                               error_message="pressure_ratio must be > 1")
        if T_ti <= T_in:
            return CycleResult(False, self.cycle_name,
                               error_message="T_turbine_inlet must exceed T_inlet")
        if not (0 < eta_c <= 1 and 0 < eta_t <= 1):
            return CycleResult(False, self.cycle_name,
                               error_message="Efficiencies must be 0–1")

        try:
            # ── Dead state ─────────────────────────────────────────────────
            ds = self._pe.calculate_properties(fluid, "P", P0, "T", T0)
            h0, s0 = ds["enthalpy"], ds["entropy"]

            # ── State 1: Compressor inlet ──────────────────────────────────
            s1 = self._state(fluid, "P", P_lo, "T", T_in,
                             "1 – Compressor inlet")

            # ── State 2s: Isentropic compressor outlet ─────────────────────
            s2s = self._isentropic_outlet(fluid, P_lo, T_in, P_hi,
                                          "2s – Compressor outlet (isentropic)")

            w_comp_s  = s2s.enthalpy - s1.enthalpy     # J/kg
            w_comp_a  = w_comp_s / eta_c               # J/kg actual
            h2_actual = s1.enthalpy + w_comp_a
            s2 = self._state(fluid, "P", P_hi, "H", h2_actual,
                             "2 – Compressor outlet (actual)")

            if s2.temperature > T_ti:
                warnings.append("Compressor outlet temperature exceeds turbine inlet — "
                                 "check pressure ratio and efficiency.")

            # ── State 3: Turbine inlet (after combustor) ───────────────────
            s3 = self._state(fluid, "P", P_hi, "T", T_ti,
                             "3 – Turbine inlet (combustor exit)")

            # ── State 4s: Isentropic turbine outlet ────────────────────────
            s4s = self._isentropic_outlet(fluid, P_hi, T_ti, P_lo,
                                          "4s – Turbine outlet (isentropic)")

            w_turb_s  = s3.enthalpy - s4s.enthalpy     # J/kg
            w_turb_a  = w_turb_s * eta_t               # J/kg actual
            h4_actual = s3.enthalpy - w_turb_a
            s4 = self._state(fluid, "P", P_lo, "H", h4_actual,
                             "4 – Turbine outlet / heat-rejector inlet (actual)")

            # ── Energy ────────────────────────────────────────────────────
            q_comb    = s3.enthalpy - s2.enthalpy      # J/kg  heat added
            q_rej     = s4.enthalpy - s1.enthalpy      # J/kg  < 0 heat rejected
            w_net     = w_turb_a - w_comp_a            # J/kg

            Q_comb_W  = q_comb * m_dot
            Q_rej_W   = q_rej  * m_dot
            W_comp_W  = w_comp_a * m_dot
            W_turb_W  = w_turb_a * m_dot

            if w_net <= 0:
                warnings.append("Net work is zero or negative — cycle is not producing power. "
                                 "Consider increasing pressure ratio or turbine inlet temperature.")

            eta_th     = w_net / q_comb if q_comb > 0 else 0.0
            bwr        = w_comp_a / w_turb_a if w_turb_a > 0 else 0.0
            eta_carnot = 1.0 - T_in / T_ti
            sl_eff     = eta_th / eta_carnot if eta_carnot > 0 else 0.0

            # ── Entropy generation ─────────────────────────────────────────
            sigma_comp = self._entropy_gen(m_dot, s2.entropy, s1.entropy)
            sigma_comb = self._entropy_gen(m_dot, s3.entropy, s2.entropy,
                                           q=Q_comb_W, T_boundary=T_ti)
            sigma_turb = self._entropy_gen(m_dot, s4.entropy, s3.entropy)
            T_rej_avg  = (s4.temperature + s1.temperature) / 2
            sigma_rej  = self._entropy_gen(m_dot, s1.entropy, s4.entropy,
                                           q=Q_rej_W, T_boundary=T_rej_avg)

            # ── Exergy ────────────────────────────────────────────────────
            def _ex(sp: StatePoint) -> float:
                return self._flow_exergy(sp.enthalpy, sp.entropy, h0, s0, T0)

            ex1, ex2, ex3, ex4 = _ex(s1), _ex(s2), _ex(s3), _ex(s4)

            xd_comp = self._exergy_destruction(T0, sigma_comp)
            xd_comb = self._exergy_destruction(T0, sigma_comb)
            xd_turb = self._exergy_destruction(T0, sigma_turb)
            xd_rej  = self._exergy_destruction(T0, sigma_rej)

            T_source  = T_ti + 100
            ex_q_in   = Q_comb_W * (1 - T0 / T_source)

            # ── ComponentMetrics ──────────────────────────────────────────
            cm_comp = ComponentMetrics(
                name="Compressor", component_type="compressor",
                work_kW=-W_comp_W / 1000,
                heat_kW=0.0,
                isentropic_efficiency=eta_c,
                entropy_gen_rate_kW_K=sigma_comp / 1000,
                exergy_destruction_kW=xd_comp / 1000,
                exergy_input_kW=(ex1 + W_comp_W) / 1000,
                exergy_output_kW=ex2 / 1000,
            )
            cm_comb = ComponentMetrics(
                name="Combustor", component_type="boiler",
                work_kW=0.0,
                heat_kW=Q_comb_W / 1000,
                entropy_gen_rate_kW_K=sigma_comb / 1000,
                exergy_destruction_kW=xd_comb / 1000,
                exergy_input_kW=ex_q_in / 1000,
                exergy_output_kW=(ex3 - ex2) / 1000,
            )
            cm_turb = ComponentMetrics(
                name="Turbine", component_type="turbine",
                work_kW=W_turb_W / 1000,
                heat_kW=0.0,
                isentropic_efficiency=eta_t,
                entropy_gen_rate_kW_K=sigma_turb / 1000,
                exergy_destruction_kW=xd_turb / 1000,
                exergy_input_kW=ex3 / 1000,
                exergy_output_kW=(ex4 + W_turb_W) / 1000,
            )
            cm_rej = ComponentMetrics(
                name="Heat Rejector", component_type="condenser",
                work_kW=0.0,
                heat_kW=Q_rej_W / 1000,
                entropy_gen_rate_kW_K=sigma_rej / 1000,
                exergy_destruction_kW=xd_rej / 1000,
                exergy_input_kW=ex4 / 1000,
                exergy_output_kW=ex1 / 1000,
            )

            metrics     = [cm_comp, cm_comb, cm_turb, cm_rej]
            energy_bal  = self._check_energy_balance(metrics)
            entropy_sum = self._build_entropy_summary(metrics)
            exergy_sum  = self._build_exergy_summary(metrics, ex_q_in / 1000)

            perf = PerformanceMetrics(
                cycle_type=           "brayton",
                fluid=                fluid,
                mass_flow_kg_s=       m_dot,
                thermal_efficiency=   eta_th,
                carnot_efficiency=    eta_carnot,
                second_law_efficiency=sl_eff,
                net_power_kW=         w_net * m_dot / 1000,
                back_work_ratio=      bwr,
            )

            return CycleResult(
                success=True,
                cycle_type=self.cycle_name,
                state_points=[s1, s2, s3, s4],
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
