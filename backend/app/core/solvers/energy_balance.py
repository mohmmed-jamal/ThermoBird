"""
Energy balance solver - validates conservation of energy across the cycle.
"""
from typing import Dict, List, Tuple, Optional
import logging

from app.core.components.base import BaseComponent, ComponentResult

logger = logging.getLogger(__name__)


class EnergyBalanceResult:
    """Results from energy balance analysis."""
    
    def __init__(self):
        self.total_heat_input: float = 0.0      # W
        self.total_heat_output: float = 0.0     # W
        self.total_work_input: float = 0.0      # W
        self.total_work_output: float = 0.0     # W
        self.net_work: float = 0.0              # W (output - input)
        self.net_heat: float = 0.0              # W (input - output)
        self.energy_balance_error: float = 0.0  # W (should be ~0)
        self.energy_balance_error_percent: float = 0.0  # %
        self.is_balanced: bool = False
        self.component_breakdown: Dict[str, Dict[str, float]] = {}
        self.warnings: List[str] = []
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'total_heat_input': self.total_heat_input,
            'total_heat_output': self.total_heat_output,
            'total_work_input': self.total_work_input,
            'total_work_output': self.total_work_output,
            'net_work': self.net_work,
            'net_heat': self.net_heat,
            'energy_balance_error': self.energy_balance_error,
            'energy_balance_error_percent': self.energy_balance_error_percent,
            'is_balanced': self.is_balanced,
            'component_breakdown': self.component_breakdown,
            'warnings': self.warnings
        }


