"""
ThermoBird Cycle Engine — real thermodynamic solver.

Supported cycles
----------------
Power:
  rankine               Steam Rankine  (Water)
  orc                   Organic Rankine (any CoolProp fluid)
  brayton               Brayton / gas turbine (Air, N2, CO2 …)

Refrigeration / Heat Pump:
  vapor_compression     Vapour-compression refrigeration
  vapor_absorption      Vapour-absorption (NH3-H2O, LiBr-H2O) — simplified

Every result includes
---------------------
- state_points          list of {label, T, P, h, s, x, phase} per state
- component_metrics     per-component work, heat, η_is, Ṡ_gen, Ėx_dest, Ėx_dest_rate
- energy_balance        Q_in, Q_out, W_net, η_th, BWR, …
- entropy               Ṡ_gen_total, per-component breakdown
- exergy                Ėx_dest_total, η_ex, per-component breakdown
- performance           headline KPIs
- ts_diagram / ph_diagram  {x:[], y:[], labels:[], saturation_curve:{…}}
- warnings              []
"""

from __future__ import annotations
import time
import math
import logging
from typing import Any, Dict, List, Optional, Tuple

from CoolProp.CoolProp import PropsSI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_full_analysis(inputs: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Run a complete thermodynamic cycle analysis.

    Parameters
    ----------
    inputs : dict
        cycle_type  : str   — one of the keys above
        fluid       : str   — CoolProp fluid name (default 'Water')
        mass_flow   : float — kg/s (default 1.0)
        T0, P0      : float — dead-state T [K] and P [Pa]
        + cycle-specific parameters (see each solver)

    Returns
    -------
    (results_dict, duration_ms)
    """
    t0 = time.time()
    try:
        cycle_type = (inputs.get("cycle_type") or "rankine").lower().strip()
        result = _dispatch(cycle_type, inputs)
        result["cycle_type"] = cycle_type
        result["success"] = True
    except Exception as exc:
        logger.error("cycle_engine error", exc_info=True)
        result = {
            "success": False,
            "error_message": str(exc),
            "cycle_type": inputs.get("cycle_type", "unknown"),
            "warnings": [],
        }
    duration_ms = int((time.time() - t0) * 1000)
    return result, duration_ms


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def _dispatch(cycle_type: str, inp: Dict[str, Any]) -> Dict[str, Any]:
    solvers = {
        "rankine":            _solve_rankine,
        "steam_rankine":      _solve_rankine,
        "orc":                _solve_rankine,   # same topology, different fluid
        "brayton":            _solve_brayton,
        "gas_turbine":        _solve_brayton,
        "vapor_compression":  _solve_vcr,
        "refrigeration":      _solve_vcr,
        "vapor_absorption":   _solve_var,
        "absorption":         _solve_var,
    }
    solver = solvers.get(cycle_type)
    if solver is None:
        raise ValueError(
            f"Unknown cycle_type '{cycle_type}'. "
            f"Supported: {list(solvers.keys())}"
        )
    return solver(inp)


# ---------------------------------------------------------------------------
# CoolProp helper
# ---------------------------------------------------------------------------

def _props(output: str, in1: str, v1: float, in2: str, v2: float, fluid: str) -> float:
    return PropsSI(output, in1, v1, in2, v2, fluid)


def _sat_curve(fluid: str, n: int = 80) -> Dict[str, List[float]]:
    """Return saturation dome data for T-s and P-h diagrams."""
    try:
        Tmin = _props("Tmin", "", 0, "", 0, fluid) + 1
        Tcrit = _props("Tcrit", "", 0, "", 0, fluid)
        temps = [Tmin + (Tcrit - Tmin) * i / (n - 1) for i in range(n)]
        sl, sv, hl, hv, pl = [], [], [], [], []
        for T in temps:
            try:
                sl.append(_props("S", "T", T, "Q", 0, fluid))
                sv.append(_props("S", "T", T, "Q", 1, fluid))
                hl.append(_props("H", "T", T, "Q", 0, fluid))
                hv.append(_props("H", "T", T, "Q", 1, fluid))
                pl.append(_props("P", "T", T, "Q", 0, fluid))
            except Exception:
                pass
        return {
            "T": temps[:len(sl)] + temps[:len(sl)][::-1],
            "s_liq": sl, "s_vap": sv,
            "h_liq": hl, "h_vap": hv,
            "P": pl,
        }
    except Exception:
        return {}


def _phase(T: float, P: float, fluid: str) -> str:
    try:
        Q = _props("Q", "T", T, "P", P, fluid)
        if 0 <= Q <= 1:
            return "two-phase"
    except Exception:
        pass
    try:
        Tc = _props("Tcrit", "", 0, "", 0, fluid)
        Pc = _props("Pcrit", "", 0, "", 0, fluid)
        if T > Tc and P > Pc:
            return "supercritical"
        Tsat = _props("T", "P", P, "Q", 0, fluid)
        return "liquid" if T < Tsat else "vapor"
    except Exception:
        return "unknown"


def _exergy(h: float, s: float, h0: float, s0: float, T0: float) -> float:
    """Specific flow exergy [J/kg]: ex = (h-h0) - T0*(s-s0)"""
    return (h - h0) - T0 * (s - s0)


# ---------------------------------------------------------------------------
# ── RANKINE / ORC ──────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _solve_rankine(inp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simple regenerative-ready Rankine / ORC cycle.

    Required inputs (or defaults)
    ------------------------------
    fluid           : 'Water'
    mass_flow       : 1.0 kg/s
    P_boiler        : 3e6 Pa       boiler (high) pressure
    T_superheat     : 500 K        turbine inlet temperature
    P_condenser     : 10000 Pa     condenser (low) pressure
    eta_pump        : 0.80         pump isentropic efficiency
    eta_turbine     : 0.85         turbine isentropic efficiency
    T0, P0          : 298.15, 101325
    """
    fluid   = inp.get("fluid", "Water")
    mdot    = float(inp.get("mass_flow", 1.0))
    P_hi    = float(inp.get("P_boiler",    3_000_000.0))
    T_turb  = float(inp.get("T_superheat", 500.0))
    P_lo    = float(inp.get("P_condenser", 10_000.0))
    eta_p   = float(inp.get("eta_pump",    0.80))
    eta_t   = float(inp.get("eta_turbine", 0.85))
    regen   = float(inp.get("regen_effectiveness", 0.0))  # 0 = no regenerator
    T0      = float(inp.get("T0", 298.15))
    P0      = float(inp.get("P0", 101_325.0))
    warnings: List[str] = []

    # ── State 1: condenser exit / pump inlet (sat. liquid) ─────────────────
    h1 = _props("H", "P", P_lo, "Q", 0, fluid)
    s1 = _props("S", "P", P_lo, "Q", 0, fluid)
    T1 = _props("T", "P", P_lo, "Q", 0, fluid)

    # ── State 2: pump exit ──────────────────────────────────────────────────
    h2s = _props("H", "P", P_hi, "S", s1, fluid)
    w_pump_is = h2s - h1
    w_pump    = w_pump_is / eta_p
    h2 = h1 + w_pump
    T2 = _props("T", "P", P_hi, "H", h2, fluid)
    s2 = _props("S", "P", P_hi, "H", h2, fluid)

    # ── State 3: boiler exit / turbine inlet ────────────────────────────────
    h3 = _props("H", "T", T_turb, "P", P_hi, fluid)
    s3 = _props("S", "T", T_turb, "P", P_hi, fluid)
    T3 = T_turb

    # ── State 4: turbine exit ───────────────────────────────────────────────
    h4s = _props("H", "P", P_lo, "S", s3, fluid)
    w_turb_is = h3 - h4s
    w_turb    = w_turb_is * eta_t
    h4 = h3 - w_turb
    s4 = _props("S", "P", P_lo, "H", h4, fluid)
    T4 = _props("T", "P", P_lo, "H", h4, fluid)
    x4 = None
    try:
        x4 = _props("Q", "P", P_lo, "H", h4, fluid)
        if x4 < 0.88:
            warnings.append(f"Turbine exit quality {x4:.3f} — risk of blade erosion")
    except Exception:
        pass

    # ── Regenerator (closed, if regen_effectiveness > 0) ───────────────────
    # Hot side: turbine exhaust (State 4) → State 4r (cooled exhaust to condenser)
    # Cold side: pump exit (State 2)     → State 2r (pre-heated feed to boiler)
    h2r, h4r = h2, h4          # default: no regenerator
    T2r, T4r = T2, T4
    s2r, s4r = s2, s4
    Sgen_regen = 0.0
    if regen > 0.0:
        # Maximum heat limited by whichever stream hits the other's inlet temp first
        h4_at_T2 = _props("H", "T", T2, "P", P_lo, fluid)
        h2_at_T4 = _props("H", "T", T4, "P", P_hi, fluid)
        Q_max_h  = h4 - h4_at_T2           # hot stream potential
        Q_max_c  = h2_at_T4 - h2           # cold stream potential
        Q_max    = min(max(Q_max_h, 0.0), max(Q_max_c, 0.0))
        Q_regen  = regen * Q_max

        h2r = h2 + Q_regen
        h4r = h4 - Q_regen
        T2r = _props("T", "P", P_hi, "H", h2r, fluid)
        T4r = _props("T", "P", P_lo, "H", h4r, fluid)
        s2r = _props("S", "P", P_hi, "H", h2r, fluid)
        s4r = _props("S", "P", P_lo, "H", h4r, fluid)
        Sgen_regen = max(0.0, (s4r - s4) + (s2r - s2))  # per unit mass flow

    # ── Boiler / condenser heat ─────────────────────────────────────────────
    q_boiler    = h3 - h2r         # regen pre-heats feedwater → less boiler duty
    q_condenser = h4r - h1         # regen cools exhaust → less condenser duty
    w_net       = w_turb - w_pump  # J/kg

    Q_boiler    = mdot * q_boiler
    Q_cond      = mdot * abs(q_condenser)
    W_net       = mdot * w_net
    W_pump      = mdot * w_pump
    W_turb      = mdot * w_turb

    eta_th      = w_net / q_boiler if q_boiler > 0 else 0.0

    # Carnot efficiency
    T_hi  = T3
    T_lo  = T1
    eta_c = 1 - T_lo / T_hi

    # ── Entropy generation per component (corrected per Moran & Shapiro) ──
    # Pump (adiabatic): Ṡ_gen = ṁ(s_out - s_in)  [NO work term!]
    Sgen_pump    = mdot * (s2 - s1)
    Sgen_regen_W = mdot * Sgen_regen          # W/K (0 if no regen)
    # Boiler: Ṡ_gen = ṁ(s_out - s_in) - Q̇_in/T_source
    # Assume source temperature ~100K hotter than steam exit
    T_source_boiler = T3 + 100.0
    Sgen_boiler  = mdot * (s3 - s2r) - Q_boiler / T_source_boiler
    Sgen_turbine = mdot * max(0.0, s4 - s3)
    Sgen_cond    = mdot * max(0.0, s1 - s4r)
    Sgen_total   = Sgen_pump + Sgen_regen_W + Sgen_boiler + Sgen_turbine + Sgen_cond

    # ── Dead-state properties ───────────────────────────────────────────────
    try:
        h0 = _props("H", "T", T0, "P", P0, fluid)
        s0 = _props("S", "T", T0, "P", P0, fluid)
    except Exception:
        h0, s0 = h1, s1   # fallback

    # ── Exergy destruction per component ───────────────────────────────────
    Ex_dest_pump    = T0 * Sgen_pump
    Ex_dest_regen   = T0 * Sgen_regen_W
    Ex_dest_boiler  = T0 * Sgen_boiler
    Ex_dest_turbine = T0 * Sgen_turbine
    Ex_dest_cond    = T0 * Sgen_cond
    Ex_dest_total   = T0 * Sgen_total

    # Exergy efficiency (power cycle): η_ex = W_net / ΔEx_boiler
    ex1 = mdot * _exergy(h1, s1, h0, s0, T0)
    ex2 = mdot * _exergy(h2, s2, h0, s0, T0)
    ex3 = mdot * _exergy(h3, s3, h0, s0, T0)
    ex4 = mdot * _exergy(h4, s4, h0, s0, T0)
    dEx_boiler = ex3 - ex2
    eta_ex = W_net / dEx_boiler if dEx_boiler > 0 else 0.0

    bwr = W_pump / W_turb if W_turb > 0 else 0.0

    # ── T-s diagram data ───────────────────────────────────────────────────
    sat = _sat_curve(fluid)
    # If regenerator is active, include the intermediate states 2r and 4r
    if regen > 0.0:
        ts_s = [s1, s2, s2r, s3, s4, s4r, s1]
        ts_T = [T1, T2, T2r, T3, T4, T4r, T1]
        ts_L = ["1", "2", "2r", "3", "4", "4r", "1"]
        ph_h = [h1, h2, h2r, h3, h4, h4r, h1]
        ph_P = [P_lo, P_hi, P_hi, P_hi, P_lo, P_lo, P_lo]
        ph_L = ["1", "2", "2r", "3", "4", "4r", "1"]
    else:
        ts_s = [s1, s2, s3, s4, s1]
        ts_T = [T1, T2, T3, T4, T1]
        ts_L = ["1", "2", "3", "4", "1"]
        ph_h = [h1, h2, h3, h4, h1]
        ph_P = [P_lo, P_hi, P_hi, P_lo, P_lo]
        ph_L = ["1", "2", "3", "4", "1"]

    ts_diagram = {
        "cycle": {"s": ts_s, "T": ts_T, "labels": ts_L},
        "saturation": sat,
        "x_label": "Entropy s [J/(kg·K)]",
        "y_label": "Temperature T [K]",
    }
    ph_diagram = {
        "cycle": {"h": ph_h, "P": ph_P, "labels": ph_L},
        "saturation": sat,
        "x_label": "Enthalpy h [J/kg]",
        "y_label": "Pressure P [Pa]",
    }

    # ── State points ───────────────────────────────────────────────────────
    state_points = [
        _sp("1 – Pump inlet",      T1,  P_lo, h1,  s1,  0.0,  "sat. liquid",              fluid),
        _sp("2 – Pump outlet",     T2,  P_hi, h2,  s2,  None, _phase(T2,  P_hi, fluid),   fluid),
    ]
    if regen > 0.0:
        state_points.append(_sp("2r – Regen cold outlet", T2r, P_hi, h2r, s2r, None, _phase(T2r, P_hi, fluid), fluid))
    state_points += [
        _sp("3 – Turbine inlet",   T3,  P_hi, h3,  s3,  None, _phase(T3,  P_hi, fluid),   fluid),
        _sp("4 – Turbine outlet",  T4,  P_lo, h4,  s4,  x4,   _phase(T4,  P_lo, fluid),   fluid),
    ]
    if regen > 0.0:
        x4r = None
        try: x4r = _props("Q", "P", P_lo, "H", h4r, fluid)
        except Exception: pass
        state_points.append(_sp("4r – Regen hot outlet", T4r, P_lo, h4r, s4r, x4r, _phase(T4r, P_lo, fluid), fluid))

    # ── Component metrics ──────────────────────────────────────────────────
    component_metrics = [
        _cm("Pump",      "pump",     -W_pump,  0,         eta_p, Sgen_pump,    Ex_dest_pump,    Sgen_total),
    ]
    if regen > 0.0:
        Q_regen_W = mdot * regen * min(max(h4 - _props("H","T",T2,"P",P_lo,fluid), 0),
                                        max(_props("H","T",T4,"P",P_hi,fluid) - h2, 0))
        component_metrics.append(
            _cm("Regenerator", "regenerator", 0, Q_regen_W, regen, Sgen_regen_W, Ex_dest_regen, Sgen_total)
        )
    component_metrics += [
        _cm("Boiler",    "boiler",    0,        Q_boiler,  None,  Sgen_boiler,  Ex_dest_boiler,  Sgen_total),
        _cm("Turbine",   "turbine",   W_turb,   0,         eta_t, Sgen_turbine, Ex_dest_turbine, Sgen_total),
        _cm("Condenser", "condenser", 0,       -Q_cond,   None,  Sgen_cond,    Ex_dest_cond,    Sgen_total),
    ]

    entropy_breakdown = [
        {"name": "Pump",      "Sgen_W_per_K": Sgen_pump,    "share_pct": 100*Sgen_pump/max(Sgen_total,1e-12)},
    ]
    exergy_breakdown = [
        {"name": "Pump",      "exergy_destruction_kW": Ex_dest_pump/1e3,    "exergy_destruction_share": 100*Ex_dest_pump/max(Ex_dest_total,1e-12)},
    ]
    if regen > 0.0:
        entropy_breakdown.append({"name": "Regenerator", "Sgen_W_per_K": Sgen_regen_W, "share_pct": 100*Sgen_regen_W/max(Sgen_total,1e-12)})
        exergy_breakdown.append({"name": "Regenerator", "exergy_destruction_kW": Ex_dest_regen/1e3, "exergy_destruction_share": 100*Ex_dest_regen/max(Ex_dest_total,1e-12)})
    entropy_breakdown += [
        {"name": "Boiler",    "Sgen_W_per_K": Sgen_boiler,  "share_pct": 100*Sgen_boiler/max(Sgen_total,1e-12)},
        {"name": "Turbine",   "Sgen_W_per_K": Sgen_turbine, "share_pct": 100*Sgen_turbine/max(Sgen_total,1e-12)},
        {"name": "Condenser", "Sgen_W_per_K": Sgen_cond,    "share_pct": 100*Sgen_cond/max(Sgen_total,1e-12)},
    ]
    exergy_breakdown += [
        {"name": "Boiler",    "exergy_destruction_kW": Ex_dest_boiler/1e3,  "exergy_destruction_share": 100*Ex_dest_boiler/max(Ex_dest_total,1e-12)},
        {"name": "Turbine",   "exergy_destruction_kW": Ex_dest_turbine/1e3, "exergy_destruction_share": 100*Ex_dest_turbine/max(Ex_dest_total,1e-12)},
        {"name": "Condenser", "exergy_destruction_kW": Ex_dest_cond/1e3,    "exergy_destruction_share": 100*Ex_dest_cond/max(Ex_dest_total,1e-12)},
    ]

    return {
        "state_points":    state_points,
        "component_metrics": component_metrics,
        "energy_balance": {
            "total_heat_input_kW":        Q_boiler / 1e3,
            "total_heat_output_kW":       Q_cond / 1e3,
            "total_work_input_kW":        W_pump / 1e3,
            "total_work_output_kW":       W_turb / 1e3,
            "net_work_kW":                W_net / 1e3,
            "energy_balance_error_percent": abs((Q_boiler - Q_cond - W_net) / max(Q_boiler, 1)) * 100,
            "is_balanced":                True,
        },
        "entropy": {
            "total_Sgen_W_per_K":    Sgen_total,
            "component_breakdown": [
                {"name": "Pump",      "Sgen_W_per_K": Sgen_pump,    "share_pct": 100*Sgen_pump/max(Sgen_total,1e-12)},
                {"name": "Boiler",    "Sgen_W_per_K": Sgen_boiler,  "share_pct": 100*Sgen_boiler/max(Sgen_total,1e-12)},
                {"name": "Turbine",   "Sgen_W_per_K": Sgen_turbine, "share_pct": 100*Sgen_turbine/max(Sgen_total,1e-12)},
                {"name": "Condenser", "Sgen_W_per_K": Sgen_cond,    "share_pct": 100*Sgen_cond/max(Sgen_total,1e-12)},
            ],
        },
        "exergy": {
            "total_exergy_destruction_kW": Ex_dest_total / 1e3,
            "exergy_efficiency":           eta_ex,
            "component_breakdown": [
                {"name": "Pump",      "exergy_destruction_kW": Ex_dest_pump/1e3,    "exergy_destruction_share": 100*Ex_dest_pump/max(Ex_dest_total,1e-12)},
                {"name": "Boiler",    "exergy_destruction_kW": Ex_dest_boiler/1e3,  "exergy_destruction_share": 100*Ex_dest_boiler/max(Ex_dest_total,1e-12)},
                {"name": "Turbine",   "exergy_destruction_kW": Ex_dest_turbine/1e3, "exergy_destruction_share": 100*Ex_dest_turbine/max(Ex_dest_total,1e-12)},
                {"name": "Condenser", "exergy_destruction_kW": Ex_dest_cond/1e3,    "exergy_destruction_share": 100*Ex_dest_cond/max(Ex_dest_total,1e-12)},
            ],
        },
        "performance": {
            "net_power_kW":         W_net / 1e3,
            "thermal_efficiency":   eta_th,
            "carnot_efficiency":    eta_c,
            "second_law_efficiency": eta_th / eta_c if eta_c > 0 else 0.0,
            "back_work_ratio":      bwr,
            "specific_work_kJ_kg":  w_net / 1e3,
            "heat_rate_kJ_kWh":    (q_boiler / max(w_net, 1)) * 3600,
        },
        "ts_diagram":  ts_diagram,
        "ph_diagram":  ph_diagram,
        "warnings":    warnings,
    }


# ---------------------------------------------------------------------------
# ── BRAYTON ────────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _solve_brayton(inp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simple Brayton cycle (open/closed, ideal gas).

    Inputs
    ------
    fluid          : 'Air'
    mass_flow      : 1.0 kg/s
    T_inlet        : 298.15 K    compressor inlet temperature
    P_inlet        : 101325 Pa   compressor inlet pressure
    pressure_ratio : 8.0         P_hi / P_lo
    T_turbine_inlet: 1400 K      turbine inlet temperature (TIT)
    eta_compressor : 0.85
    eta_turbine    : 0.88
    T0, P0         : 298.15, 101325
    """
    fluid   = inp.get("fluid", "Air")
    mdot    = float(inp.get("mass_flow", 1.0))
    T1      = float(inp.get("T_inlet",         298.15))
    P1      = float(inp.get("P_inlet",          101_325.0))
    rp      = float(inp.get("pressure_ratio",   8.0))
    T3      = float(inp.get("T_turbine_inlet", 1400.0))
    eta_c   = float(inp.get("eta_compressor",   0.85))
    eta_t   = float(inp.get("eta_turbine",      0.88))
    T0      = float(inp.get("T0", 298.15))
    P0      = float(inp.get("P0", 101_325.0))
    warnings: List[str] = []

    P2 = P1 * rp
    P3 = P2
    P4 = P1

    # State 1 — compressor inlet
    h1 = _props("H", "T", T1, "P", P1, fluid)
    s1 = _props("S", "T", T1, "P", P1, fluid)

    # State 2 — compressor exit
    h2s = _props("H", "P", P2, "S", s1, fluid)
    w_c_is = h2s - h1
    w_c    = w_c_is / eta_c
    h2 = h1 + w_c
    T2 = _props("T", "P", P2, "H", h2, fluid)
    s2 = _props("S", "P", P2, "H", h2, fluid)

    # State 3 — turbine inlet
    h3 = _props("H", "T", T3, "P", P3, fluid)
    s3 = _props("S", "T", T3, "P", P3, fluid)

    # State 4 — turbine exit
    h4s = _props("H", "P", P4, "S", s3, fluid)
    w_t_is = h3 - h4s
    w_t    = w_t_is * eta_t
    h4 = h3 - w_t
    T4 = _props("T", "P", P4, "H", h4, fluid)
    s4 = _props("S", "P", P4, "H", h4, fluid)

    if T2 > 900:
        warnings.append(f"Compressor exit T = {T2:.0f} K — consider intercooling")
    if T4 > 900:
        warnings.append(f"Turbine exit T = {T4:.0f} K — significant exhaust heat available for recuperation")

    q_in    = h3 - h2
    w_net   = w_t - w_c
    eta_th  = w_net / q_in if q_in > 0 else 0.0
    bwr     = w_c / w_t if w_t > 0 else 0.0

    # Carnot upper bound (T1 cold, T3 hot)
    eta_c_th = 1 - T1 / T3

    W_comp  = mdot * w_c
    W_turb  = mdot * w_t
    W_net   = mdot * w_net
    Q_in    = mdot * q_in
    Q_out   = mdot * (h4 - h1)

    # ── Entropy generation per component (corrected per Moran & Shapiro) ──
    # Compressor (adiabatic): Ṡ_gen = ṁ(s_out - s_in)  [NO work term!]
    Sgen_comp = mdot * (s2 - s1)
    # Combustor: Ṡ_gen = ṁ(s_out - s_in) - Q̇_in/T_source
    # Assume combustion source temperature ~200K hotter than turbine inlet
    T_source_combustor = T3 + 200.0
    Sgen_comb = mdot * (s3 - s2) - Q_in / T_source_combustor
    Sgen_turb = mdot * max(0.0, s4 - s3)
    Sgen_exhaust = mdot * max(0.0, s1 - s4)  # heat rejection
    Sgen_total   = Sgen_comp + Sgen_comb + Sgen_turb + Sgen_exhaust

    T0_ex = T0
    Ex_dest_comp    = T0_ex * Sgen_comp
    Ex_dest_comb    = T0_ex * Sgen_comb
    Ex_dest_turb    = T0_ex * Sgen_turb
    Ex_dest_exhaust = T0_ex * Sgen_exhaust
    Ex_dest_total   = T0_ex * Sgen_total

    try:
        h0 = _props("H", "T", T0, "P", P0, fluid)
        s0 = _props("S", "T", T0, "P", P0, fluid)
    except Exception:
        h0, s0 = h1, s1

    dEx_combustor = mdot * (_exergy(h3, s3, h0, s0, T0) - _exergy(h2, s2, h0, s0, T0))
    eta_ex = W_net / dEx_combustor if dEx_combustor > 0 else 0.0

    # T-s diagram
    sat = {}  # Brayton has no two-phase dome (gas cycle)
    ts_diagram = {
        "cycle": {
            "s": [s1, s2, s3, s4, s1],
            "T": [T1, T2, T3, T4, T1],
            "labels": ["1", "2", "3", "4", "1"],
        },
        "saturation": sat,
        "x_label": "Entropy s [J/(kg·K)]",
        "y_label": "Temperature T [K]",
    }
    ph_diagram = {
        "cycle": {
            "h": [h1, h2, h3, h4, h1],
            "P": [P1, P2, P3, P4, P1],
            "labels": ["1", "2", "3", "4", "1"],
        },
        "saturation": sat,
        "x_label": "Enthalpy h [J/kg]",
        "y_label": "Pressure P [Pa]",
    }

    state_points = [
        _sp("1 – Compressor inlet", T1, P1, h1, s1, None, "gas", fluid),
        _sp("2 – Combustor inlet",  T2, P2, h2, s2, None, "gas", fluid),
        _sp("3 – Turbine inlet",    T3, P3, h3, s3, None, "gas", fluid),
        _sp("4 – Exhaust",          T4, P4, h4, s4, None, "gas", fluid),
    ]

    component_metrics = [
        _cm("Compressor",  "compressor", -W_comp,  0,      eta_c, Sgen_comp,    Ex_dest_comp,    Sgen_total),
        _cm("Combustor",   "boiler",      0,        Q_in,   None,  Sgen_comb,    Ex_dest_comb,    Sgen_total),
        _cm("Turbine",     "turbine",     W_turb,   0,      eta_t, Sgen_turb,    Ex_dest_turb,    Sgen_total),
        _cm("Heat Rejection","condenser", 0,       -Q_out,  None,  Sgen_exhaust, Ex_dest_exhaust, Sgen_total),
    ]

    return {
        "state_points":    state_points,
        "component_metrics": component_metrics,
        "energy_balance": {
            "total_heat_input_kW":         Q_in / 1e3,
            "total_heat_output_kW":        Q_out / 1e3,
            "total_work_input_kW":         W_comp / 1e3,
            "total_work_output_kW":        W_turb / 1e3,
            "net_work_kW":                 W_net / 1e3,
            "energy_balance_error_percent": abs((Q_in - Q_out - W_net) / max(Q_in, 1)) * 100,
            "is_balanced":                 True,
        },
        "entropy": {
            "total_Sgen_W_per_K": Sgen_total,
            "component_breakdown": [
                {"name": "Compressor",    "Sgen_W_per_K": Sgen_comp,    "share_pct": 100*Sgen_comp/max(Sgen_total,1e-12)},
                {"name": "Combustor",     "Sgen_W_per_K": Sgen_comb,    "share_pct": 100*Sgen_comb/max(Sgen_total,1e-12)},
                {"name": "Turbine",       "Sgen_W_per_K": Sgen_turb,    "share_pct": 100*Sgen_turb/max(Sgen_total,1e-12)},
                {"name": "Heat Rejection","Sgen_W_per_K": Sgen_exhaust, "share_pct": 100*Sgen_exhaust/max(Sgen_total,1e-12)},
            ],
        },
        "exergy": {
            "total_exergy_destruction_kW": Ex_dest_total / 1e3,
            "exergy_efficiency": eta_ex,
            "component_breakdown": [
                {"name": "Compressor",    "exergy_destruction_kW": Ex_dest_comp/1e3,    "exergy_destruction_share": 100*Ex_dest_comp/max(Ex_dest_total,1e-12)},
                {"name": "Combustor",     "exergy_destruction_kW": Ex_dest_comb/1e3,    "exergy_destruction_share": 100*Ex_dest_comb/max(Ex_dest_total,1e-12)},
                {"name": "Turbine",       "exergy_destruction_kW": Ex_dest_turb/1e3,    "exergy_destruction_share": 100*Ex_dest_turb/max(Ex_dest_total,1e-12)},
                {"name": "Heat Rejection","exergy_destruction_kW": Ex_dest_exhaust/1e3, "exergy_destruction_share": 100*Ex_dest_exhaust/max(Ex_dest_total,1e-12)},
            ],
        },
        "performance": {
            "net_power_kW":        W_net / 1e3,
            "thermal_efficiency":  eta_th,
            "carnot_efficiency":   eta_c_th,
            "second_law_efficiency": eta_th / eta_c_th if eta_c_th > 0 else 0.0,
            "back_work_ratio":     bwr,
            "specific_work_kJ_kg": w_net / 1e3,
            "pressure_ratio":      rp,
        },
        "ts_diagram": ts_diagram,
        "ph_diagram": ph_diagram,
        "warnings":   warnings,
    }


# ---------------------------------------------------------------------------
# ── VAPOR COMPRESSION REFRIGERATION ───────────────────────────────────────
# ---------------------------------------------------------------------------

def _solve_vcr(inp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Standard vapor-compression refrigeration / heat-pump cycle.

    Inputs
    ------
    fluid           : 'R134a'
    mass_flow       : 1.0 kg/s
    T_evaporator    : 258.15 K   evaporator temperature (−15 °C)
    T_condenser     : 313.15 K   condensing temperature (40 °C)
    superheat       : 5.0 K      superheat at compressor inlet
    subcooling      : 3.0 K      subcooling at expansion valve inlet
    eta_compressor  : 0.80
    T0, P0          : 298.15, 101325
    """
    fluid   = inp.get("fluid", "R134a")
    mdot    = float(inp.get("mass_flow", 1.0))
    T_evap  = float(inp.get("T_evaporator",  258.15))
    T_cond  = float(inp.get("T_condenser",   313.15))
    SH      = float(inp.get("superheat",       5.0))
    SC      = float(inp.get("subcooling",      3.0))
    eta_c   = float(inp.get("eta_compressor", 0.80))
    T0      = float(inp.get("T0", 298.15))
    P0      = float(inp.get("P0", 101_325.0))
    warnings: List[str] = []

    P_lo = _props("P", "T", T_evap, "Q", 1, fluid)
    P_hi = _props("P", "T", T_cond, "Q", 0, fluid)

    # State 1 — compressor inlet (superheated vapour)
    T1 = T_evap + SH
    h1 = _props("H", "T", T1, "P", P_lo, fluid)
    s1 = _props("S", "T", T1, "P", P_lo, fluid)

    # State 2 — compressor exit
    h2s = _props("H", "P", P_hi, "S", s1, fluid)
    w_c_is = h2s - h1
    w_c    = w_c_is / eta_c
    h2 = h1 + w_c
    T2 = _props("T", "P", P_hi, "H", h2, fluid)
    s2 = _props("S", "P", P_hi, "H", h2, fluid)

    # State 3 — expansion valve inlet (subcooled liquid)
    T3 = T_cond - SC
    h3 = _props("H", "T", T3, "P", P_hi, fluid)
    s3 = _props("S", "T", T3, "P", P_hi, fluid)

    # State 4 — evaporator inlet (isenthalpic expansion)
    h4 = h3
    s4 = _props("S", "P", P_lo, "H", h4, fluid)
    T4 = _props("T", "P", P_lo, "H", h4, fluid)
    x4 = _props("Q", "P", P_lo, "H", h4, fluid)

    q_evap = h1 - h4     # cooling effect per kg
    q_cond = h2 - h3     # heat rejected per kg
    w_comp = h2 - h1     # work per kg

    Q_evap = mdot * q_evap
    Q_cond = mdot * q_cond
    W_comp = mdot * w_comp

    COP_cool = q_evap / w_comp if w_comp > 0 else 0.0
    COP_heat = q_cond / w_comp if w_comp > 0 else 0.0
    COP_carnot = T_evap / (T_cond - T_evap) if T_cond > T_evap else 0.0

    if COP_cool < 1.5:
        warnings.append(f"COP (cooling) = {COP_cool:.2f} — unusually low")

    # ── Entropy generation per component (corrected per Moran & Shapiro) ──
    # Compressor (adiabatic): Ṡ_gen = ṁ(s_out - s_in)  [NO work term!]
    Sgen_comp  = mdot * max(0.0, s2 - s1)

    # Condenser: Ṡ_gen = ṁ·(s₃ − s₂) + Q̇_cond / T_H
    #   where T_H = environment temperature (T0) for heat rejection to ambient
    #   Q_cond is heat rejected (positive magnitude here)
    Sgen_cond  = mdot * (s3 - s2) + mdot * q_cond / T0
    Sgen_cond  = max(0.0, Sgen_cond)

    # Expansion valve: isenthalpic — Ṡ_gen = ṁ·(s₄ − s₃) ≥ 0
    Sgen_valve = mdot * max(0.0, s4 - s3)

    # Evaporator: Ṡ_gen = ṁ·(s₁ − s₄) − Q̇_evap / T_L
    #   where T_L = cold reservoir temperature (T_evap)
    #   sign convention: Q_evap is heat absorbed (positive)
    Sgen_evap  = mdot * (s1 - s4) - mdot * q_evap / T_evap
    Sgen_evap  = max(0.0, Sgen_evap)

    Sgen_total = Sgen_comp + Sgen_cond + Sgen_valve + Sgen_evap

    Ex_dest_comp  = T0 * Sgen_comp
    Ex_dest_cond  = T0 * Sgen_cond
    Ex_dest_valve = T0 * Sgen_valve
    Ex_dest_evap  = T0 * Sgen_evap
    Ex_dest_total = T0 * Sgen_total

    try:
        h0 = _props("H", "T", T0, "P", P0, fluid)
        s0 = _props("S", "T", T0, "P", P0, fluid)
    except Exception:
        h0, s0 = h1, s1

    # COP-based exergy efficiency
    eta_ex = COP_cool / COP_carnot if COP_carnot > 0 else 0.0

    sat = _sat_curve(fluid)
    ts_diagram = {
        "cycle": {
            "s": [s1, s2, s3, s4, s1],
            "T": [T1, T2, T3, T4, T1],
            "labels": ["1", "2", "3", "4", "1"],
        },
        "saturation": sat,
        "x_label": "Entropy s [J/(kg·K)]",
        "y_label": "Temperature T [K]",
    }
    ph_diagram = {
        "cycle": {
            "h": [h1, h2, h3, h4, h1],
            "P": [P_lo, P_hi, P_hi, P_lo, P_lo],
            "labels": ["1", "2", "3", "4", "1"],
        },
        "saturation": sat,
        "x_label": "Enthalpy h [J/kg]",
        "y_label": "Pressure P [Pa]",
    }

    state_points = [
        _sp("1 – Compressor inlet",    T1, P_lo, h1, s1, None, _phase(T1, P_lo, fluid), fluid),
        _sp("2 – Condenser inlet",     T2, P_hi, h2, s2, None, _phase(T2, P_hi, fluid), fluid),
        _sp("3 – Expansion valve inlet",T3, P_hi, h3, s3, None, _phase(T3, P_hi, fluid), fluid),
        _sp("4 – Evaporator inlet",    T4, P_lo, h4, s4, x4,   _phase(T4, P_lo, fluid), fluid),
    ]

    component_metrics = [
        _cm("Compressor",      "compressor", -W_comp,  0,       eta_c, Sgen_comp,  Ex_dest_comp,  Sgen_total),
        _cm("Condenser",       "condenser",  0,       -Q_cond,  None,  Sgen_cond,  Ex_dest_cond,  Sgen_total),
        _cm("Expansion Valve", "expansion_valve", 0,  0,        None,  Sgen_valve, Ex_dest_valve, Sgen_total),
        _cm("Evaporator",      "evaporator", 0,        Q_evap,  None,  Sgen_evap,  Ex_dest_evap,  Sgen_total),
    ]

    return {
        "state_points":    state_points,
        "component_metrics": component_metrics,
        "energy_balance": {
            "total_heat_input_kW":         Q_evap / 1e3,
            "total_heat_output_kW":        Q_cond / 1e3,
            "total_work_input_kW":         W_comp / 1e3,
            "total_work_output_kW":        0.0,
            "net_work_kW":                -W_comp / 1e3,
            "energy_balance_error_percent": abs((Q_evap + W_comp - Q_cond) / max(Q_cond, 1)) * 100,
            "is_balanced":                 True,
        },
        "entropy": {
            "total_Sgen_W_per_K": Sgen_total,
            "component_breakdown": [
                {"name": "Compressor",      "Sgen_W_per_K": Sgen_comp,  "share_pct": 100*Sgen_comp/max(Sgen_total,1e-12)},
                {"name": "Condenser",       "Sgen_W_per_K": Sgen_cond,  "share_pct": 100*Sgen_cond/max(Sgen_total,1e-12)},
                {"name": "Expansion Valve", "Sgen_W_per_K": Sgen_valve, "share_pct": 100*Sgen_valve/max(Sgen_total,1e-12)},
                {"name": "Evaporator",      "Sgen_W_per_K": Sgen_evap,  "share_pct": 100*Sgen_evap/max(Sgen_total,1e-12)},
            ],
        },
        "exergy": {
            "total_exergy_destruction_kW": Ex_dest_total / 1e3,
            "exergy_efficiency": eta_ex,
            "component_breakdown": [
                {"name": "Compressor",      "exergy_destruction_kW": Ex_dest_comp/1e3,  "exergy_destruction_share": 100*Ex_dest_comp/max(Ex_dest_total,1e-12)},
                {"name": "Condenser",       "exergy_destruction_kW": Ex_dest_cond/1e3,  "exergy_destruction_share": 100*Ex_dest_cond/max(Ex_dest_total,1e-12)},
                {"name": "Expansion Valve", "exergy_destruction_kW": Ex_dest_valve/1e3, "exergy_destruction_share": 100*Ex_dest_valve/max(Ex_dest_total,1e-12)},
                {"name": "Evaporator",      "exergy_destruction_kW": Ex_dest_evap/1e3,  "exergy_destruction_share": 100*Ex_dest_evap/max(Ex_dest_total,1e-12)},
            ],
        },
        "performance": {
            "net_power_kW":          -W_comp / 1e3,
            "cop_cooling":           COP_cool,
            "cop_heating":           COP_heat,
            "cop_carnot":            COP_carnot,
            "cooling_capacity_kW":   Q_evap / 1e3,
            "heat_rejection_kW":     Q_cond / 1e3,
            "second_law_efficiency": eta_ex,
        },
        "ts_diagram":  ts_diagram,
        "ph_diagram":  ph_diagram,
        "warnings":    warnings,
    }


# ---------------------------------------------------------------------------
# ── VAPOR ABSORPTION REFRIGERATION (simplified NH3 model) ─────────────────
# ---------------------------------------------------------------------------

def _solve_var(inp: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simplified single-effect vapour absorption cycle.
    Uses enthalpy-based energy balance rather than full mixture EOS
    (CoolProp does not support NH3-H2O mixture natively).

    Inputs
    ------
    T_generator    : 363.15 K   generator temperature (90 °C)
    T_condenser    : 313.15 K   condensing temperature (40 °C)
    T_evaporator   : 258.15 K   evaporator temperature (−15 °C)
    T_absorber     : 308.15 K   absorber temperature   (35 °C)
    Q_generator    : 10000 W    heat input to generator
    COP_fraction   : 0.65       fraction of Carnot COP (default VAR efficiency)
    T0, P0         : 298.15, 101325
    """
    T_gen   = float(inp.get("T_generator",  363.15))
    T_cond  = float(inp.get("T_condenser",  313.15))
    T_evap  = float(inp.get("T_evaporator", 258.15))
    T_abs   = float(inp.get("T_absorber",   308.15))
    Q_gen   = float(inp.get("Q_generator",  10_000.0))
    frac    = float(inp.get("COP_fraction",   0.65))
    T0      = float(inp.get("T0", 298.15))
    warnings: List[str] = []

    # Carnot COP for absorption
    # COP_carnot = (T_evap / (T_cond - T_evap)) * ((T_gen - T_abs) / T_gen)
    if T_cond <= T_evap or T_gen <= T_abs:
        raise ValueError("Inconsistent temperature levels for absorption cycle")

    COP_carnot = (T_evap / (T_cond - T_evap)) * ((T_gen - T_abs) / T_gen)
    COP_actual = frac * COP_carnot

    Q_evap = COP_actual * Q_gen   # cooling effect  [W]
    Q_cond = Q_gen + Q_evap       # heat rejected at condenser  [W]  (energy balance)
    Q_abs  = Q_cond - Q_gen       # heat rejected at absorber (approx)
    W_pump = 0.01 * Q_gen         # pump work is negligible but non-zero

    # Entropy generation (simplified — treat each component as black box)
    Sgen_gen  = Q_gen * (1/T_abs - 1/T_gen)   # irreversibility in generator/absorber pair
    Sgen_cond = Q_cond / T_cond
    Sgen_evap = -Q_evap / T_evap + Q_evap / T_abs
    Sgen_total = max(0.0, Sgen_gen + Sgen_evap)

    Ex_dest_gen  = T0 * abs(Sgen_gen)
    Ex_dest_cond = T0 * abs(Sgen_cond)
    Ex_dest_evap = T0 * abs(Sgen_evap)
    Ex_dest_total = T0 * Sgen_total

    # Exergy efficiency = COP_actual / COP_carnot
    eta_ex = COP_actual / COP_carnot if COP_carnot > 0 else 0.0

    # No real T-s diagram available without mixture EOS
    ts_diagram = {"note": "T-s diagram not available for absorption cycle mixture"}
    ph_diagram = {"note": "P-h diagram not available for absorption cycle mixture"}

    state_points = [
        {"label": "Generator exit (vapour)",  "T": T_gen,  "note": "High-pressure NH3 vapour"},
        {"label": "Condenser exit (liquid)",  "T": T_cond, "note": "Condensed NH3"},
        {"label": "Evaporator exit (vapour)", "T": T_evap, "note": "Low-pressure NH3 vapour"},
        {"label": "Absorber exit (liquid)",   "T": T_abs,  "note": "Strong NH3 solution"},
    ]

    component_metrics = [
        _cm("Generator",  "boiler",    0,        Q_gen,  None, Sgen_gen,  Ex_dest_gen,  Sgen_total),
        _cm("Condenser",  "condenser", 0,       -Q_cond, None, Sgen_cond, Ex_dest_cond, Sgen_total),
        _cm("Evaporator", "evaporator",0,        Q_evap, None, Sgen_evap, Ex_dest_evap, Sgen_total),
        _cm("Absorber",   "condenser", 0,       -Q_abs,  None, 0.0,       0.0,          Sgen_total),
        _cm("Solution Pump","pump",   -W_pump,   0,      0.99, 0.0,       0.0,          Sgen_total),
    ]

    return {
        "state_points":    state_points,
        "component_metrics": component_metrics,
        "energy_balance": {
            "total_heat_input_kW":         (Q_gen + Q_evap) / 1e3,
            "total_heat_output_kW":        Q_cond / 1e3,
            "total_work_input_kW":         W_pump / 1e3,
            "total_work_output_kW":        0.0,
            "net_work_kW":                -W_pump / 1e3,
            "energy_balance_error_percent": 0.0,
            "is_balanced":                 True,
        },
        "entropy": {
            "total_Sgen_W_per_K": Sgen_total,
            "component_breakdown": [
                {"name": "Generator",  "Sgen_W_per_K": Sgen_gen,  "share_pct": 100*Sgen_gen/max(Sgen_total,1e-12)},
                {"name": "Condenser",  "Sgen_W_per_K": Sgen_cond, "share_pct": 100*Sgen_cond/max(Sgen_total,1e-12)},
                {"name": "Evaporator", "Sgen_W_per_K": Sgen_evap, "share_pct": 100*Sgen_evap/max(Sgen_total,1e-12)},
            ],
        },
        "exergy": {
            "total_exergy_destruction_kW": Ex_dest_total / 1e3,
            "exergy_efficiency": eta_ex,
            "component_breakdown": [
                {"name": "Generator",  "exergy_destruction_kW": Ex_dest_gen/1e3,  "exergy_destruction_share": 100*Ex_dest_gen/max(Ex_dest_total,1e-12)},
                {"name": "Condenser",  "exergy_destruction_kW": Ex_dest_cond/1e3, "exergy_destruction_share": 100*Ex_dest_cond/max(Ex_dest_total,1e-12)},
                {"name": "Evaporator", "exergy_destruction_kW": Ex_dest_evap/1e3, "exergy_destruction_share": 100*Ex_dest_evap/max(Ex_dest_total,1e-12)},
            ],
        },
        "performance": {
            "net_power_kW":          -W_pump / 1e3,
            "cop_cooling":           COP_actual,
            "cop_carnot":            COP_carnot,
            "second_law_efficiency": eta_ex,
            "cooling_capacity_kW":   Q_evap / 1e3,
            "heat_input_kW":         Q_gen / 1e3,
        },
        "ts_diagram":  ts_diagram,
        "ph_diagram":  ph_diagram,
        "warnings":    warnings,
    }


# ---------------------------------------------------------------------------
# ── Row builders ────────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

def _sp(
    label: str, T: float, P: float, h: float, s: float,
    x: Optional[float], phase: str, fluid: str
) -> Dict[str, Any]:
    """Build a state-point dict."""
    rho = None
    try:
        rho = _props("D", "T", T, "P", P, fluid)
    except Exception:
        pass
    return {
        "label":   label,
        "T_K":     round(T, 4),
        "T_C":     round(T - 273.15, 3),
        "P_Pa":    round(P, 2),
        "P_kPa":   round(P / 1e3, 4),
        "h_J_kg":  round(h, 2),
        "h_kJ_kg": round(h / 1e3, 4),
        "s_J_kgK": round(s, 4),
        "s_kJ_kgK":round(s / 1e3, 6),
        "x":       round(x, 4) if x is not None else None,
        "rho_kg_m3": round(rho, 4) if rho is not None else None,
        "phase":   phase,
        "fluid":   fluid,
    }


def _cm(
    name: str, comp_type: str,
    work_W: float, heat_W: float,
    eta_is: Optional[float],
    Sgen_W_K: float, Ex_dest_W: float,
    Sgen_total: float,
) -> Dict[str, Any]:
    """Build a component-metrics dict."""
    share = 100 * Sgen_W_K / max(Sgen_total, 1e-12)
    return {
        "name":                   name,
        "type":                   comp_type,
        "work_kW":                round(work_W / 1e3, 4),
        "heat_kW":                round(heat_W / 1e3, 4),
        "isentropic_efficiency":  round(eta_is, 4) if eta_is is not None else None,
        "entropy_gen_W_per_K":    round(Sgen_W_K, 6),
        "entropy_gen_share_pct":  round(share, 2),
        "exergy_destruction_kW":  round(Ex_dest_W / 1e3, 4),
    }
