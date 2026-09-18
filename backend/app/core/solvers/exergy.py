"""
Exergy analysis solver - calculates available energy and losses.
"""
from typing import Dict, List, Optional, Tuple
import logging

from app.core.components.base import BaseComponent, ComponentResult, ThermodynamicState

logger = logging.getLogger(__name__)


class ExergyAnalysisResult:
    """Results from exergy analysis."""
    
    def __init__(self):
        self.total_exergy_input: float = 0.0         # W
        self.total_exergy_output: float = 0.0        # W
        self.total_exergy_destruction: float = 0.0   # W
        self.exergy_efficiency: float = 0.0          # 0-1
        self.component_exergy_dest: Dict[str, float] = {}
        self.component_exergy_eff: Dict[str, float] = {}
        self.major_losses: List[Tuple[str, float]] = []  # [(component_name, exergy_dest), ...]
        self.warnings: List[str] = []
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'total_exergy_input': self.total_exergy_input,
            'total_exergy_output': self.total_exergy_output,
            'total_exergy_destruction': self.total_exergy_destruction,
            'exergy_efficiency': self.exergy_efficiency,
            'component_exergy_destruction': self.component_exergy_dest,
            'component_exergy_efficiency': self.component_exergy_eff,
            'major_losses': [
                {'component': comp, 'exergy_destruction': ex_dest}
                for comp, ex_dest in self.major_losses
            ],
            'warnings': self.warnings
        }


