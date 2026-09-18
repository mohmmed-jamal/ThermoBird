"""
SimulationService — async, loads DB records, builds engine inputs,
runs the cycle solver, persists and returns results.
"""
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.simulation import (
    Simulation, SimulationComponent, SimulationConnection, SimulationResult
)
from app.core.cycle_engine import run_full_analysis


# Reusable load options — eagerly loads every relationship we touch
_SIM_LOAD_OPTIONS = [
    selectinload(Simulation.components).selectinload(
        SimulationComponent.outgoing_connections
    ),
    selectinload(Simulation.components).selectinload(
        SimulationComponent.incoming_connections
    ),
    selectinload(Simulation.connections),
    selectinload(Simulation.results),
]

# ---------------------------------------------------------------------------
# Parameter-name mapping
# ---------------------------------------------------------------------------
# The canvas PropertiesPanel stores parameters under UI-friendly key names
# (e.g. "eta_isentropic", "outlet_P", "T_source").  The cycle engine expects
# cycle-level keys (e.g. "eta_pump", "P_boiler", "T_superheat").
#
# This map converts  component_type → {canvas_key: engine_key}
# so that user-set values actually reach the solver.
# ---------------------------------------------------------------------------

_PARAM_MAP: Dict[str, Dict[str, str]] = {
    # ── Rankine / ORC components ─────────────────────────────────────────
    "pump": {
        "eta_isentropic": "eta_pump",
        "inlet_P":        "P_condenser",    # pump inlet = condenser pressure
        "outlet_P":       "P_boiler",       # pump outlet = boiler pressure
    },
    "turbine": {
        "eta_isentropic": "eta_turbine",
        "inlet_T":        "T_superheat",    # turbine inlet temperature
        "inlet_P":        "P_boiler",       # turbine inlet pressure = boiler
        "outlet_P":       "P_condenser",    # turbine exit pressure  = condenser
    },
    "boiler": {
        "T_source":  "T_superheat",         # heat source → turbine inlet temperature
        "outlet_T":  "T_superheat",         # explicit outlet temperature
        "outlet_P":  "P_boiler",            # boiler operating pressure
    },
    "condenser": {
        "T_sink":    None,                   # informational only — not a direct engine param
        "outlet_x":  None,                   # informational only
        "outlet_P":  "P_condenser",         # condensing pressure → engine P_condenser
    },
    "evaporator": {
        "T_source":  "T_evaporator",        # refrigerated-space temperature
        "outlet_x":  None,
        "outlet_P":  None,
    },

    # ── Brayton components ───────────────────────────────────────────────
    # NOTE: inlet_P / outlet_P are stored in kPa by the UI → must ×1000 → Pa
    # before reaching the engine. Conversion is handled in _map_component_params.
    "compressor": {
        "eta_isentropic": "eta_compressor",
        "inlet_T":        "T_inlet",
        "inlet_P":        "P_inlet",        # kPa → Pa applied below
        "pressure_ratio": "pressure_ratio",
    },

    # ── VCR components ───────────────────────────────────────────────────
    # Evaporator is already mapped above.
    # Condenser in VCR → T_condenser for the VCR solver
    # (We detect VCR via cycle_type so condenser maps differently there.)

    "expansion_valve": {
        "inlet_P":  None,   # isenthalpic — no direct engine param
        "outlet_P": None,
        "inlet_T":  None,
    },

    "heat_exchanger": {
        "effectiveness": "effectiveness",
        "T_hot_in":      None,
        "T_cold_in":     None,
        "P_hot":         None,
        "P_cold":        None,
    },
    "regenerator": {
        "effectiveness":       "regen_effectiveness",
        "pressure_drop_hot":   None,
        "pressure_drop_cold":  None,
    },
    "mixing_chamber": {
        "outlet_quality":  None,
        "pressure_drop":   None,
        "mass_flow_1":     None,
        "mass_flow_2":     None,
    },
}

# VCR-specific overrides: when cycle_type is vapor_compression the condenser
# maps to T_condenser (not P_condenser used in Rankine).
_VCR_PARAM_MAP: Dict[str, Dict[str, str]] = {
    "condenser": {
        "T_sink":   "T_condenser",
        "outlet_P": None,
        "outlet_x": None,
    },
    "evaporator": {
        "T_source": "T_evaporator",
        "outlet_x": None,
        "outlet_P": None,
    },
    "compressor": {
        "eta_isentropic": "eta_compressor",
        "inlet_T":        None,
        "inlet_P":        None,
        "pressure_ratio": None,
    },
}


