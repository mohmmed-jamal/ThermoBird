"""
ThermoBird v2 — Transient component models.

Thermodynamically correct energy balances for each component.
Each model:
  - state_vars: list of ODE state variable names owned by this component
  - dydt(t, y, params, fluid): returns time derivatives for each state var
  - compute_outputs(t, y, params, fluid): returns thermodynamic outputs for coupling

Physics conventions (all SI):
  - Temperatures in K
  - Pressures in Pa
  - Enthalpies/energies in J or J/kg
  - Mass flows in kg/s
  - UA values internally in W/K (frontend sends kW/K → converted here)
  - Masses in kg, cp in J/kg·K
"""
from __future__ import annotations
from typing import Any
from . import thermo_utils as tu


def _kw_to_w(val: float) -> float:
    """kW/K → W/K"""
    return val * 1000.0


# ─────────────────────────────────────────────────────────────────────────────
# BOILER — two thermal nodes: wall + fluid
#
# Wall energy balance:
#   m_w · cp_w · dT_w/dt = Q_source − UA_wf·(T_w − T_f)
#
# Fluid energy balance (open system, SFEE):
#   m_f · cp_f · dT_f/dt = UA_wf·(T_w − T_f) − ṁ·(h_out − h_in)
#
# Q_source = Q_dot (fixed power input, kW→W)
# h_in ≈ h(T_f, P) — feed water entering at current fluid temp
# h_out = h(T_f, P) — steam leaving at current fluid temp
# When T_f < T_in, h_out - h_in is small and dTf is dominated by wall heat.
# ─────────────────────────────────────────────────────────────────────────────
class BoilerModel:
    state_vars = ["T_fluid_boiler", "T_wall_boiler"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        T_f = max(y[0], 280.0)
        T_w = max(y[1], 280.0)

        # --- Parameters (accept both naming conventions) ---
        m_wall   = float(params.get("mass_wall",   params.get("wall_mass",   2000.0)))  # kg
        cp_wall  = float(params.get("cp_wall",     params.get("wall_cp",      500.0)))  # J/kg·K (steel)
        m_fluid  = float(params.get("mass_fluid",  params.get("fluid_mass",   500.0)))  # kg
        P        = float(params.get("P_Pa",        3_000_000.0))                        # Pa
        m_dot    = float(params.get("mass_flow",   2.5))                                # kg/s
        T_feed   = float(params.get("T_feed",      320.0))                              # K — feedwater in

        # UA wall↔fluid (kW/K → W/K)
        UA_wf    = _kw_to_w(float(params.get("UA_kW_K", 50.0)))

        # Heat input to wall (kW → W)
        Q_dot    = float(params.get("Q_dot_kW", 5000.0)) * 1000.0  # W

        try:
            cp_f  = tu.cp(T_f, P, fluid)
            h_out = tu.enthalpy(T_f, P, fluid)
            h_in  = tu.enthalpy(max(T_feed, 280.0), P, fluid)
        except Exception:
            return [0.0, 0.0]

        # Wall: receives Q_dot, loses heat to fluid
        dT_w = (Q_dot - UA_wf * (T_w - T_f)) / max(m_wall * cp_wall, 1.0)

        # Fluid: gains heat from wall, loses enthalpy via mass flow
        Q_to_fluid = UA_wf * (T_w - T_f)
        dT_f = (Q_to_fluid - m_dot * (h_out - h_in)) / max(m_fluid * cp_f, 1.0)

        return [dT_f, dT_w]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        from CoolProp.CoolProp import PropsSI
        
        T_f = max(y[0], 280.0)
        P = float(params.get("P_Pa", 3_000_000.0))
        
        try:
            h = PropsSI("H", "T", T_f, "P", P, fluid)
            s = PropsSI("S", "T", T_f, "P", P, fluid)
        except Exception:
            h, s = 0.0, 0.0
        
        return {
            "T_fluid": T_f,
            "T_out": T_f,
            "h_out": h,
            "s_out": s,
            "P_out": P,
        }


# ─────────────────────────────────────────────────────────────────────────────
# TURBINE — quasi-steady thermodynamics, dynamic shaft speed
#
# The turbine is treated quasi-steady for thermodynamics (h_in from boiler
# state, h_out from isentropic + efficiency). The only dynamic state is
# shaft rotational speed ω (rad/s) capturing mechanical inertia.
#
#   I · dω/dt = τ_turbine − τ_load
#
# where τ_turbine = Ẇ_actual / ω and τ_load = Ẇ_load / ω
#
# For a Rankine cycle at grid-connected steady state, ω ≈ constant (314 rad/s
# for 50 Hz, 2-pole). The ODE captures startup and load-rejection transients.
# ─────────────────────────────────────────────────────────────────────────────
class TurbineModel:
    state_vars = ["omega_turbine"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        omega  = max(y[0], 1.0)   # rad/s — never let omega go to zero

        I        = float(params.get("rotor_inertia",    500.0))   # kg·m²
        eta_t    = float(params.get("eta_isentropic",   0.85))
        P_in     = float(params.get("P_in_Pa",          params.get("P_in",  3_000_000.0)))
        P_out    = float(params.get("P_out_Pa",         params.get("P_out",    10_000.0)))
        m_dot    = float(params.get("mass_flow",         2.5))
        T_in     = float(params.get("T_in_K",           450.0))   # K — updated each step if coupled
        W_load   = float(params.get("electrical_load_W", 1_000_000.0))  # W

        try:
            from CoolProp.CoolProp import PropsSI
            h_in  = PropsSI("H", "T", max(T_in, 280.0), "P", P_in, fluid)
            s_in  = PropsSI("S", "T", max(T_in, 280.0), "P", P_in, fluid)
            h_out_s = PropsSI("H", "P", P_out, "S", s_in, fluid)
            h_out   = h_in - eta_t * (h_in - h_out_s)
            W_actual = m_dot * (h_in - h_out)   # W
        except Exception:
            W_actual = W_load  # No net acceleration if CoolProp fails

        tau_turb = W_actual / omega
        tau_load = W_load   / omega
        domega   = (tau_turb - tau_load) / I
        return [domega]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        from CoolProp.CoolProp import PropsSI
        
        eta_t    = float(params.get("eta_isentropic",   0.85))
        P_in     = float(params.get("P_in_Pa",          params.get("P_in",  3_000_000.0)))
        P_out    = float(params.get("P_out_Pa",         params.get("P_out",    10_000.0)))
        m_dot    = float(params.get("mass_flow",         2.5))
        T_in     = float(params.get("T_in_K",           450.0))
        
        try:
            h_in  = PropsSI("H", "T", max(T_in, 280.0), "P", P_in, fluid)
            s_in  = PropsSI("S", "T", max(T_in, 280.0), "P", P_in, fluid)
            h_out_s = PropsSI("H", "P", P_out, "S", s_in, fluid)
            h_out   = h_in - eta_t * (h_in - h_out_s)
            s_out   = PropsSI("S", "P", P_out, "H", h_out, fluid)
            W_actual = m_dot * (h_in - h_out)
        except Exception:
            h_out, s_out, W_actual = 0.0, 0.0, 0.0
        
        return {
            "h_out": h_out,
            "s_out": s_out,
            "P_out": P_out,
            "W_out": W_actual,
            "T_in": T_in,  # Pass through for reference
        }


# ─────────────────────────────────────────────────────────────────────────────
# CONDENSER — single thermal node: condensate pool temperature
#
# Energy balance (open system):
#   m_c · cp_c · dT_c/dt = ṁ·(h_in − h_out) − UA_c·(T_c − T_sink)
#
# h_in = turbine exit enthalpy (passed as param, updated each step if coupled)
# h_out = saturated liquid enthalpy at low pressure
# ─────────────────────────────────────────────────────────────────────────────
class CondenserModel:
    state_vars = ["T_fluid_condenser"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        T_c    = max(y[0], 280.0)

        m_c    = float(params.get("mass_fluid",  params.get("fluid_mass",   200.0)))
        T_sink = float(params.get("T_sink_K",    params.get("T_sink",       298.15)))
        P      = float(params.get("P_Pa",        10_000.0))
        m_dot  = float(params.get("mass_flow",   2.5))
        h_in   = float(params.get("h_inlet",     2_300_000.0))  # J/kg — turbine exit

        UA_c   = _kw_to_w(float(params.get("UA_kW_K", 30.0)))

        try:
            h_out = tu.sat_enthalpy_liquid(P, fluid)
            cp_c  = tu.cp(T_c, P, fluid)
        except Exception:
            return [0.0]

        Q_in  = m_dot * max(h_in - h_out, 0.0)   # heat to be rejected (≥0)
        Q_out = UA_c * (T_c - T_sink)              # heat to cooling water

        dTc = (Q_in - Q_out) / max(m_c * cp_c, 1.0)
        return [dTc]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        from CoolProp.CoolProp import PropsSI
        
        T_c = max(y[0], 280.0)
        P = float(params.get("P_Pa", 10_000.0))
        
        try:
            h_out = tu.sat_enthalpy_liquid(P, fluid)
            s_out = PropsSI("S", "P", P, "Q", 0, fluid)
        except Exception:
            h_out, s_out = 0.0, 0.0
        
        return {
            "T_fluid": T_c,
            "T_out": T_c,
            "h_out": h_out,
            "s_out": s_out,
            "P_out": P,
        }


# ─────────────────────────────────────────────────────────────────────────────
# PUMP — negligible thermal inertia, quasi-steady
#
# The pump exit temperature is determined almost instantly by the isentropic
# work input. We model it as a first-order lag to avoid algebraic loops:
#
#   τ_p · dT_out/dt = T_out_ss − T_out
#
# where T_out_ss = T_in + w_pump / cp  (ideal pump exit temperature rise)
# and τ_p = 1 s (pump time constant — very fast)
# ─────────────────────────────────────────────────────────────────────────────
class PumpModel:
    state_vars = ["T_pump_out"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        T_out = max(y[0], 280.0)

        eta_p = float(params.get("eta_isentropic", 0.80))
        P_in  = float(params.get("P_in_Pa",  params.get("P_in",   10_000.0)))
        P_out = float(params.get("P_out_Pa", params.get("P_out", 3_000_000.0)))
        T_in  = float(params.get("T_in_K",   params.get("T_in",      318.0)))  # condenser exit T

        try:
            # Incompressible approximation for pump: w_pump = v·ΔP / eta
            rho   = tu.density(max(T_in, 280.0), P_in, fluid)
            v     = 1.0 / rho                             # m³/kg
            w_s   = v * (P_out - P_in)                    # J/kg isentropic
            w_p   = w_s / eta_p                           # J/kg actual
            cp_l  = tu.cp(max(T_in, 280.0), P_in, fluid)
            T_out_ss = T_in + w_p / cp_l                  # K
        except Exception:
            T_out_ss = T_out  # no change on error

        tau_p = 1.0  # s — fast pump response
        dT = (T_out_ss - T_out) / tau_p
        return [dT]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        T_out = max(y[0], 280.0)
        P_out = float(params.get("P_out_Pa", params.get("P_out", 3_000_000.0)))
        
        from CoolProp.CoolProp import PropsSI
        try:
            h_out = PropsSI("H", "T", T_out, "P", P_out, fluid)
            s_out = PropsSI("S", "T", T_out, "P", P_out, fluid)
        except Exception:
            h_out, s_out = 0.0, 0.0
        
        return {
            "T_fluid": T_out,
            "T_out": T_out,
            "h_out": h_out,
            "s_out": s_out,
            "P_out": P_out,
        }


# ─────────────────────────────────────────────────────────────────────────────
# COMPRESSOR — for Brayton cycles (gas turbine, air cycles)
#
# Similar to pump but for gases with non-negligible density changes
# ─────────────────────────────────────────────────────────────────────────────
class CompressorModel:
    state_vars = ["omega_compressor"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        omega = max(y[0], 1.0)   # rad/s
        
        I = float(params.get("rotor_inertia", 100.0))           # kg·m²
        eta_c = float(params.get("eta_isentropic", 0.85))       # isentropic efficiency
        P_in = float(params.get("P_in_Pa", 101_325.0))          # Pa
        P_out = float(params.get("P_out_Pa", 1_000_000.0))      # Pa
        m_dot = float(params.get("mass_flow", 5.0))             # kg/s
        T_in = float(params.get("T_in_K", 300.0))               # K — from upstream
        W_driver = float(params.get("driver_power_W", 1_000_000.0))  # W
        
        try:
            from CoolProp.CoolProp import PropsSI
            h_in = PropsSI("H", "T", max(T_in, 250.0), "P", P_in, fluid)
            s_in = PropsSI("S", "T", max(T_in, 250.0), "P", P_in, fluid)
            h_out_s = PropsSI("H", "P", P_out, "S", s_in, fluid)
            h_out = h_in + (h_out_s - h_in) / eta_c   # Work IN
            W_actual = m_dot * (h_out - h_in)         # W
        except Exception:
            W_actual = W_driver
        
        tau_comp = W_actual / omega
        tau_driver = W_driver / omega
        domega = (tau_driver - tau_comp) / I
        return [domega]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        from CoolProp.CoolProp import PropsSI
        
        eta_c = float(params.get("eta_isentropic", 0.85))
        P_in = float(params.get("P_in_Pa", 101_325.0))
        P_out = float(params.get("P_out_Pa", 1_000_000.0))
        m_dot = float(params.get("mass_flow", 5.0))
        T_in = float(params.get("T_in_K", 300.0))
        
        try:
            h_in = PropsSI("H", "T", max(T_in, 250.0), "P", P_in, fluid)
            s_in = PropsSI("S", "T", max(T_in, 250.0), "P", P_in, fluid)
            h_out_s = PropsSI("H", "P", P_out, "S", s_in, fluid)
            h_out = h_in + (h_out_s - h_in) / eta_c
            s_out = PropsSI("S", "P", P_out, "H", h_out, fluid)
            W_actual = m_dot * (h_out - h_in)
        except Exception:
            h_out, s_out, W_actual = 0.0, 0.0, 0.0
        
        return {
            "h_out": h_out,
            "s_out": s_out,
            "P_out": P_out,
            "W_in": W_actual,
            "T_in": T_in,
        }


# ─────────────────────────────────────────────────────────────────────────────
# HEAT EXCHANGER — two-stream counter-flow heat exchanger
#
# Hot stream loses heat to cold stream
# ─────────────────────────────────────────────────────────────────────────────
class HeatExchangerModel:
    state_vars = ["T_hot_out", "T_cold_out"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        T_h = max(y[0], 250.0)
        T_c = max(y[1], 250.0)
        
        m_h = float(params.get("mass_hot", 1.0))          # kg (thermal mass)
        m_c = float(params.get("mass_cold", 1.0))         # kg (thermal mass)
        UA = _kw_to_w(float(params.get("UA_kW_K", 10.0))) # W/K
        
        T_h_in = float(params.get("T_hot_in_K", 400.0))   # K — from upstream
        T_c_in = float(params.get("T_cold_in_K", 300.0))  # K — from upstream
        
        # Simple effectiveness approach
        Q = UA * (T_h - T_c)
        
        dT_h = -Q / max(m_h * 1000, 1.0)   # Simplified cp = 1000 J/kg·K
        dT_c = Q / max(m_c * 1000, 1.0)
        
        return [dT_h, dT_c]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        T_h = max(y[0], 250.0)
        T_c = max(y[1], 250.0)
        
        return {
            "T_hot_out": T_h,
            "T_cold_out": T_c,
            "T_out_hot": T_h,   # Alias for consistency
            "T_out_cold": T_c,  # Alias for consistency
        }


# ─────────────────────────────────────────────────────────────────────────────
# EVAPORATOR — for refrigeration cycles (VCR)
#
# Absorbs heat from cold space
# ─────────────────────────────────────────────────────────────────────────────
class EvaporatorModel:
    state_vars = ["T_evap", "x_refrigerant"]

    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        T_e = max(y[0], 250.0)
        x = max(min(y[1], 1.0), 0.0)  # Quality [0,1]
        
        m_f = float(params.get("mass_fluid", 10.0))               # kg
        UA = _kw_to_w(float(params.get("UA_kW_K", 5.0)))          # W/K
        T_cold_space = float(params.get("T_cold_space_K", 273.15)) # K
        P_evap = float(params.get("P_Pa", 500_000.0))             # Pa
        m_dot = float(params.get("mass_flow", 0.5))               # kg/s
        
        from CoolProp.CoolProp import PropsSI
        try:
            h_fg = PropsSI("H", "Q", 1, "P", P_evap, fluid) - PropsSI("H", "Q", 0, "P", P_evap, fluid)
        except Exception:
            h_fg = 200_000.0  # Default ~200 kJ/kg
        
        Q_in = UA * (T_cold_space - T_e)  # Heat from cold space
        
        dx_dt = Q_in / max(m_f * h_fg, 1.0) if h_fg > 0 else 0.0
        dT_dt = (Q_in - m_dot * h_fg * x) / max(m_f * 2000, 1.0)  # Simplified cp
        
        return [dT_dt, dx_dt]

    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Return thermodynamic outputs for downstream coupling."""
        T_e = max(y[0], 250.0)
        x = max(min(y[1], 1.0), 0.0)
        P_evap = float(params.get("P_Pa", 500_000.0))
        
        from CoolProp.CoolProp import PropsSI
        try:
            h_out = PropsSI("H", "T", T_e, "Q", x, fluid)
            s_out = PropsSI("S", "T", T_e, "Q", x, fluid)
        except Exception:
            h_out, s_out = 0.0, 0.0
        
        return {
            "T_fluid": T_e,
            "T_out": T_e,
            "h_out": h_out,
            "s_out": s_out,
            "P_out": P_evap,
            "quality": x,
        }


# ─────────────────────────────────────────────────────────────────────────────
# EXPANSION VALVE — isenthalpic throttling (no dynamics)
#
# No state variables — just passes enthalpy through
# ─────────────────────────────────────────────────────────────────────────────
class ExpansionValveModel:
    state_vars: list[str] = []  # No dynamic states
    
    def dydt(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> list[float]:
        return []  # No dynamics
    
    def compute_outputs(self, t: float, y: list[float], params: dict[str, Any], fluid: str) -> dict[str, float]:
        """Isenthalpic expansion: h_out = h_in."""
        h_in = float(params.get("h_inlet", 300_000.0))  # J/kg
        P_out = float(params.get("P_out_Pa", 100_000.0))  # Pa
        
        from CoolProp.CoolProp import PropsSI
        try:
            # For throttling: h_out = h_in, so find T at P_out with same h
            T_out = PropsSI("T", "P", P_out, "H", h_in, fluid)
            s_out = PropsSI("S", "P", P_out, "H", h_in, fluid)
        except Exception:
            T_out, s_out = 0.0, 0.0
        
        return {
            "h_out": h_in,  # Isenthalpic
            "T_out": T_out,
            "s_out": s_out,
            "P_out": P_out,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Registry
# ─────────────────────────────────────────────────────────────────────────────
COMPONENT_REGISTRY: dict[str, type] = {
    "boiler":          BoilerModel,
    "receiver":        BoilerModel,
    "solar_receiver":  BoilerModel,
    "turbine":         TurbineModel,
    "steam_turbine":   TurbineModel,
    "orc_turbine":     TurbineModel,
    "condenser":       CondenserModel,
    "orc_condenser":   CondenserModel,
    "absorber":        CondenserModel,
    "pump":            PumpModel,
    "orc_pump":        PumpModel,
    "solution_pump":   PumpModel,
    "feedwater_pump":  PumpModel,
    "compressor":      CompressorModel,
    "heat_exchanger":  HeatExchangerModel,
    "hrsg":            HeatExchangerModel,
    "heliostat_field": HeatExchangerModel,
    "solar_field":     HeatExchangerModel,
    "solution_heat_exchanger": HeatExchangerModel,
    "recuperator":     HeatExchangerModel,
    "regenerator":     HeatExchangerModel,
    "evaporator":      EvaporatorModel,
    "generator":       BoilerModel,
    "abs_generator":   BoilerModel,
    "expansion_valve": ExpansionValveModel,
}


def get_model(component_type: str):
    cls = COMPONENT_REGISTRY.get(component_type.lower())
    if cls is None:
        raise ValueError(
            f"Unknown transient component type '{component_type}'. "
            f"Available: {list(COMPONENT_REGISTRY.keys())}"
        )
    return cls()
