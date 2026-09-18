"""
rankine.py — Steam Rankine and Organic Rankine Cycle (ORC) solver.

Topology (4 state points):
    1 → Pump   → 2 → Boiler  → 3 → Turbine → 4 → Condenser → 1

Inputs dict keys:
    fluid              str    e.g. "Water", "R245fa", "Ethanol"
    mass_flow          float  kg/s
    P_boiler           float  Pa  (high pressure)
    P_condenser        float  Pa  (low pressure)
    T_superheat        float  K   turbine inlet temperature
                              (if None → saturated vapour at P_boiler)
    pump_efficiency    float  0-1  default 0.80
    turbine_efficiency float  0-1  default 0.85
    T0                 float  K   dead-state temperature  default 298.15
    P0                 float  Pa  dead-state pressure     default 101325
"""

from typing import Dict, Any, Optional
from .base_cycle import (
    BaseCycleSolver, CycleResult, StatePoint,
    ComponentMetrics, PerformanceMetrics,
)
from app.core.property_engine import PropertyError


class RankineSolver(BaseCycleSolver):

    @property
    def cycle_name(self) -> str:
        return "rankine"

    def solve(self, inputs: Dict[str, Any]) -> CycleResult:
        # ── Unpack inputs ──────────────────────────────────────────────────
        fluid   = inputs.get("fluid", "Water")
        m_dot   = float(inputs.get("mass_flow", 1.0))
        P_hi    = float(inputs.get("P_boiler",    3_500_000))
        P_lo    = float(inputs.get("P_condenser",   10_000))
        T_sup   = inputs.get("T_superheat")          # K or None
        eta_p   = float(inputs.get("pump_efficiency",    0.80))
        eta_t   = float(inputs.get("turbine_efficiency", 0.85))
        T0      = float(inputs.get("T0", 298.15))
        P0      = float(inputs.get("P0", 101325.0))
        warnings: list = []

        if T_sup is not None:
            T_sup = float(T_sup)

        # ── Validate ───────────────────────────────────────────────────────
        if P_hi <= P_lo:
            return CycleResult(False, self.cycle_name,
                               error_message="P_boiler must be greater than P_condenser")
        if not 0 < eta_p <= 1:
            return CycleResult(False, self.cycle_name, error_message="pump_efficiency must be 0–1")
        if not 0 < eta_t <= 1:
            return CycleResult(False, self.cycle_name, error_message="turbine_efficiency must be 0–1")

        try:
            # ── Dead-state properties ──────────────────────────────────────
            ds = self._pe.calculate_properties(fluid, "P", P0, "T", T0)
            h0, s0 = ds["enthalpy"], ds["entropy"]

            # ── State 1: Condenser exit — saturated liquid ─────────────────
            s1 = self._state(fluid, "P", P_lo, "Q", 0.0, "1 – Condenser exit (sat. liquid)")

            # ── State 2s: Isentropic pump outlet ──────────────────────────
            s2s = self._isentropic_outlet(fluid, P_lo, s1.temperature, P_hi,
                                          "2s – Pump outlet (isentropic)")

            # Actual pump work
            w_pump_s  = s2s.enthalpy - s1.enthalpy          # J/kg  isentropic
            w_pump_a  = w_pump_s / eta_p                     # J/kg  actual
            h2_actual = s1.enthalpy + w_pump_a
            s2 = self._state(fluid, "P", P_hi, "H", h2_actual,
                             "2 – Pump outlet (actual)")

            # ── State 3: Boiler exit ───────────────────────────────────────
            if T_sup is not None:
                s3 = self._state(fluid, "P", P_hi, "T", T_sup,
                                 "3 – Boiler exit (superheated)")
                if s3.temperature <= s2.temperature:
                    warnings.append("T_superheat is not above pump outlet temperature; "
                                    "check inputs.")
            else:
                # Saturated vapour
                s3 = self._state(fluid, "P", P_hi, "Q", 1.0,
                                 "3 – Boiler exit (sat. vapour)")

            # ── State 4s: Isentropic turbine outlet ────────────────────────
            s4s = self._isentropic_outlet(fluid, P_hi, s3.temperature, P_lo,
                                          "4s – Turbine outlet (isentropic)")

            # Actual turbine work
            w_turb_s  = s3.enthalpy - s4s.enthalpy          # J/kg  isentropic
            w_turb_a  = w_turb_s * eta_t                     # J/kg  actual
            h4_actual = s3.enthalpy - w_turb_a
            s4 = self._state(fluid, "P", P_lo, "H", h4_actual,
                             "4 – Turbine outlet (actual)")

            # Moisture warning
            if s4.quality is not None and s4.quality < 0.88:
                warnings.append(
                    f"Turbine exit quality is {s4.quality:.3f} — blade erosion risk. "
                    "Consider superheating or reheating.")

            # ── Energy analysis ────────────────────────────────────────────
            q_boiler   = s3.enthalpy - s2.enthalpy           # J/kg  > 0
            q_cond     = s4.enthalpy - s1.enthalpy           # J/kg  < 0  (heat rejected)
            w_net      = w_turb_a - w_pump_a                  # J/kg

            Q_boiler_W = q_boiler * m_dot
            Q_cond_W   = q_cond   * m_dot      # negative
            W_turb_W   = w_turb_a * m_dot
            W_pump_W   = w_pump_a * m_dot

            eta_th  = w_net / q_boiler if q_boiler > 0 else 0.0
            bwr     = w_pump_a / w_turb_a if w_turb_a > 0 else 0.0

            # Carnot: operates between T_hot (boiler exit) and T_cold (condenser sat T)
            T_cold_sat = s1.temperature
            T_hot      = s3.temperature
            eta_carnot = 1.0 - T_cold_sat / T_hot

            second_law_eff = eta_th / eta_carnot if eta_carnot > 0 else 0.0

            # ── Entropy generation per component (W/K) ─────────────────────
            # Pump (adiabatic)
            sigma_pump  = self._entropy_gen(m_dot, s2.entropy, s1.entropy)
            # Boiler  (heat in at T_hot = T3 approx; use average boiler temp)
            T_boiler_avg = (s2.temperature + s3.temperature) / 2
            sigma_boiler = self._entropy_gen(m_dot, s3.entropy, s2.entropy,
                                             q=Q_boiler_W, T_boundary=T_boiler_avg)
            # Turbine (adiabatic)
            sigma_turb  = self._entropy_gen(m_dot, s4.entropy, s3.entropy)
            # Condenser (heat out at T_cold)
            T_cond_avg   = (s4.temperature + s1.temperature) / 2
            sigma_cond   = self._entropy_gen(m_dot, s1.entropy, s4.entropy,
                                             q=Q_cond_W, T_boundary=T_cond_avg)

            # ── Exergy per component (W) ───────────────────────────────────
            def _ex(sp: StatePoint) -> float:
                return self._flow_exergy(sp.enthalpy, sp.entropy, h0, s0, T0)

            ex1, ex2, ex3, ex4 = _ex(s1), _ex(s2), _ex(s3), _ex(s4)

            xd_pump   = self._exergy_destruction(T0, sigma_pump)
            xd_boiler = self._exergy_destruction(T0, sigma_boiler)
            xd_turb   = self._exergy_destruction(T0, sigma_turb)
            xd_cond   = self._exergy_destruction(T0, sigma_cond)

            # Exergy of heat input to boiler
            # (fuel exergy proxy: Q_boiler * (1 - T0/T_source))
            T_source   = s3.temperature + 50   # assumed heat-source temp
            ex_q_in    = Q_boiler_W * (1 - T0 / T_source)

            # ── Build ComponentMetrics ────────────────────────────────────
            cm_pump = ComponentMetrics(
                name="Pump", component_type="pump",
                work_kW        = -W_pump_W / 1000,
                heat_kW        = 0.0,
                isentropic_efficiency = eta_p,
                entropy_gen_rate_kW_K = sigma_pump / 1000,
                exergy_destruction_kW = xd_pump / 1000,
                exergy_input_kW       = (ex1 + W_pump_W) / 1000,
                exergy_output_kW      = ex2 / 1000,
            )
            cm_boiler = ComponentMetrics(
                name="Boiler", component_type="boiler",
                work_kW        = 0.0,
                heat_kW        = Q_boiler_W / 1000,
                entropy_gen_rate_kW_K = sigma_boiler / 1000,
                exergy_destruction_kW = xd_boiler / 1000,
                exergy_input_kW       = ex_q_in / 1000,
                exergy_output_kW      = (ex3 - ex2) / 1000,
            )
            cm_turb = ComponentMetrics(
                name="Turbine", component_type="turbine",
                work_kW        = W_turb_W / 1000,
                heat_kW        = 0.0,
                isentropic_efficiency = eta_t,
                entropy_gen_rate_kW_K = sigma_turb / 1000,
                exergy_destruction_kW = xd_turb / 1000,
                exergy_input_kW       = ex3 / 1000,
                exergy_output_kW      = (ex4 + W_turb_W) / 1000,
                warnings       = (["Turbine exit is wet"] if s4.quality is not None
                                  and s4.quality < 0.88 else []),
            )
            cm_cond = ComponentMetrics(
                name="Condenser", component_type="condenser",
                work_kW        = 0.0,
                heat_kW        = Q_cond_W / 1000,
                entropy_gen_rate_kW_K = sigma_cond / 1000,
                exergy_destruction_kW = xd_cond / 1000,
                exergy_input_kW       = ex4 / 1000,
                exergy_output_kW      = ex1 / 1000,
            )

            metrics = [cm_pump, cm_boiler, cm_turb, cm_cond]

            energy_bal = self._check_energy_balance(metrics)
            entropy_sum = self._build_entropy_summary(metrics)
            exergy_sum  = self._build_exergy_summary(metrics, ex_q_in / 1000)

            perf = PerformanceMetrics(
                cycle_type         = "rankine",
                fluid              = fluid,
                mass_flow_kg_s     = m_dot,
                thermal_efficiency = eta_th,
                carnot_efficiency  = eta_carnot,
                second_law_efficiency = second_law_eff,
                net_power_kW       = w_net * m_dot / 1000,
                back_work_ratio    = bwr,
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
