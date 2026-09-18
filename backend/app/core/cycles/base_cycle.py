"""
base_cycle.py — Abstract base class for all ThermoBird cycle solvers.

Every cycle solver:
  1. Receives a flat dict of user-supplied inputs (pressures, temps, fluid, etc.)
  2. Solves all thermodynamic state points using CoolProp via PropertyEngine
  3. Returns a CycleResult dataclass containing:
       - state_points  : list of StatePoint (one per cycle node)
       - component_results : work / heat / entropy / exergy per component
       - energy_balance
       - performance metrics  (η_thermal OR COP)
       - exergy summary (per component + total)
       - entropy generation summary (per component + total)
       - warnings list

Units throughout:
  Temperature  K
  Pressure     Pa
  Enthalpy     J/kg   (specific)
  Entropy      J/kg·K (specific)
  Power / Heat W
  Entropy generation rate  W/K
  Exergy destruction rate  W
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
import time


# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class StatePoint:
    """Thermodynamic state at one node in the cycle."""
    label: str                        # e.g. "1 – Pump inlet"
    fluid: str
    temperature: float                # K
    pressure: float                   # Pa
    enthalpy: float                   # J/kg
    entropy: float                    # J/kg·K
    density: Optional[float] = None   # kg/m³
    quality: Optional[float] = None   # 0-1, None if single-phase
    phase: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "label":       self.label,
            "fluid":       self.fluid,
            "temperature": round(self.temperature, 4),
            "pressure":    round(self.pressure, 2),
            "enthalpy":    round(self.enthalpy, 2),
            "entropy":     round(self.entropy, 4),
            "density":     round(self.density, 4) if self.density is not None else None,
            "quality":     round(self.quality, 4) if self.quality is not None else None,
            "phase":       self.phase,
            # convenient display units
            "temperature_C": round(self.temperature - 273.15, 2),
            "pressure_kPa":  round(self.pressure / 1000, 3),
            "enthalpy_kJ":   round(self.enthalpy / 1000, 4),
            "entropy_kJ":    round(self.entropy / 1000, 5),
        }


@dataclass
class ComponentMetrics:
    """Per-component energy, entropy, and exergy metrics."""
    name: str
    component_type: str               # 'pump', 'turbine', 'boiler', etc.
    work_kW: float = 0.0              # kW  (+ = output, − = input)
    heat_kW: float = 0.0              # kW  (+ = added to fluid, − = rejected)
    isentropic_efficiency: Optional[float] = None
    entropy_gen_rate_kW_K: float = 0.0   # kW/K  always ≥ 0
    exergy_destruction_kW: float = 0.0   # kW    always ≥ 0
    exergy_input_kW: float = 0.0
    exergy_output_kW: float = 0.0
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name":                    self.name,
            "component_type":          self.component_type,
            "work_kW":                 round(self.work_kW, 4),
            "heat_kW":                 round(self.heat_kW, 4),
            "isentropic_efficiency":   self.isentropic_efficiency,
            "entropy_gen_rate_kW_K":   round(self.entropy_gen_rate_kW_K, 6),
            "exergy_destruction_kW":   round(self.exergy_destruction_kW, 4),
            "exergy_input_kW":         round(self.exergy_input_kW, 4),
            "exergy_output_kW":        round(self.exergy_output_kW, 4),
            "warnings":                self.warnings,
        }


@dataclass
class EnergyBalance:
    """Cycle-level energy balance."""
    total_heat_input_kW: float = 0.0
    total_heat_output_kW: float = 0.0
    total_work_input_kW: float = 0.0
    total_work_output_kW: float = 0.0
    net_work_kW: float = 0.0
    energy_balance_error_percent: float = 0.0
    is_balanced: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_heat_input_kW":         round(self.total_heat_input_kW, 4),
            "total_heat_output_kW":        round(self.total_heat_output_kW, 4),
            "total_work_input_kW":         round(self.total_work_input_kW, 4),
            "total_work_output_kW":        round(self.total_work_output_kW, 4),
            "net_work_kW":                 round(self.net_work_kW, 4),
            "energy_balance_error_percent":round(self.energy_balance_error_percent, 4),
            "is_balanced":                 self.is_balanced,
        }


@dataclass
class ExergySummary:
    """Cycle-level exergy analysis."""
    exergy_input_kW: float = 0.0
    total_exergy_destruction_kW: float = 0.0
    exergy_efficiency: float = 0.0         # 0-1
    component_breakdown: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "exergy_input_kW":              round(self.exergy_input_kW, 4),
            "total_exergy_destruction_kW":  round(self.total_exergy_destruction_kW, 4),
            "exergy_efficiency":            round(self.exergy_efficiency, 5),
            "exergy_efficiency_percent":    round(self.exergy_efficiency * 100, 3),
            "component_breakdown":          self.component_breakdown,
        }


@dataclass
class EntropySummary:
    """Cycle-level entropy generation analysis."""
    total_entropy_gen_rate_kW_K: float = 0.0
    component_breakdown: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_entropy_gen_rate_kW_K": round(self.total_entropy_gen_rate_kW_K, 6),
            "component_breakdown":         self.component_breakdown,
        }


@dataclass
class PerformanceMetrics:
    """Top-level cycle performance metrics."""
    cycle_type: str = ""
    fluid: str = ""
    mass_flow_kg_s: float = 0.0

    # Power cycles
    thermal_efficiency: Optional[float] = None        # 0-1
    carnot_efficiency: Optional[float] = None          # 0-1
    second_law_efficiency: Optional[float] = None      # η / η_carnot
    net_power_kW: Optional[float] = None
    back_work_ratio: Optional[float] = None

    # Refrigeration / heat pump cycles
    cop_cooling: Optional[float] = None
    cop_heating: Optional[float] = None
    cop_carnot: Optional[float] = None
    cooling_capacity_kW: Optional[float] = None
    heating_capacity_kW: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "cycle_type":       self.cycle_type,
            "fluid":            self.fluid,
            "mass_flow_kg_s":   round(self.mass_flow_kg_s, 5),
        }
        optional_fields = [
            "thermal_efficiency", "carnot_efficiency", "second_law_efficiency",
            "net_power_kW", "back_work_ratio",
            "cop_cooling", "cop_heating", "cop_carnot",
            "cooling_capacity_kW", "heating_capacity_kW",
        ]
        for f in optional_fields:
            v = getattr(self, f)
            if v is not None:
                d[f] = round(v, 5) if isinstance(v, float) else v
        # Convenience percentages
        if self.thermal_efficiency is not None:
            d["thermal_efficiency_percent"] = round(self.thermal_efficiency * 100, 3)
        if self.carnot_efficiency is not None:
            d["carnot_efficiency_percent"] = round(self.carnot_efficiency * 100, 3)
        if self.second_law_efficiency is not None:
            d["second_law_efficiency_percent"] = round(self.second_law_efficiency * 100, 3)
        return d


@dataclass
class CycleResult:
    """Complete result returned by every cycle solver."""
    success: bool
    cycle_type: str
    error_message: Optional[str] = None
    execution_time_ms: int = 0

    state_points: List[StatePoint] = field(default_factory=list)
    component_metrics: List[ComponentMetrics] = field(default_factory=list)
    energy_balance: Optional[EnergyBalance] = None
    performance: Optional[PerformanceMetrics] = None
    exergy: Optional[ExergySummary] = None
    entropy: Optional[EntropySummary] = None
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success":            self.success,
            "cycle_type":         self.cycle_type,
            "error_message":      self.error_message,
            "execution_time_ms":  self.execution_time_ms,
            "state_points":       [sp.to_dict() for sp in self.state_points],
            "component_metrics":  [cm.to_dict() for cm in self.component_metrics],
            "energy_balance":     self.energy_balance.to_dict() if self.energy_balance else None,
            "performance":        self.performance.to_dict() if self.performance else None,
            "exergy":             self.exergy.to_dict() if self.exergy else None,
            "entropy":            self.entropy.to_dict() if self.entropy else None,
            "warnings":           self.warnings,
        }


# ── Abstract solver ────────────────────────────────────────────────────────────

class BaseCycleSolver(ABC):
    """
    Abstract base for all cycle solvers.

    Subclasses implement `solve(inputs)` and call the helper methods
    provided here for property lookups, entropy-gen, and exergy.
    """

    def __init__(self):
        from app.core.property_engine import get_property_engine
        self._pe = get_property_engine()

    # ── public entry point ─────────────────────────────────────────────────

    def run(self, inputs: Dict[str, Any]) -> CycleResult:
        """Timed wrapper around solve()."""
        t0 = time.perf_counter()
        try:
            result = self.solve(inputs)
        except Exception as exc:
            import traceback
            result = CycleResult(
                success=False,
                cycle_type=self.cycle_name,
                error_message=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
            )
        result.execution_time_ms = int((time.perf_counter() - t0) * 1000)
        return result

    # ── must implement ─────────────────────────────────────────────────────

    @property
    @abstractmethod
    def cycle_name(self) -> str:
        """Short identifier, e.g. 'rankine', 'brayton'."""

    @abstractmethod
    def solve(self, inputs: Dict[str, Any]) -> CycleResult:
        """Core solver logic. Must return a CycleResult."""

    # ── property helpers ───────────────────────────────────────────────────

    def _state(self, fluid: str, t1: str, v1: float,
               t2: str, v2: float, label: str) -> StatePoint:
        """Calculate a StatePoint from two known properties."""
        props = self._pe.calculate_properties(fluid, t1, v1, t2, v2)
        return StatePoint(
            label=label,
            fluid=fluid,
            temperature=props["temperature"],
            pressure=props["pressure"],
            enthalpy=props["enthalpy"],
            entropy=props["entropy"],
            density=props["density"],
            quality=props["quality"],
            phase=props["phase"],
        )

    def _isentropic_outlet(self, fluid: str, P_in: float, T_in: float,
                           P_out: float, label: str) -> StatePoint:
        """State after an ideal isentropic process."""
        props = self._pe.get_isentropic_state(fluid, P_in, T_in, P_out)
        return StatePoint(
            label=label,
            fluid=fluid,
            temperature=props["temperature"],
            pressure=props["pressure"],
            enthalpy=props["enthalpy"],
            entropy=props["entropy"],
            density=props["density"],
            quality=props["quality"],
            phase=props["phase"],
        )

    # ── entropy / exergy helpers ───────────────────────────────────────────

    @staticmethod
    def _entropy_gen(m_dot: float, s_out: float, s_in: float,
                     q: float = 0.0, T_boundary: float = 0.0) -> float:
        """
        Entropy generation rate [W/K] for a steady-flow process.
        σ_gen = m*(s_out - s_in) - q/T_boundary
        q > 0 means heat INTO the system; T_boundary is the source/sink temperature.
        If the process is adiabatic pass q=0 (T_boundary is then irrelevant).
        """
        heat_term = (q / T_boundary) if (T_boundary > 0 and q != 0) else 0.0
        return max(0.0, m_dot * (s_out - s_in) - heat_term)

    @staticmethod
    def _flow_exergy(h: float, s: float, h0: float, s0: float, T0: float) -> float:
        """
        Specific flow exergy [J/kg]:  ψ = (h - h0) - T0*(s - s0)
        """
        return (h - h0) - T0 * (s - s0)

    @staticmethod
    def _exergy_destruction(T0: float, sigma_gen_W_K: float) -> float:
        """Gouy-Stodola theorem: X_dest = T0 * σ_gen  [W]"""
        return T0 * sigma_gen_W_K

    # ── energy balance helper ──────────────────────────────────────────────

    @staticmethod
    def _check_energy_balance(metrics: List[ComponentMetrics]) -> EnergyBalance:
        Q_in  = sum(c.heat_kW for c in metrics if c.heat_kW > 0)
        Q_out = sum(-c.heat_kW for c in metrics if c.heat_kW < 0)
        W_in  = sum(-c.work_kW for c in metrics if c.work_kW < 0)
        W_out = sum(c.work_kW for c in metrics if c.work_kW > 0)

        net_work = W_out - W_in
        # First-law check: Q_in + W_in ≈ Q_out + W_out
        lhs = Q_in + W_in
        rhs = Q_out + W_out
        error_pct = abs(lhs - rhs) / max(lhs, 1e-9) * 100

        return EnergyBalance(
            total_heat_input_kW=round(Q_in, 4),
            total_heat_output_kW=round(Q_out, 4),
            total_work_input_kW=round(W_in, 4),
            total_work_output_kW=round(W_out, 4),
            net_work_kW=round(net_work, 4),
            energy_balance_error_percent=round(error_pct, 4),
            is_balanced=(error_pct < 1.0),
        )

    @staticmethod
    def _build_entropy_summary(metrics: List[ComponentMetrics]) -> EntropySummary:
        total = sum(c.entropy_gen_rate_kW_K for c in metrics)
        breakdown = [
            {"name": c.name, "entropy_gen_rate_kW_K": round(c.entropy_gen_rate_kW_K, 6)}
            for c in metrics
        ]
        return EntropySummary(
            total_entropy_gen_rate_kW_K=round(total, 6),
            component_breakdown=breakdown,
        )

    @staticmethod
    def _build_exergy_summary(metrics: List[ComponentMetrics],
                              exergy_input_kW: float) -> ExergySummary:
        total_dest = sum(c.exergy_destruction_kW for c in metrics)
        eff = max(0.0, 1.0 - total_dest / max(exergy_input_kW, 1e-9))
        breakdown = [
            {
                "name": c.name,
                "exergy_destruction_kW":    round(c.exergy_destruction_kW, 4),
                "exergy_destruction_share": round(
                    c.exergy_destruction_kW / max(total_dest, 1e-9) * 100, 2
                ),
            }
            for c in metrics
        ]
        return ExergySummary(
            exergy_input_kW=round(exergy_input_kW, 4),
            total_exergy_destruction_kW=round(total_dest, 4),
            exergy_efficiency=round(eff, 5),
            component_breakdown=breakdown,
        )
