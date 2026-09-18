"""
ThermoBird v2 — Transient ODE Solver

Solves the coupled ODE system formed by all component models.
Returns time-series arrays for all state variables plus computed
thermodynamic derived quantities (energy, exergy, entropy generation).
"""
from __future__ import annotations
import time
import logging
import numpy as np
import re
from typing import Any
from typing import Literal
from typing import cast
from scipy.integrate import solve_ivp

from .component_models import get_model
from . import thermo_utils as tu


logger = logging.getLogger(__name__)
VALID_METHODS = {"RK45", "Radau", "BDF", "LSODA", "DOP853"}
SolverMethod = Literal["RK45", "Radau", "BDF", "LSODA", "DOP853"]


def _auto_select(config: dict) -> str:
    """Pick Radau for stiff systems (large thermal masses), LSODA otherwise."""
    for cc in config.get("components", []):
        p = cc.get("params", {})
        if (
            float(p.get("mass_wall",  p.get("wall_mass",  0.0))) > 500
            or float(p.get("mass_fluid", p.get("fluid_mass", 0.0))) > 200
        ):
            return "Radau"
    return "LSODA"


def solve_transient(config: dict[str, Any]) -> dict[str, Any]:
    """
    Run the transient thermodynamic simulation.

    Config keys
    -----------
    fluid            : str   — CoolProp fluid name (default 'Water')
    t_span           : [t0, t_end]   — seconds
    t_eval_steps     : int   — output points (default 300)
    T0, P0           : float — dead-state conditions (K, Pa)
    rtol, atol       : float — ODE tolerances
    solver_method    : str   — 'Auto' | 'Radau' | 'RK45' | 'BDF' | 'LSODA'
    components       : list  — [{type, params, initial_conditions}, ...]

    Returns
    -------
    {success, t, variables, derived, metadata, errors}
    """
    t0_wall = time.time()
    errors: list[str] = []

    fluid      = config.get("fluid", "Water")
    t_span     = config.get("t_span", [0.0, 600.0])
    n_steps    = int(config.get("t_eval_steps", 300))
    T0         = float(config.get("T0", 298.15))
    P0         = float(config.get("P0", 101_325.0))
    rtol       = float(config.get("rtol", 1e-4))
    atol       = float(config.get("atol", 1e-6))

    # Solver method
    raw_method = str(config.get("solver_method", "Auto")).strip()
    if raw_method == "Auto":
        method: SolverMethod = cast(SolverMethod, _auto_select(config))
    elif raw_method in VALID_METHODS:
        method = cast(SolverMethod, raw_method)
    else:
        method = "Radau"
        errors.append(f"Unknown solver '{raw_method}', defaulted to Radau.")

    component_configs: list[dict] = config.get("components", [])
    if not component_configs:
        return _err("No components provided.")

    # ── Build component instances + assemble y0 ───────────────────────────────
    models:    list[tuple] = []   # (component_id, component_type, model_instance, params_dict)
    var_names: list[str]   = []
    y0:        list[float] = []
    used_var_names: dict[str, int] = {}

    for idx, cc in enumerate(component_configs):
        try:
            model = get_model(cc["type"])
        except ValueError as e:
            return _err(str(e))

        comp_id = str(cc.get("id") or f"{cc['type']}_{idx}")
        p  = cc.get("params", {})
        ic = cc.get("initial_conditions", {})
        models.append((comp_id, cc["type"], model, p))

        for var in model.state_vars:
            base = f"{comp_id}.{var}"
            cnt = used_var_names.get(base, 0)
            used_var_names[base] = cnt + 1
            var_name = base if cnt == 0 else f"{base}#{cnt+1}"
            var_names.append(var_name)
            y0.append(float(ic.get(var, _default_ic(var))))

    connections = _normalize_connections(config.get("connections", []))

    # ── Assemble ODE rhs ──────────────────────────────────────────────────────
    # CoolProp calls are expensive. We cache the topology-coupling snapshot and
    # only refresh it when the state vector has changed meaningfully (relative
    # change > 0.1 %).  This avoids calling PropsSI thousands of times per step
    # during Radau's internal iteration — the primary cause of the 30-min hang.
    _coupling_cache: dict = {"coupled": {}, "y_ref": None}

    def _get_coupled_params(y: np.ndarray) -> dict[str, dict]:
        y_ref = _coupling_cache["y_ref"]
        if y_ref is None or not np.allclose(y, y_ref, rtol=1e-3, atol=1e-6):
            snaps = _component_output_snapshot(models, y, fluid)
            coupled = _apply_topology_coupling(models, snaps, connections)
            _coupling_cache["coupled"] = coupled
            _coupling_cache["y_ref"] = y.copy()
        return _coupling_cache["coupled"]

    def rhs(t: float, y: np.ndarray) -> np.ndarray:
        out: list[float] = []
        offset = 0
        coupled_params = _get_coupled_params(y)
        for comp_id, _ctype, model, _params in models:
            n = len(model.state_vars)
            yi = y[offset : offset + n].tolist()
            try:
                deriv = model.dydt(t, yi, coupled_params.get(comp_id, _params), fluid)
            except Exception as e:
                logger.warning(f"Model {model.__class__.__name__} failed at t={t:.2f}: {e}")
                deriv = [0.0] * n
            out.extend(deriv)
            offset += n
        return np.array(out, dtype=float)

    # ── Solve ─────────────────────────────────────────────────────────────────
    t_span_tuple = (float(t_span[0]), float(t_span[1]))
    t_eval = np.linspace(t_span_tuple[0], t_span_tuple[1], n_steps)
    y0_arr = np.array(y0, dtype=float)

    # Cap max_step to 1 % of total span so adaptive solvers don't attempt
    # enormous strides (which forces many rejected micro-steps on stiff systems).
    span_len = t_span_tuple[1] - t_span_tuple[0]
    max_step = max(span_len / 100.0, 1.0)

    try:
        sol = solve_ivp(
            rhs,
            t_span_tuple,
            y0_arr,
            method=method,
            t_eval=t_eval,
            rtol=rtol,
            atol=atol,
            dense_output=False,
            max_step=max_step,
        )
    except Exception as exc:
        return _err(f"ODE solver raised: {exc}")

    if not sol.success:
        errors.append(f"Solver did not converge: {sol.message}")

    sol_data = cast(Any, sol)

    # ── Unpack state arrays ───────────────────────────────────────────────────
    variables: dict[str, list[float]] = {}
    for i, name in enumerate(var_names):
        variables[name] = sol_data.y[i].tolist()

    # ── Derived thermodynamic quantities ──────────────────────────────────────
    derived, derived_errors = _compute_derived_generic(sol_data.t, sol_data.y, models, connections, fluid, T0, P0)
    errors.extend(derived_errors)

    elapsed_ms = int((time.time() - t0_wall) * 1000)

    return {
        "success":   sol.success and len(errors) == 0,
        "t":         sol_data.t.tolist(),
        "variables": variables,
        "derived":   derived,
        "metadata": {
            "fluid":          fluid,
            "t_span":         list(t_span),
            "n_steps":        len(sol_data.t),
            "solver_nfev":    int(sol_data.nfev),
            "execution_ms":   elapsed_ms,
            "solver_message": sol.message,
            "solver_method":  method,
        },
        "errors": errors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Derived quantities — full second-law analysis at each time step
# ─────────────────────────────────────────────────────────────────────────────

def _compute_derived(
    t_arr: np.ndarray,
    variables: dict[str, list[float]],
    config: dict,
    fluid: str,
    T0: float,
    P0: float,
) -> tuple[dict[str, list[float]], list[str]]:
    """
    Compute first-law and second-law quantities across the simulation.

    Requires at minimum:
      - T_fluid_boiler   (boiler fluid temperature, K)
      - T_fluid_condenser (condenser fluid temperature, K)

    Uses the instantaneous boiler temperature as turbine inlet and
    applies the Rankine cycle equations at each timestep.
    
    Returns:
        (derived_dict, list_of_errors)
    """
    errors: list[str] = []
    T_fb = variables.get("T_fluid_boiler")
    T_fc = variables.get("T_fluid_condenser")

    # Without these two we can't compute cycle quantities
    if T_fb is None or T_fc is None:
        missing = []
        if T_fb is None:
            missing.append("T_fluid_boiler (boiler component)")
        if T_fc is None:
            missing.append("T_fluid_condenser (condenser component)")
        errors.append(f"Missing required state variables: {', '.join(missing)}")
        
        # Return NaN-filled arrays instead of empty dict
        n = len(t_arr)
        nan_list = [float('nan')] * n
        return _nan_derived(n), errors

    # Component parameters
    comp_map: dict[str, dict] = {}
    for cc in config.get("components", []):
        comp_map[cc["type"]] = cc.get("params", {})

    bp  = comp_map.get("boiler",    {})
    tp  = comp_map.get("turbine",   {})
    cp_ = comp_map.get("condenser", {})
    pp  = comp_map.get("pump",      {})

    m_dot = float(bp.get("mass_flow",        2.5))
    P_hi  = float(bp.get("P_Pa",             3_000_000.0))
    P_lo  = float(cp_.get("P_Pa",            10_000.0))
    eta_t = float(tp.get("eta_isentropic",   0.85))
    eta_p = float(pp.get("eta_isentropic",   0.80))
    T_src = float(bp.get("T_source_K",  bp.get("T_source",  900.0)))
    T_snk = float(cp_.get("T_sink_K",  cp_.get("T_sink",    298.15)))
    
    # Optional heat losses to ambient (default to 0 for adiabatic assumption)
    Q_loss_t = float(tp.get("heat_loss_W", 0.0))
    Q_loss_p = float(pp.get("heat_loss_W", 0.0))

    try:
        h0, s0 = tu.dead_state(T0, P0, fluid)
    except Exception as e:
        logger.warning(f"Failed to compute dead state: {e}")
        h0, s0 = 0.0, 0.0

    n = len(t_arr)

    # Preallocate result lists
    eta_th_l, eta_ex_l = [], []
    Sg_t_l, Sg_b_l, Sg_c_l, Sg_p_l, Sg_tot_l = [], [], [], [], []
    Xd_t_l, Xd_b_l, Xd_c_l, Xd_p_l = [], [], [], []
    W_net_l, W_t_l, W_p_l, Q_in_l, Q_out_l = [], [], [], [], []

    from CoolProp.CoolProp import PropsSI

    for i in range(n):
        try:
            T1 = max(float(T_fb[i]), 282.0)   # boiler exit = turbine inlet
            T3 = max(float(T_fc[i]), 282.0)   # condenser exit temperature

            # ── State 1: turbine inlet (boiler exit) ─────────────────────────
            h1 = PropsSI("H", "T", T1, "P", P_hi, fluid)
            s1 = PropsSI("S", "T", T1, "P", P_hi, fluid)

            # ── State 2: turbine exit ────────────────────────────────────────
            h2s = PropsSI("H", "P", P_lo, "S", s1, fluid)  # isentropic
            h2  = h1 - eta_t * (h1 - h2s)                  # actual
            s2  = PropsSI("S", "P", P_lo, "H", h2, fluid)

            # ── State 3: condenser exit (saturated liquid) ───────────────────
            T3_sat = PropsSI("T", "P", P_lo, "Q", 0, fluid)
            h3 = PropsSI("H", "P", P_lo, "Q", 0, fluid)
            s3 = PropsSI("S", "P", P_lo, "Q", 0, fluid)

            # ── State 4: pump exit ───────────────────────────────────────────
            rho3 = PropsSI("D", "P", P_lo, "Q", 0, fluid)
            v3   = 1.0 / rho3
            w_ps = v3 * (P_hi - P_lo)       # isentropic pump work [J/kg]
            w_p  = w_ps / eta_p             # actual
            h4   = h3 + w_p
            s4   = PropsSI("S", "P", P_hi, "H", h4, fluid)

            # ── Energy quantities ────────────────────────────────────────────
            q_in  = h1 - h4        # J/kg heat added in boiler
            q_out = h2 - h3        # J/kg heat rejected in condenser
            w_t   = h1 - h2        # J/kg turbine work
            w_net = w_t - w_p      # J/kg net work

            Q_in  = m_dot * q_in   # W
            Q_out = m_dot * q_out  # W
            W_t   = m_dot * w_t    # W
            W_p   = m_dot * w_p    # W
            W_net = m_dot * w_net  # W

            eta_th = w_net / q_in if q_in > 10.0 else 0.0

            # ── Entropy generation (Gouy-Stodola) ────────────────────────────
            # Turbine: irreversibility from friction + optional heat loss
            # S_gen = ṁ(s_out - s_in) + Q_loss/T_ambient (for non-adiabatic)
            Sg_t = m_dot * (s2 - s1) + Q_loss_t / T0
            _validate_second_law("turbine", Sg_t, i, t_arr[i], errors)

            # Boiler: heat transfer across ΔT = T_source − T_fluid
            # S_gen = ṁ(s_out - s_in) - Q_in/T_source
            Sg_b = m_dot * (s1 - s4) - Q_in / T_src
            _validate_second_law("boiler", Sg_b, i, t_arr[i], errors)

            # Condenser: heat rejection to cold reservoir
            # S_gen = ṁ(s_out - s_in) + Q_out/T_sink
            Sg_c = m_dot * (s3 - s2) + Q_out / T_snk
            _validate_second_law("condenser", Sg_c, i, t_arr[i], errors)

            # Pump: irreversibility from pressure rise + optional heat loss
            # S_gen = ṁ(s_out - s_in) + Q_loss/T_ambient (for non-adiabatic)
            Sg_p = m_dot * (s4 - s3) + Q_loss_p / T0
            _validate_second_law("pump", Sg_p, i, t_arr[i], errors)

            Sg_tot = Sg_t + Sg_b + Sg_c + Sg_p
            _validate_second_law("total", Sg_tot, i, t_arr[i], errors)

            # ── Exergy destruction = T0 × Ṡ_gen ─────────────────────────────
            Xd_t = T0 * Sg_t
            Xd_b = T0 * Sg_b
            Xd_c = T0 * Sg_c
            Xd_p = T0 * Sg_p

            # ── Exergy efficiency ─────────────────────────────────────────────
            # Exergy input = thermal exergy of boiler heat
            ex_in = Q_in * (1.0 - T0 / T_src) if T_src > T0 else 0.0
            eta_ex = W_net / ex_in if ex_in > 10.0 else 0.0

            # ── Append (convert W → kW for display) ──────────────────────────
            eta_th_l.append(round(eta_th, 5))
            eta_ex_l.append(round(eta_ex, 5))

            Sg_t_l.append(round(Sg_t / 1000, 6))    # kW/K
            Sg_b_l.append(round(Sg_b / 1000, 6))
            Sg_c_l.append(round(Sg_c / 1000, 6))
            Sg_p_l.append(round(Sg_p / 1000, 6))
            Sg_tot_l.append(round(Sg_tot / 1000, 6))

            Xd_t_l.append(round(Xd_t / 1000, 4))    # kW
            Xd_b_l.append(round(Xd_b / 1000, 4))
            Xd_c_l.append(round(Xd_c / 1000, 4))
            Xd_p_l.append(round(Xd_p / 1000, 4))

            W_net_l.append(round(W_net / 1000, 4))
            W_t_l.append(round(W_t   / 1000, 4))
            W_p_l.append(round(W_p   / 1000, 4))
            Q_in_l.append(round(Q_in  / 1000, 4))
            Q_out_l.append(round(Q_out / 1000, 4))

        except Exception as e:
            # Log error and fill with NaN (not zero!) for this timestep
            logger.warning(f"CoolProp/thermo failure at timestep {i}, t={t_arr[i]:.2f}s: {e}")
            eta_th_l.append(float('nan'))
            eta_ex_l.append(float('nan'))
            Sg_t_l.append(float('nan'))
            Sg_b_l.append(float('nan'))
            Sg_c_l.append(float('nan'))
            Sg_p_l.append(float('nan'))
            Sg_tot_l.append(float('nan'))
            Xd_t_l.append(float('nan'))
            Xd_b_l.append(float('nan'))
            Xd_c_l.append(float('nan'))
            Xd_p_l.append(float('nan'))
            W_net_l.append(float('nan'))
            W_t_l.append(float('nan'))
            W_p_l.append(float('nan'))
            Q_in_l.append(float('nan'))
            Q_out_l.append(float('nan'))

    return {
        "eta_thermal":        eta_th_l,
        "eta_exergy":         eta_ex_l,
        "Sgen_turbine_kW_K":  Sg_t_l,
        "Sgen_boiler_kW_K":   Sg_b_l,
        "Sgen_condenser_kW_K":Sg_c_l,
        "Sgen_pump_kW_K":     Sg_p_l,
        "Sgen_total_kW_K":    Sg_tot_l,
        "Xdest_turbine_kW":   Xd_t_l,
        "Xdest_boiler_kW":    Xd_b_l,
        "Xdest_condenser_kW": Xd_c_l,
        "Xdest_pump_kW":      Xd_p_l,
        "W_net_kW":           W_net_l,
        "W_turbine_kW":       W_t_l,
        "W_pump_kW":          W_p_l,
        "Q_in_kW":            Q_in_l,
        "Q_out_kW":           Q_out_l,
    }, errors


def _validate_second_law(component: str, s_gen: float, timestep: int, t: float, errors: list[str]) -> float:
    """
    Validate that entropy generation satisfies the 2nd Law (S_gen >= 0).
    
    Args:
        component: Component name for logging
        s_gen: Computed entropy generation rate (W/K)
        timestep: Index of current timestep
        t: Current time (s)
        errors: List to append warnings to
        
    Returns:
        Validated (non-negative) entropy generation rate
    """
    TOLERANCE = 1e-6  # Numerical tolerance for floating-point errors
    
    if s_gen < -TOLERANCE:
        msg = f"2nd Law violation: S_gen_{component}={s_gen:.6f} W/K < 0 at t={t:.2f}s"
        logger.warning(msg)
        # Only log unique errors (avoid flooding)
        if len(errors) < 10 or not any(msg in e for e in errors[-10:]):
            errors.append(msg)
        return 0.0  # Clamp to zero only for numerical errors
    
    return max(0.0, s_gen)  # Ensure non-negative


def _nan_derived(n: int) -> dict[str, list[float]]:
    """Return derived dict filled with NaN values."""
    nan_list = [float('nan')] * n
    return {
        "eta_thermal":        nan_list.copy(),
        "eta_exergy":         nan_list.copy(),
        "Sgen_turbine_kW_K":  nan_list.copy(),
        "Sgen_boiler_kW_K":   nan_list.copy(),
        "Sgen_condenser_kW_K":nan_list.copy(),
        "Sgen_pump_kW_K":     nan_list.copy(),
        "Sgen_total_kW_K":    nan_list.copy(),
        "Xdest_turbine_kW":   nan_list.copy(),
        "Xdest_boiler_kW":    nan_list.copy(),
        "Xdest_condenser_kW": nan_list.copy(),
        "Xdest_pump_kW":      nan_list.copy(),
        "W_net_kW":           nan_list.copy(),
        "W_turbine_kW":       nan_list.copy(),
        "W_pump_kW":          nan_list.copy(),
        "Q_in_kW":            nan_list.copy(),
        "Q_out_kW":           nan_list.copy(),
    }


def _safe_id(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_") or "component"


def _normalize_connections(raw_connections: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for c in raw_connections or []:
        from_id = c.get("from") or c.get("from_id")
        to_id = c.get("to") or c.get("to_id")
        if not from_id or not to_id:
            continue
        out.append(
            {
                "from": str(from_id),
                "to": str(to_id),
                "from_port": str(c.get("from_port") or "outlet"),
                "to_port": str(c.get("to_port") or "inlet"),
            }
        )
    return out


def _component_output_snapshot(
    models: list[tuple],
    y: np.ndarray,
    fluid: str,
    params_override: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, float]]:
    outputs: dict[str, dict[str, float]] = {}
    offset = 0
    for comp_id, _ctype, model, params in models:
        n = len(model.state_vars)
        yi = y[offset: offset + n].tolist()
        offset += n
        p = (params_override or {}).get(comp_id, params)
        try:
            outputs[comp_id] = model.compute_outputs(0.0, yi, p, fluid) or {}
        except Exception:
            outputs[comp_id] = {}
    return outputs


def _apply_topology_coupling(models: list[tuple], outputs: dict[str, dict[str, float]], connections: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    params_by_id: dict[str, dict[str, Any]] = {comp_id: dict(params) for comp_id, _ct, _m, params in models}
    for conn in connections:
        src = conn["from"]
        dst = conn["to"]
        src_out = outputs.get(src) or {}
        dst_params = params_by_id.get(dst)
        if dst_params is None:
            continue

        # Generic inlet propagation
        if "T_out" in src_out:
            dst_params["T_in_K"] = float(src_out["T_out"])
            dst_params["T_in"] = float(src_out["T_out"])
        if "P_out" in src_out:
            dst_params["P_in_Pa"] = float(src_out["P_out"])
            dst_params["P_in"] = float(src_out["P_out"])
        if "h_out" in src_out:
            dst_params["h_inlet"] = float(src_out["h_out"])
        if "s_out" in src_out:
            dst_params["s_inlet"] = float(src_out["s_out"])

        # Preserve any explicit mass-flow assignment unless missing.
        if "mass_flow" not in dst_params and "mass_flow" in src_out:
            dst_params["mass_flow"] = float(src_out["mass_flow"])

    return params_by_id


def _compute_derived_generic(
    t_arr: np.ndarray,
    y_arr: np.ndarray,
    models: list[tuple],
    connections: list[dict[str, str]],
    fluid: str,
    T0: float,
    _P0: float,
) -> tuple[dict[str, list[float]], list[str]]:
    """Compute component/system thermodynamic metrics from actual transient topology."""
    errors: list[str] = []
    n_steps = len(t_arr)
    if n_steps == 0:
        return {}, []

    component_ids = [comp_id for comp_id, _ct, _m, _p in models]
    q_series = {cid: [] for cid in component_ids}
    sgen_series = {cid: [] for cid in component_ids}
    xdest_series = {cid: [] for cid in component_ids}

    eta_thermal: list[float] = []
    eta_exergy: list[float] = []
    q_in_kW: list[float] = []
    q_out_kW: list[float] = []
    w_net_kW: list[float] = []
    sgen_total_kW_K: list[float] = []
    xdest_total_kW: list[float] = []

    for step_idx in range(n_steps):
        y = y_arr[:, step_idx]
        # Single snapshot pass — compute outputs once, then apply coupling,
        # then refresh outputs with the coupled params (avoids double CoolProp round-trip).
        snapshots = _component_output_snapshot(models, y, fluid)
        coupled_params = _apply_topology_coupling(models, snapshots, connections)
        # Refresh only components whose params changed due to coupling
        for comp_id, _ctype, model, params in models:
            if comp_id in coupled_params and coupled_params[comp_id] != params:
                try:
                    n = len(model.state_vars)
                    offset = sum(len(m.state_vars) for _, _, m, _ in models[:models.index((comp_id, _ctype, model, params))])
                    yi = y[offset: offset + n].tolist()
                    snapshots[comp_id] = model.compute_outputs(0.0, yi, coupled_params[comp_id], fluid) or {}
                except Exception:
                    pass

        total_q_in = 0.0
        total_q_out = 0.0
        total_w = 0.0
        total_sgen = 0.0
        exergy_in = 0.0

        for comp_id, _ctype, _model, params in models:
            p = coupled_params.get(comp_id, params)
            out = snapshots.get(comp_id, {})

            m_dot = float(p.get("mass_flow", p.get("m_dot", 1.0)) or 1.0)
            h_in = float(p.get("h_inlet", 0.0))
            h_out = float(out.get("h_out", h_in))
            s_in = float(p.get("s_inlet", 0.0))
            s_out = float(out.get("s_out", s_in))

            w_out = float(out.get("W_out", p.get("W_out", 0.0)) or 0.0)
            w_in = float(out.get("W_in", p.get("W_in", 0.0)) or 0.0)
            net_w = w_out - w_in
            total_w += net_w

            q_dot = m_dot * (h_out - h_in) + net_w
            q_series[comp_id].append(q_dot / 1000.0)

            if q_dot >= 0:
                total_q_in += q_dot
                t_boundary = float(p.get("T_source", p.get("T_source_K", out.get("T_out", T0 + 1.0))))
                if t_boundary > T0 + 1e-9:
                    exergy_in += q_dot * (1.0 - T0 / t_boundary)
            else:
                total_q_out += -q_dot

            t_boundary = float(
                p.get("T_source", p.get("T_source_K", p.get("T_sink", p.get("T_sink_K", out.get("T_out", T0)))))
            )
            if t_boundary <= 1e-9:
                t_boundary = T0
            sgen = m_dot * (s_out - s_in) - (q_dot / t_boundary)
            if sgen < -1e-6 and len(errors) < 20:
                errors.append(f"2nd-law warning at t={float(t_arr[step_idx]):.2f}s for {comp_id}: Sgen={sgen:.3e} W/K")
            sgen = max(sgen, 0.0)
            sgen_series[comp_id].append(sgen / 1000.0)

            xdest = T0 * sgen
            xdest_series[comp_id].append(xdest / 1000.0)
            total_sgen += sgen

        q_in_kW.append(total_q_in / 1000.0)
        q_out_kW.append(total_q_out / 1000.0)
        w_net_kW.append(total_w / 1000.0)
        sgen_total_kW_K.append(total_sgen / 1000.0)
        xdest_total_kW.append(T0 * total_sgen / 1000.0)

        eta_thermal.append((total_w / total_q_in) if total_q_in > 1e-9 else float("nan"))
        eta_exergy.append((total_w / exergy_in) if exergy_in > 1e-9 else float("nan"))

    derived: dict[str, list[float]] = {
        "eta_thermal": eta_thermal,
        "eta_exergy": eta_exergy,
        "Q_in_kW": q_in_kW,
        "Q_out_kW": q_out_kW,
        "W_net_kW": w_net_kW,
        "Sgen_total_kW_K": sgen_total_kW_K,
        "Xdest_total_kW": xdest_total_kW,
    }

    for cid in component_ids:
        key = _safe_id(cid)
        derived[f"Q_{key}_kW"] = q_series[cid]
        derived[f"Sgen_{key}_kW_K"] = sgen_series[cid]
        derived[f"Xdest_{key}_kW"] = xdest_series[cid]

    return derived, errors


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _default_ic(var_name: str) -> float:
    """Sensible initial conditions if user doesn't provide them."""
    defaults = {
        "T_fluid_boiler":    320.0,
        "T_wall_boiler":     330.0,
        "T_fluid_condenser": 310.0,
        "T_pump_out":        320.0,
        "omega_turbine":     314.16,  # 50 Hz, 2-pole
    }
    return defaults.get(var_name, 300.0)


def _err(msg: str) -> dict:
    return {
        "success":   False,
        "errors":    [msg],
        "t":         [],
        "variables": {},
        "derived":   {},
        "metadata":  {},
    }