class EnergyBalanceSolver:
    """
    Solves energy balance for thermodynamic cycles.
    
    Verifies that:
    - Energy in = Energy out (1st Law of Thermodynamics)
    - Q_in - Q_out = W_out - W_in (for closed cycles)
    """
    
    def __init__(self, tolerance: float = 0.01):
        """
        Initialize energy balance solver.
        
        Args:
            tolerance: Acceptable relative error (0.01 = 1%)
        """
        self.tolerance = tolerance
    
    def solve(
        self,
        components: List[BaseComponent],
        results: Dict[str, ComponentResult]
    ) -> EnergyBalanceResult:
        """
        Perform energy balance analysis.
        
        Args:
            components: List of all components in the cycle
            results: Dictionary mapping component ID to its ComponentResult
            
        Returns:
            EnergyBalanceResult with balance validation
        """
        balance = EnergyBalanceResult()
        
        try:
            # Aggregate energy flows from all components
            for component in components:
                result = results.get(component.id)
                
                if result is None or not result.success:
                    balance.warnings.append(
                        f"Component '{component.name}' has no valid result"
                    )
                    continue
                
                # Track component contributions
                component_energy = {
                    'heat': result.heat or 0.0,
                    'work': result.work or 0.0
                }
                balance.component_breakdown[component.name] = component_energy
                
                # Accumulate heat transfers
                heat = result.heat or 0.0
                if heat > 0:
                    balance.total_heat_input += heat
                else:
                    balance.total_heat_output += abs(heat)
                
                # Accumulate work transfers
                work = result.work or 0.0
                if work > 0:
                    balance.total_work_output += work
                else:
                    balance.total_work_input += abs(work)
            
            # Calculate net values
            balance.net_work = balance.total_work_output - balance.total_work_input
            balance.net_heat = balance.total_heat_input - balance.total_heat_output
            
            # Energy balance check: Q_in - Q_out should equal W_out - W_in
            balance.energy_balance_error = balance.net_heat - balance.net_work
            
            # Calculate percentage error
            energy_reference = max(
                balance.total_heat_input,
                balance.total_work_output,
                1.0  # Avoid division by zero
            )
            balance.energy_balance_error_percent = (
                abs(balance.energy_balance_error) / energy_reference * 100
            )
            
            # Check if balanced within tolerance
            balance.is_balanced = (
                balance.energy_balance_error_percent <= self.tolerance * 100
            )
            
            if not balance.is_balanced:
                balance.warnings.append(
                    f"Energy balance error: {balance.energy_balance_error_percent:.2f}% "
                    f"(tolerance: {self.tolerance * 100:.2f}%)"
                )
            
            # Additional validation checks
            self._validate_cycle_type(balance)
            
        except Exception as e:
            logger.error(f"Energy balance calculation failed: {e}", exc_info=True)
            balance.warnings.append(f"Error during energy balance: {str(e)}")
        
        return balance
    
    def _validate_cycle_type(self, balance: EnergyBalanceResult) -> None:
        """
        Validate energy balance based on cycle type.
        
        Args:
            balance: EnergyBalanceResult to validate
        """
        # Power cycle check (net work output)
        if balance.net_work > 1000:  # > 1 kW net output
            if balance.total_heat_input < balance.total_work_output:
                balance.warnings.append(
                    "Warning: Power cycle with heat input less than work output. "
                    "This violates 2nd Law of Thermodynamics."
                )
            
            # Thermal efficiency check
            if balance.total_heat_input > 0:
                thermal_eff = balance.net_work / balance.total_heat_input
                if thermal_eff > 0.99:
                    balance.warnings.append(
                        f"Warning: Thermal efficiency ({thermal_eff:.1%}) exceeds 99%. "
                        "This is physically impossible."
                    )
        
        # Refrigeration cycle check (net work input)
        elif balance.net_work < -1000:  # > 1 kW net input
            if balance.total_heat_output < abs(balance.net_work):
                balance.warnings.append(
                    "Warning: Refrigeration cycle with heat rejection less than work input. "
                    "This violates energy conservation."
                )
            
            # COP check
            if abs(balance.net_work) > 0:
                cop = balance.total_heat_input / abs(balance.net_work)
                if cop > 20:
                    balance.warnings.append(
                        f"Warning: COP ({cop:.1f}) exceeds 20. "
                        "This is unusually high and may indicate an error."
                    )
    
    def get_thermal_efficiency(self, balance: EnergyBalanceResult) -> Optional[float]:
        """
        Calculate thermal efficiency for power cycles.
        
        Args:
            balance: EnergyBalanceResult
            
        Returns:
            Thermal efficiency (0-1) or None if not applicable
        """
        if balance.total_heat_input > 0:
            return balance.net_work / balance.total_heat_input
        return None
    
    def get_cop(self, balance: EnergyBalanceResult) -> Optional[float]:
        """
        Calculate Coefficient of Performance for refrigeration cycles.
        
        Args:
            balance: EnergyBalanceResult
            
        Returns:
            COP or None if not applicable
        """
        net_work_input = abs(balance.net_work)
        if net_work_input > 0:
            # COP_cooling = Q_evap / W_in
            return balance.total_heat_input / net_work_input
        return None
    
    def get_heat_rate(self, balance: EnergyBalanceResult) -> Optional[float]:
        """
        Calculate heat rate for power cycles (kJ/kWh).
        
        Args:
            balance: EnergyBalanceResult
            
        Returns:
            Heat rate or None if not applicable
        """
        if balance.net_work > 0:
            # Heat rate = Q_in / W_net (kJ/kWh)
            return (balance.total_heat_input / balance.net_work) * 3600
        return None
    
    def get_back_work_ratio(
        self,
        balance: EnergyBalanceResult
    ) -> Optional[float]:
        """
        Calculate back work ratio (work input / work output).
        
        Args:
            balance: EnergyBalanceResult
            
        Returns:
            Back work ratio (0-1) or None if not applicable
        """
        if balance.total_work_output > 0:
            return balance.total_work_input / balance.total_work_output
        return None
    
    def generate_report(self, balance: EnergyBalanceResult) -> str:
        """
        Generate human-readable energy balance report.
        
        Args:
            balance: EnergyBalanceResult
            
        Returns:
            Formatted report string
        """
        lines = []
        lines.append("=" * 60)
        lines.append("ENERGY BALANCE ANALYSIS")
        lines.append("=" * 60)
        lines.append("")
        
        # Overall balance
        lines.append("Overall Energy Balance:")
        lines.append(f"  Total Heat Input:     {balance.total_heat_input/1000:.2f} kW")
        lines.append(f"  Total Heat Output:    {balance.total_heat_output/1000:.2f} kW")
        lines.append(f"  Total Work Input:     {balance.total_work_input/1000:.2f} kW")
        lines.append(f"  Total Work Output:    {balance.total_work_output/1000:.2f} kW")
        lines.append(f"  Net Work:             {balance.net_work/1000:.2f} kW")
        lines.append(f"  Net Heat:             {balance.net_heat/1000:.2f} kW")
        lines.append("")
        
        # Balance status
        status = "BALANCED ✓" if balance.is_balanced else "NOT BALANCED ✗"
        lines.append(f"Balance Status: {status}")
        lines.append(f"  Error: {balance.energy_balance_error/1000:.2f} kW ({balance.energy_balance_error_percent:.2f}%)")
        lines.append("")
        
        # Performance metrics
        lines.append("Performance Metrics:")
        
        thermal_eff = self.get_thermal_efficiency(balance)
        if thermal_eff is not None and thermal_eff > 0:
            lines.append(f"  Thermal Efficiency:   {thermal_eff:.2%}")
        
        cop = self.get_cop(balance)
        if cop is not None:
            lines.append(f"  COP:                  {cop:.2f}")
        
        heat_rate = self.get_heat_rate(balance)
        if heat_rate is not None:
            lines.append(f"  Heat Rate:            {heat_rate:.0f} kJ/kWh")
        
        bwr = self.get_back_work_ratio(balance)
        if bwr is not None:
            lines.append(f"  Back Work Ratio:      {bwr:.2%}")
        
        lines.append("")
        
        # Component breakdown
        if balance.component_breakdown:
            lines.append("Component Breakdown:")
            for comp_name, energy in balance.component_breakdown.items():
                heat_kw = energy['heat'] / 1000
                work_kw = energy['work'] / 1000
                lines.append(f"  {comp_name}:")
                if abs(heat_kw) > 0.01:
                    heat_type = "input" if heat_kw > 0 else "output"
                    lines.append(f"    Heat {heat_type}: {abs(heat_kw):.2f} kW")
                if abs(work_kw) > 0.01:
                    work_type = "output" if work_kw > 0 else "input"
                    lines.append(f"    Work {work_type}: {abs(work_kw):.2f} kW")
            lines.append("")
        
        # Warnings
        if balance.warnings:
            lines.append("Warnings:")
            for warning in balance.warnings:
                lines.append(f"  ⚠ {warning}")
            lines.append("")
        
        lines.append("=" * 60)
        
        return "\n".join(lines)