class ExergyAnalysisSolver:
    """
    Performs exergy (availability) analysis on thermodynamic cycles.
    
    Exergy represents the maximum useful work obtainable from a system
    as it comes to equilibrium with the environment.
    
    Key equations:
    - Flow exergy: ex = (h - h0) - T0(s - s0)
    - Exergy efficiency: η_ex = Exergy_out / Exergy_in
    - Exergy destruction: Ex_dest = T0 * S_gen
    """
    
    def __init__(
        self,
        ambient_temperature: float = 298.15,
        ambient_pressure: float = 101325
    ):
        """
        Initialize exergy analysis solver.
        
        Args:
            ambient_temperature: Dead state temperature (K)
            ambient_pressure: Dead state pressure (Pa)
        """
        self.T0 = ambient_temperature
        self.P0 = ambient_pressure
    
    def solve(
        self,
        components: List[BaseComponent],
        results: Dict[str, ComponentResult],
        fluid: str = "Water"
    ) -> ExergyAnalysisResult:
        """
        Perform exergy analysis.
        
        Args:
            components: List of all components in the cycle
            results: Dictionary mapping component ID to its ComponentResult
            fluid: Working fluid name (for dead state properties)
            
        Returns:
            ExergyAnalysisResult with exergy analysis
        """
        result = ExergyAnalysisResult()
        
        try:
            # Get dead state properties for reference
            dead_state = self._get_dead_state(fluid)
            
            # Calculate exergy destruction for each component
            for component in components:
                comp_result = results.get(component.id)
                
                if comp_result is None or not comp_result.success:
                    result.warnings.append(
                        f"Component '{component.name}' has no valid result"
                    )
                    continue
                
                # Get exergy destruction from component result
                ex_dest = comp_result.exergy_destruction or 0.0
                
                # Alternative calculation if not available
                if ex_dest == 0.0 and comp_result.entropy_generation:
                    ex_dest = self.T0 * comp_result.entropy_generation
                
                result.component_exergy_dest[component.name] = ex_dest
                result.total_exergy_destruction += ex_dest
                
                # Calculate component exergy efficiency
                comp_ex_eff = self._calculate_component_exergy_efficiency(
                    component,
                    comp_result,
                    dead_state
                )
                if comp_ex_eff is not None:
                    result.component_exergy_eff[component.name] = comp_ex_eff
            
            # Calculate total exergy input and output
            self._calculate_total_exergy_flows(
                components,
                results,
                dead_state,
                result
            )
            
            # Calculate overall exergy efficiency
            if result.total_exergy_input > 0:
                result.exergy_efficiency = (
                    result.total_exergy_output / result.total_exergy_input
                )
            
            # Identify major losses
            sorted_components = sorted(
                result.component_exergy_dest.items(),
                key=lambda x: x[1],
                reverse=True
            )
            result.major_losses = sorted_components[:5]
            
            # Validate results
            self._validate_exergy_balance(result)
            
        except Exception as e:
            logger.error(f"Exergy analysis failed: {e}", exc_info=True)
            result.warnings.append(f"Error during exergy analysis: {str(e)}")
        
        return result
    
    def _get_dead_state(self, fluid: str) -> ThermodynamicState:
        """
        Calculate dead state properties at ambient conditions.
        
        Args:
            fluid: Working fluid name
            
        Returns:
            ThermodynamicState at dead state (T0, P0)
        """
        from app.core.property_engine import get_property_engine
        
        engine = get_property_engine()
        
        try:
            props = engine.calculate_properties(
                fluid,
                'T', self.T0,
                'P', self.P0
            )
            
            return ThermodynamicState(
                fluid=fluid,
                temperature=props['temperature'],
                pressure=props['pressure'],
                enthalpy=props['enthalpy'],
                entropy=props['entropy'],
                density=props['density'],
                quality=props['quality'],
                phase=props['phase']
            )
        except Exception as e:
            logger.warning(f"Could not calculate dead state for {fluid}: {e}")
            # Return approximate dead state
            return ThermodynamicState(
                fluid=fluid,
                temperature=self.T0,
                pressure=self.P0,
                enthalpy=0.0,  # Reference
                entropy=0.0    # Reference
            )
    
    def calculate_flow_exergy(
        self,
        state: ThermodynamicState,
        dead_state: ThermodynamicState
    ) -> float:
        """
        Calculate specific flow exergy (J/kg).
        
        ex = (h - h0) - T0(s - s0)
        
        Args:
            state: Thermodynamic state
            dead_state: Dead state reference
            
        Returns:
            Specific flow exergy (J/kg)
        """
        if state.enthalpy is None or state.entropy is None:
            return 0.0
        
        ex = (
            (state.enthalpy - dead_state.enthalpy)
            - self.T0 * (state.entropy - dead_state.entropy)
        )
        
        return ex
    
    def _calculate_component_exergy_efficiency(
        self,
        component: BaseComponent,
        comp_result: ComponentResult,
        dead_state: ThermodynamicState
    ) -> Optional[float]:
        """
        Calculate exergy efficiency for a component.
        
        Args:
            component: Component
            comp_result: ComponentResult
            dead_state: Dead state reference
            
        Returns:
            Exergy efficiency (0-1) or None
        """
        try:
            inlet_state = comp_result.inlet_state
            outlet_state = comp_result.outlet_state
            
            if inlet_state is None or outlet_state is None:
                return None
            
            # Calculate exergy change
            ex_in = self.calculate_flow_exergy(inlet_state, dead_state)
            ex_out = self.calculate_flow_exergy(outlet_state, dead_state)
            
            mass_flow = inlet_state.mass_flow or 1.0
            
            # For work-producing devices (turbine)
            if comp_result.work and comp_result.work > 0:
                exergy_in = mass_flow * ex_in
                exergy_out = comp_result.work + mass_flow * ex_out
                
                if exergy_in > 0:
                    return exergy_out / exergy_in
            
            # For work-consuming devices (pump, compressor)
            elif comp_result.work and comp_result.work < 0:
                exergy_in = abs(comp_result.work) + mass_flow * ex_in
                exergy_out = mass_flow * ex_out
                
                if exergy_in > 0:
                    return exergy_out / exergy_in
            
            # For heat exchangers
            elif comp_result.heat and comp_result.heat != 0:
                # Simplified - actual calculation is more complex
                ex_dest = comp_result.exergy_destruction or 0.0
                exergy_in = mass_flow * abs(ex_in)
                
                if exergy_in > 0:
                    return 1.0 - (ex_dest / exergy_in)
            
            return None
            
        except Exception as e:
            logger.debug(f"Could not calculate exergy efficiency for {component.name}: {e}")
            return None
    
    def _calculate_total_exergy_flows(
        self,
        components: List[BaseComponent],
        results: Dict[str, ComponentResult],
        dead_state: ThermodynamicState,
        result: ExergyAnalysisResult
    ) -> None:
        """
        Calculate total exergy input and output.
        
        Args:
            components: List of components
            results: Component results
            dead_state: Dead state reference
            result: ExergyAnalysisResult to populate
        """
        for component in components:
            comp_result = results.get(component.id)
            
            if comp_result is None or not comp_result.success:
                continue
            
            # Work interactions
            if comp_result.work:
                if comp_result.work > 0:
                    result.total_exergy_output += comp_result.work
                else:
                    result.total_exergy_input += abs(comp_result.work)
            
            # Heat interactions (need to calculate exergy of heat)
            if comp_result.heat and comp_result.heat != 0:
                # For heat transfer at temperature T_source
                # Exergy of heat = Q * (1 - T0/T_source)
                # This is approximated - actual calculation needs heat source temp
                pass
    
    def _validate_exergy_balance(self, result: ExergyAnalysisResult) -> None:
        """
        Validate exergy balance.
        
        Exergy_in = Exergy_out + Exergy_destroyed
        
        Args:
            result: ExergyAnalysisResult to validate
        """
        # Check exergy balance
        exergy_balance_error = (
            result.total_exergy_input
            - result.total_exergy_output
            - result.total_exergy_destruction
        )
        
        # Allow for some numerical error
        if abs(exergy_balance_error) > result.total_exergy_input * 0.05:
            result.warnings.append(
                f"Exergy balance error: {exergy_balance_error/1000:.2f} kW. "
                "This may indicate calculation issues."
            )
        
        # Check if exergy efficiency is reasonable
        if result.exergy_efficiency > 1.0:
            result.warnings.append(
                f"Exergy efficiency ({result.exergy_efficiency:.1%}) exceeds 100%. "
                "This is physically impossible."
            )
        elif result.exergy_efficiency > 0.9:
            result.warnings.append(
                f"Exergy efficiency ({result.exergy_efficiency:.1%}) is very high. "
                "Verify calculations."
            )
    
    def generate_report(self, result: ExergyAnalysisResult) -> str:
        """
        Generate human-readable exergy analysis report.
        
        Args:
            result: ExergyAnalysisResult
            
        Returns:
            Formatted report string
        """
        lines = []
        lines.append("=" * 60)
        lines.append("EXERGY ANALYSIS")
        lines.append("=" * 60)
        lines.append("")
        
        # Overall exergy flows
        lines.append("Overall Exergy Balance:")
        lines.append(f"  Total Exergy Input:       {result.total_exergy_input/1000:.2f} kW")
        lines.append(f"  Total Exergy Output:      {result.total_exergy_output/1000:.2f} kW")
        lines.append(f"  Total Exergy Destruction: {result.total_exergy_destruction/1000:.2f} kW")
        lines.append(f"  Exergy Efficiency:        {result.exergy_efficiency:.2%}")
        lines.append("")
        
        lines.append(f"Dead State Conditions:")
        lines.append(f"  Temperature: {self.T0:.2f} K ({self.T0-273.15:.2f}°C)")
        lines.append(f"  Pressure:    {self.P0/1000:.2f} kPa")
        lines.append("")
        
        # Major exergy losses
        if result.major_losses:
            lines.append("Major Exergy Destruction Sources:")
            total_ex_dest = result.total_exergy_destruction
            
            for i, (comp_name, ex_dest) in enumerate(result.major_losses, 1):
                percentage = (ex_dest / total_ex_dest * 100) if total_ex_dest > 0 else 0
                lines.append(f"  {i}. {comp_name}")
                lines.append(f"     Destruction: {ex_dest/1000:.2f} kW ({percentage:.1f}%)")
                
                # Add component exergy efficiency if available
                if comp_name in result.component_exergy_eff:
                    comp_eff = result.component_exergy_eff[comp_name]
                    lines.append(f"     Component η_ex: {comp_eff:.2%}")
            lines.append("")
        
        # Component breakdown
        if result.component_exergy_dest:
            lines.append("Component Exergy Destruction:")
            
            sorted_components = sorted(
                result.component_exergy_dest.items(),
                key=lambda x: x[1],
                reverse=True
            )
            
            for comp_name, ex_dest in sorted_components:
                percentage = (ex_dest / result.total_exergy_destruction * 100) if result.total_exergy_destruction > 0 else 0
                lines.append(f"  {comp_name}: {ex_dest/1000:.2f} kW ({percentage:.1f}%)")
            lines.append("")
        
        # Warnings
        if result.warnings:
            lines.append("Warnings:")
            for warning in result.warnings:
                lines.append(f"  ⚠ {warning}")
            lines.append("")
        
        lines.append("=" * 60)
        
        return "\n".join(lines)
