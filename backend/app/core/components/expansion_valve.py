"""
Expansion Valve component - throttles fluid reducing pressure (isenthalpic process).
"""
from typing import Dict, Any, List, Tuple
import logging

from app.core.components.base import (
    SingleInletOutletComponent,
    ComponentType,
    ComponentResult,
    ThermodynamicState
)

logger = logging.getLogger(__name__)


class ExpansionValve(SingleInletOutletComponent):
    """
    Expansion valve / throttling device component.
    Reduces pressure through isenthalpic (constant enthalpy) process.
    
    Parameters:
        - outlet_pressure: Target outlet pressure (Pa)
        - pressure_ratio: Alternative to outlet_pressure (P_in / P_out)
        - mass_flow: Mass flow rate (kg/s)
    """
    
    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        """Initialize expansion valve component."""
        super().__init__(component_id, name, ComponentType.EXPANSION_VALVE, parameters)
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Validate expansion valve parameters."""
        errors = []
        
        # Check that either outlet_pressure or pressure_ratio is specified
        outlet_pressure = self.get_parameter("outlet_pressure")
        pressure_ratio = self.get_parameter("pressure_ratio")
        
        if outlet_pressure is None and pressure_ratio is None:
            errors.append("Must specify either 'outlet_pressure' or 'pressure_ratio'")
        
        if outlet_pressure is not None and outlet_pressure <= 0:
            errors.append(f"Outlet pressure must be positive, got {outlet_pressure}")
        
        if pressure_ratio is not None and pressure_ratio <= 1:
            errors.append(f"Pressure ratio must be > 1 for expansion valve (P_in / P_out), got {pressure_ratio}")
        
        # Check mass flow
        mass_flow = self.get_mass_flow()
        if mass_flow is not None and mass_flow <= 0:
            errors.append(f"Mass flow rate must be positive, got {mass_flow}")
        
        return (len(errors) == 0, errors)
    
    def calculate(self) -> ComponentResult:
        """
        Calculate expansion valve performance.
        
        Process:
        1. Get inlet state (typically saturated or subcooled liquid)
        2. Calculate outlet state with same enthalpy but lower pressure (isenthalpic)
        3. Calculate entropy generation
        
        Note: Expansion valves are inherently irreversible (entropy increases)
        """
        try:
            # Validate parameters first
            is_valid, errors = self.validate_parameters()
            if not is_valid:
                return ComponentResult(
                    success=False,
                    error_message=f"Invalid parameters: {'; '.join(errors)}"
                )
            
            # Check if we have inlet state
            if not self.has_sufficient_inlet_data():
                return ComponentResult(
                    success=False,
                    error_message="Insufficient inlet data for expansion valve calculation"
                )
            
            inlet_state = self.get_inlet_state()
            if inlet_state is None:
                return ComponentResult(
                    success=False,
                    error_message="Inlet state not defined"
                )
            
            # Get parameters
            outlet_pressure = self.get_parameter("outlet_pressure")
            pressure_ratio = self.get_parameter("pressure_ratio")
            mass_flow = self.get_mass_flow()
            
            if mass_flow is None:
                return ComponentResult(
                    success=False,
                    error_message="Mass flow rate not specified"
                )
            
            # Determine outlet pressure
            if outlet_pressure is None:
                outlet_pressure = inlet_state.pressure / pressure_ratio
            
            # Check that inlet pressure is greater than outlet (valve reduces pressure)
            if inlet_state.pressure <= outlet_pressure:
                return ComponentResult(
                    success=False,
                    error_message=f"Inlet pressure ({inlet_state.pressure} Pa) must be greater than outlet pressure ({outlet_pressure} Pa)"
                )
            
            warnings = []
            
            # Check inlet condition
            if inlet_state.phase == 'vapor':
                warnings.append("Warning: Expansion valve inlet is vapor. Typically should be liquid or two-phase.")
            
            # Calculate outlet state (isenthalpic: h_out = h_in)
            try:
                outlet_state = self.calculate_properties(
                    inlet_state.fluid,
                    'P', outlet_pressure,
                    'H', inlet_state.enthalpy
                )
                outlet_state.mass_flow = mass_flow
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Failed to calculate outlet state: {e}"
                )
            
            # Set outlet state on component
            self.set_outlet_state(outlet_state)
            
            # Calculate entropy generation (always positive for throttling)
            entropy_generation = mass_flow * (outlet_state.entropy - inlet_state.entropy)
            
            # For exergy destruction
            T0 = 298.15  # Ambient temperature
            exergy_destruction = T0 * entropy_generation
            
            # Check quality change
            if inlet_state.quality is not None and outlet_state.quality is not None:
                quality_change = outlet_state.quality - inlet_state.quality
                if quality_change > 0:
                    warnings.append(f"Info: Flash evaporation occurred. Quality increased from {inlet_state.quality:.3f} to {outlet_state.quality:.3f}")
            elif inlet_state.quality is None and outlet_state.quality is not None:
                warnings.append(f"Info: Liquid flashed to two-phase mixture. Outlet quality: {outlet_state.quality:.3f}")
            
            # Throttling coefficient (temperature change per pressure drop)
            throttling_coefficient = (outlet_state.temperature - inlet_state.temperature) / (inlet_state.pressure - outlet_pressure)
            
            # Return results
            return ComponentResult(
                success=True,
                inlet_state=inlet_state,
                outlet_state=outlet_state,
                work=0.0,  # No work in expansion valve
                heat=0.0,  # Adiabatic process
                efficiency=0.0,  # Expansion valves are inherently irreversible
                entropy_generation=entropy_generation,
                exergy_destruction=exergy_destruction,
                warnings=warnings,
                metadata={
                    'pressure_drop': inlet_state.pressure - outlet_pressure,
                    'pressure_ratio': inlet_state.pressure / outlet_pressure,
                    'temperature_change': outlet_state.temperature - inlet_state.temperature,
                    'throttling_coefficient': throttling_coefficient,
                    'inlet_quality': inlet_state.quality,
                    'outlet_quality': outlet_state.quality,
                    'entropy_increase': outlet_state.entropy - inlet_state.entropy,
                    'isentropic_efficiency': 0.0  # By definition for throttling
                }
            )
            
        except Exception as e:
            logger.error(f"Expansion valve calculation failed for {self.name}: {e}", exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Expansion valve calculation failed: {str(e)}"
            )
