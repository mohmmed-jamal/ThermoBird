"""
vapor_compression.py — Vapor Compression Refrigeration (VCR) cycle solver.

Topology (4 state points):
    1 → Compressor → 2 → Condenser → 3 → Expansion Valve → 4 → Evaporator → 1

Inputs dict keys:
    fluid                  str    e.g. "R134a", "R410A", "R32", "Ammonia"
    mass_flow              float  kg/s
    T_evaporator           float  K    evaporator saturation temperature
    T_condenser            float  K    condenser saturation temperature
    superheat              float  K    superheat at compressor inlet  default 5
    subcooling             float  K    subcooling at condenser exit   default 5
    compressor_efficiency  float  0-1  default 0.80
    T0                     float  K    dead-state temperature  default 298.15
    P0                     float  Pa   dead-state pressure     default 101325
"""

from typing import Dict, Any
from .base_cycle import (
    BaseCycleSolver, CycleResult, StatePoint,
    ComponentMetrics, PerformanceMetrics,
)
from app.core.property_engine import PropertyError


class VaporCompressionSolver(BaseCycleSolver):

    @property
    def cycle_name(self) -> str:
        return "vapor_compression"

    def solve(self, inputs: Dict[str, Any]) -> CycleResult:
        # ── Unpack ─────────────────────────────────────────────────────────
        fluid    = inputs.get("fluid", "R134a")
        m_dot    = float(inputs.get("mass_flow", 0.1))
        T_evap   = float(inputs.get("T_evaporator", 263.15))   # -10°C
        T_cond   = float(inputs.get("T_condenser",  313.15))   # +40°C
        dT_sup   = float(inputs.get("superheat",     5.0))     # K
        dT_sub   = float(inputs.get("subcooling",    5.0))     # K
        eta_c    = float(inputs.get("compressor_efficiency", 0.80))
        T0       = float(inputs.get("T0", 298.15))
        P0       = float(inputs.get("P0", 101_325.0))
        warnings: list = []

        # ── Validate ───────────────────────────────────────────────────────
        if T_cond <= T_evap:
            return CycleResult(False, self.cycle_name,
                               error_message="T_condenser must exceed T_evaporator")
        if not 0 < eta_c <= 1:
            return CycleResult(False, self.cycle_name,
                               error_message="compressor_efficiency must be 0–1")
        if dT_sup < 0 or dT_sub < 0:
            return CycleResult(False, self.cycle_name,
                               error_message="superheat and subcooling must be ≥ 0")

        try:
            # ── Dead state ─────────────────────────────────────────────────
            ds = self._pe.calculate_properties(fluid, "P", P0, "T", T0)
            h0, s0 = ds["enthalpy"], ds["entropy"]

            # ── Saturation pressures ───────────────────────────────────────
            sat_evap = self._pe.get_saturation_properties(fluid, temperature=T_evap)
            sat_cond = self._pe.get_saturation_properties(fluid, temperature=T_cond)
            P_lo = sat_evap["saturation_pressure"]
            P_hi = sat_cond["saturation_pressure"]

            if P_hi <= P_lo:
                return CycleResult(False, self.cycle_name,
                                   error_message="Condenser pressure ≤ evaporator pressure; "
                                                 "check T_condenser vs T_evaporator.")

            # ── State 1: Compressor inlet (superheated vapour) ─────────────
            T1 = T_evap + dT_sup
            s1 = self._state(fluid, "P", P_lo, "T", T1,
                             "1 – Compressor inlet (superheated vapour)")
            if s1.phase not in ("vapor", "supercritical"):
                warnings.append("State 1 is not superheated — check T_evaporator / superheat.")

            # ── State 2s: Isentropic compressor outlet ─────────────────────
            s2s = self._isentropic_outlet(fluid, P_lo, T1, P_hi,
                                          "2s – Compressor outlet (isentropic)")

            w_comp_s  = s2s.enthalpy - s1.enthalpy
            w_comp_a  = w_comp_s / eta_c
            h2_actual = s1.enthalpy + w_comp_a
            s2 = self._state(fluid, "P", P_hi, "H", h2_actual,
                             "2 – Compressor outlet (actual)")

            # ── State 3: Condenser exit (subcooled liquid) ─────────────────
            T3 = T_cond - dT_sub
            s3 = self._state(fluid, "T", T3, "P", P_hi,
                             "3 – Condenser exit (subcooled liquid)")
            if s3.phase not in ("liquid",) and s3.quality is not None and s3.quality > 0:
                warnings.append("State 3 is not fully liquid — reduce subcooling or check pressures.")

            # ── State 4: Expansion valve outlet (isenthalpic) ─────────────
            # h4 = h3  (throttling)
            s4 = self._state(fluid, "P", P_lo, "H", s3.enthalpy,
                             "4 – Expansion valve outlet (two-phase)")

            if s4.quality is None or not (0 <= s4.quality <= 1):
                warnings.append("State 4 quality is unexpected; verify operating conditions.")

            # ── Energy ────────────────────────────────────────────────────
            q_evap    = s1.enthalpy - s4.enthalpy    # J/kg  > 0  (refrigerating effect)
            q_cond    = s3.enthalpy - s2.enthalpy    # J/kg  < 0  (heat rejected)
            w_net     = w_comp_a                     # J/kg  net work input

            Q_evap_W  = q_evap * m_dot
            Q_cond_W  = q_cond * m_dot
            W_comp_W  = w_comp_a * m_dot

            cop_cool  = q_evap / w_comp_a if w_comp_a > 0 else 0.0
            cop_heat  = abs(q_cond) / w_comp_a if w_comp_a > 0 else 0.0
            cop_carnot_cool = T_evap / (T_cond - T_evap) if T_cond > T_evap else 0.0

            # ── Entropy generation ─────────────────────────────────────────
            sigma_comp  = self._entropy_gen(m_dot, s2.entropy, s1.entropy)
            T_cond_avg  = (s2.temperature + s3.temperature) / 2
            sigma_cond  = self._entropy_gen(m_dot, s3.entropy, s2.entropy,
                                            q=Q_cond_W, T_boundary=T_cond_avg)
            sigma_valve = self._entropy_gen(m_dot, s4.entropy, s3.entropy)   # isenthalpic: always +
            T_evap_avg  = (s4.temperature + s1.temperature) / 2
            sigma_evap  = self._entropy_gen(m_dot, s1.entropy, s4.entropy,
                                            q=Q_evap_W, T_boundary=T_evap_avg)

            # ── Exergy ────────────────────────────────────────────────────
            def _ex(sp: StatePoint) -> float:
                return self._flow_exergy(sp.enthalpy, sp.entropy, h0, s0, T0)

            ex1, ex2, ex3, ex4 = _ex(s1), _ex(s2), _ex(s3), _ex(s4)

            xd_comp  = self._exergy_destruction(T0, sigma_comp)
            xd_cond  = self._exergy_destruction(T0, sigma_cond)
            xd_valve = self._exergy_destruction(T0, sigma_valve)
            xd_evap  = self._exergy_destruction(T0, sigma_evap)

            # Exergy input = compressor shaft work
            ex_input  = W_comp_W

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
            cm_cond = ComponentMetrics(
                name="Condenser", component_type="condenser",
                work_kW=0.0,
                heat_kW=Q_cond_W / 1000,
                entropy_gen_rate_kW_K=sigma_cond / 1000,
                exergy_destruction_kW=xd_cond / 1000,
                exergy_input_kW=ex2 / 1000,
                exergy_output_kW=ex3 / 1000,
            )
            cm_valve = ComponentMetrics(
                name="Expansion Valve", component_type="expansion_valve",
                work_kW=0.0,
                heat_kW=0.0,
                isentropic_efficiency=0.0,
                entropy_gen_rate_kW_K=sigma_valve / 1000,
                exergy_destruction_kW=xd_valve / 1000,
                exergy_input_kW=ex3 / 1000,
                exergy_output_kW=ex4 / 1000,
            )
            cm_evap = ComponentMetrics(
                name="Evaporator", component_type="evaporator",
                work_kW=0.0,
                heat_kW=Q_evap_W / 1000,
                entropy_gen_rate_kW_K=sigma_evap / 1000,
                exergy_destruction_kW=xd_evap / 1000,
                exergy_input_kW=ex4 / 1000,
                exergy_output_kW=ex1 / 1000,
            )

            metrics     = [cm_comp, cm_cond, cm_valve, cm_evap]
            energy_bal  = self._check_energy_balance(metrics)
            entropy_sum = self._build_entropy_summary(metrics)
            exergy_sum  = self._build_exergy_summary(metrics, ex_input / 1000)

            perf = PerformanceMetrics(
                cycle_type=          "vapor_compression",
                fluid=               fluid,
                mass_flow_kg_s=      m_dot,
                cop_cooling=         cop_cool,
                cop_heating=         cop_heat,
                cop_carnot=          cop_carnot_cool,
                cooling_capacity_kW= Q_evap_W / 1000,
                heating_capacity_kW= abs(Q_cond_W) / 1000,
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