def _map_component_params(
    comp_type: str,
    raw_params: Dict[str, Any],
    cycle_type: str,
) -> Dict[str, Any]:
    """
    Convert canvas parameter names → engine parameter names for one component.

    Rules
    -----
    1.  Look up the component's mapping table (VCR-specific overrides take priority).
    2.  For each canvas key → engine key pair:
          - If engine key is None → skip (informational-only parameter).
          - If engine key is set  → add to output dict.
    3.  Unrecognised canvas keys that look like direct engine keys are passed through
        unchanged (forward-compatible fallback).
    4.  Pressure canvas keys (inlet_P, outlet_P, P_hot, P_cold, pressure_drop*) are
        stored in kPa by the UI → multiply × 1000 to give Pa for the engine.
    """
    is_vcr = cycle_type in ("vapor_compression", "refrigeration")

    # Choose the right mapping table
    if is_vcr and comp_type in _VCR_PARAM_MAP:
        mapping = _VCR_PARAM_MAP[comp_type]
    else:
        mapping = _PARAM_MAP.get(comp_type, {})

    # Canvas pressure keys that are stored in kPa → need ×1000 → Pa for engine
    KPA_KEYS = {"inlet_P", "outlet_P", "P_hot", "P_cold", "pressure_drop_hot", "pressure_drop_cold"}

    out: Dict[str, Any] = {}
    for canvas_key, val in raw_params.items():
        if val is None:
            continue

        # Apply kPa → Pa conversion for pressure fields
        if canvas_key in KPA_KEYS and isinstance(val, (int, float)):
            val = val * 1000.0

        if canvas_key in mapping:
            engine_key = mapping[canvas_key]
            if engine_key is not None:          # None means "informational, skip"
                out[engine_key] = val
        else:
            # Pass through as-is — may already be an engine key
            out[canvas_key] = val

    return out


class SimulationService:

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── public API ────────────────────────────────────────────────────────

    async def run_simulation(
        self,
        simulation_id:       int,
        ambient_temperature: float = 298.15,
        ambient_pressure:    float = 101_325.0,
        tolerance:           float = 0.01,
        max_iterations:      int   = 100,
    ) -> Dict[str, Any]:

        sim = await self._load_sim(simulation_id)
        if not sim:
            return self._error_response(simulation_id, 0, "Simulation not found")

        sim.status = "running"
        await self.db.commit()

        # Re-load after commit so relationships are fresh
        sim = await self._load_sim(simulation_id)

        try:
            inputs = self._build_inputs(sim, ambient_temperature, ambient_pressure)
            raw, exec_ms = run_full_analysis(inputs)

            if raw.get("success"):
                sim.status            = "completed"
                sim.execution_time_ms = exec_ms
                sim.completed_at      = datetime.utcnow()
                sim.error_message     = None
                await self._persist_results(sim, raw)
            else:
                sim.status            = "failed"
                sim.error_message     = raw.get("error_message", "Solver returned failure")
                sim.execution_time_ms = exec_ms

            await self.db.commit()
            return self._format_response(simulation_id, raw, exec_ms)

        except Exception as exc:
            sim.status        = "failed"
            sim.error_message = str(exc)
            await self.db.commit()
            return self._error_response(simulation_id, 0, str(exc))

    async def get_simulation_results(
        self, simulation_id: int
    ) -> Optional[Dict[str, Any]]:

        sim = await self._load_sim(simulation_id)
        if not sim or not sim.results:
            return None

        r = sim.results
        return {
            "simulation_id":      simulation_id,
            "success":            sim.status == "completed",
            "error_message":      sim.error_message,
            "execution_time_ms":  sim.execution_time_ms or 0,
            "net_power":          r.net_power_output,
            "thermal_efficiency": r.thermal_efficiency,
            "cop":                r.coefficient_of_performance,
            "exergy_efficiency":  r.exergy_efficiency,
            "energy_balance": {
                "heat_input":  r.heat_input_total,
                "heat_output": r.heat_rejected_total,
            },
            "warnings": [],
        }

    # ── DB helpers ────────────────────────────────────────────────────────

    async def _load_sim(self, simulation_id: int) -> Optional[Simulation]:
        """Load a Simulation with ALL relationships eagerly fetched."""
        result = await self.db.execute(
            select(Simulation)
            .where(Simulation.id == simulation_id)
            .options(*_SIM_LOAD_OPTIONS)
        )
        return result.scalar_one_or_none()

    async def _persist_results(self, sim: Simulation, raw: Dict[str, Any]) -> None:
        perf = raw.get("performance") or {}
        eb   = raw.get("energy_balance") or {}
        ex   = raw.get("exergy") or {}

        # Remove any stale result row
        existing_res = await self.db.execute(
            select(SimulationResult).where(SimulationResult.simulation_id == sim.id)
        )
        existing = existing_res.scalar_one_or_none()
        if existing:
            await self.db.delete(existing)
            await self.db.flush()

        result = SimulationResult(
            simulation_id              = sim.id,
            net_power_output           = perf.get("net_power_kW"),
            heat_input_total           = eb.get("total_heat_input_kW"),
            heat_rejected_total        = eb.get("total_heat_output_kW"),
            thermal_efficiency         = perf.get("thermal_efficiency"),
            coefficient_of_performance = perf.get("cop_cooling"),
            exergy_destroyed_total     = ex.get("total_exergy_destruction_kW"),
            exergy_efficiency          = ex.get("exergy_efficiency"),
            energy_balance_error       = eb.get("energy_balance_error_percent"),
            carnot_efficiency          = perf.get("carnot_efficiency"),
            metrics                    = raw,
        )
        self.db.add(result)

    # ── input builder ─────────────────────────────────────────────────────

    @staticmethod
    def _infer_cycle_type(components: list) -> str:
        """Infer cycle type from canvas component graph when stored value is unrecognised."""
        types = {c.component_type for c in components}
        if 'compressor' in types and 'evaporator' in types:
            return 'vapor_compression'
        if 'compressor' in types:
            return 'brayton'
        return 'rankine'

    @staticmethod
    def _build_inputs(sim: Simulation, T0: float, P0: float) -> Dict[str, Any]:
        """
        Convert DB Simulation → flat engine inputs dict.

        Key fix: canvas component parameters are mapped from their UI names
        (eta_isentropic, outlet_P, T_source …) to the engine's expected names
        (eta_pump, P_boiler, T_superheat …) per component type and cycle type.
        Each component contributes its own parameters WITHOUT overwriting those
        from other components that share a key name.
        """
        KNOWN_CYCLE_TYPES = {
            'rankine', 'steam_rankine', 'orc',
            'brayton', 'gas_turbine',
            'vapor_compression', 'refrigeration',
            'vapor_absorption', 'absorption',
        }
        stored = (sim.cycle_type or '').lower().strip()
        cycle_type = stored if stored in KNOWN_CYCLE_TYPES \
            else SimulationService._infer_cycle_type(sim.components or [])

        inputs: Dict[str, Any] = {
            "cycle_type": cycle_type,
            "T0": T0,
            "P0": P0,
        }

        # Gather fluid and mass_flow from connections / component params
        for comp in (sim.components or []):
            raw = comp.parameters or {}

            # Fluid name — take from any non-null fluid_name on incoming connection
            for conn in (comp.incoming_connections or []):
                if conn.fluid_name:
                    inputs.setdefault("fluid", conn.fluid_name)
                if conn.mass_flow_rate is not None:
                    inputs.setdefault("mass_flow", conn.mass_flow_rate)

            # mass_flow may also be stored directly on a component
            if "mass_flow" in raw and raw["mass_flow"] is not None:
                inputs.setdefault("mass_flow", raw["mass_flow"])
            if "massFlowRate" in raw and raw["massFlowRate"] is not None:
                inputs.setdefault("mass_flow", raw["massFlowRate"])

            # Map canvas param names → engine param names for this component type
            mapped = _map_component_params(comp.component_type, raw, cycle_type)

            # Use setdefault so the FIRST component that sets a key wins.
            # This is correct because e.g. both boiler.outlet_P and turbine.inlet_P
            # map to "P_boiler" — the boiler's own setting should be authoritative.
            for k, v in mapped.items():
                inputs.setdefault(k, v)

        return inputs

    # ── response formatters ───────────────────────────────────────────────

    @staticmethod
    def _format_response(
        simulation_id: int,
        raw: Dict[str, Any],
        exec_ms: int,
    ) -> Dict[str, Any]:
        perf = raw.get("performance") or {}
        eb   = raw.get("energy_balance") or {}

        return {
            "simulation_id":      simulation_id,
            "success":            raw.get("success", False),
            "error_message":      raw.get("error_message"),
            "execution_time_ms":  exec_ms,
            "cycle_type":         raw.get("cycle_type"),
            "net_power":          perf.get("net_power_kW"),
            "thermal_efficiency": perf.get("thermal_efficiency"),
            "cop":                perf.get("cop_cooling"),
            "exergy_efficiency":  (raw.get("exergy") or {}).get("exergy_efficiency"),
            "state_points":       raw.get("state_points", []),
            "component_metrics":  raw.get("component_metrics", []),
            "energy_balance":     eb,
            "performance":        perf,
            "exergy":             raw.get("exergy"),
            "entropy":            raw.get("entropy"),
            "ts_diagram":         raw.get("ts_diagram"),
            "ph_diagram":         raw.get("ph_diagram"),
            "commentary": {
                "summary":                 _commentary_summary(raw),
                "performance_insights":    _performance_insights(raw),
                "improvement_suggestions": _improvement_suggestions(raw),
            },
            "warnings": raw.get("warnings", []),
        }

    @staticmethod
    def _error_response(
        simulation_id: int, exec_ms: int, msg: str
    ) -> Dict[str, Any]:
        return {
            "simulation_id":      simulation_id,
            "success":            False,
            "error_message":      msg,
            "execution_time_ms":  exec_ms,
            "net_power":          None,
            "thermal_efficiency": None,
            "cop":                None,
            "component_metrics":  [],
            "energy_balance":     None,
            "warnings":           [msg],
        }


# ── Commentary helpers ────────────────────────────────────────────────────────

def _commentary_summary(raw: Dict[str, Any]) -> str:
    perf = raw.get("performance") or {}
    ct   = raw.get("cycle_type", "cycle")

    if perf.get("thermal_efficiency") is not None:
        eta   = perf["thermal_efficiency"] * 100
        eta_c = (perf.get("carnot_efficiency") or 0) * 100
        sl    = (perf.get("second_law_efficiency") or 0) * 100
        pwr   = perf.get("net_power_kW") or 0
        return (
            f"{ct.replace('_', ' ').title()} cycle completed. "
            f"Thermal efficiency: {eta:.1f}% (Carnot: {eta_c:.1f}%, "
            f"2nd-law: {sl:.1f}%). Net power: {pwr:.2f} kW."
        )
    if perf.get("cop_cooling") is not None:
        cop  = perf["cop_cooling"]
        copc = perf.get("cop_carnot") or 0
        cap  = perf.get("cooling_capacity_kW") or 0
        return (
            f"{ct.replace('_', ' ').title()} cycle completed. "
            f"COP (cooling): {cop:.3f} (Carnot: {copc:.3f}). "
            f"Cooling capacity: {cap:.2f} kW."
        )
    return f"{ct} cycle analysis complete."


def _performance_insights(raw: Dict[str, Any]) -> list:
    insights = []
    perf = raw.get("performance") or {}
    ex   = raw.get("exergy") or {}
    eb   = raw.get("energy_balance") or {}

    bwr = perf.get("back_work_ratio")
    if bwr is not None:
        insights.append(
            f"Back-work ratio: {bwr*100:.1f}% — "
            + ("good" if bwr < 0.05 else "moderate" if bwr < 0.15 else "high — consider intercooling")
        )

    ex_eff = ex.get("exergy_efficiency")
    if ex_eff is not None:
        insights.append(f"Exergy (2nd-law) efficiency: {ex_eff*100:.1f}%")

    err = eb.get("energy_balance_error_percent")
    if err is not None:
        insights.append(
            f"Energy balance error: {err:.3f}% — "
            + ("✓ within tolerance" if err < 1.0 else "⚠ exceeds 1% — verify inputs")
        )

    breakdown = ex.get("component_breakdown") or []
    if breakdown:
        worst = max(breakdown, key=lambda x: x.get("exergy_destruction_kW", 0))
        insights.append(
            f"Largest exergy destruction: {worst['name']} "
            f"({worst.get('exergy_destruction_kW', 0):.2f} kW, "
            f"{worst.get('exergy_destruction_share', 0):.1f}% of total)"
        )

    return insights


def _improvement_suggestions(raw: Dict[str, Any]) -> list:
    sug  = []
    perf = raw.get("performance") or {}
    ct   = raw.get("cycle_type", "")

    eta = perf.get("thermal_efficiency")
    if eta is not None:
        if eta < 0.25:
            sug.append("Thermal efficiency is low. Consider increasing boiler pressure "
                       "or turbine inlet temperature.")
        if perf.get("back_work_ratio", 0) > 0.15:
            sug.append("High back-work ratio. Reheat or multi-stage compression "
                       "with intercooling could improve net output.")
        if perf.get("second_law_efficiency", 1) < 0.5:
            sug.append("Second-law efficiency below 50%. Review heat source/sink "
                       "temperatures and component irreversibilities.")

    cop = perf.get("cop_cooling")
    if cop is not None and cop < 2.0 and "absorption" not in ct:
        sug.append("COP below 2.0. Consider reducing compressor pressure ratio or "
                   "increasing evaporator temperature if process allows.")

    return sug
