"""
Pump component - increases pressure of liquid with work input.
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


class Pump(SingleInletOutletComponent):
    """
    Pump component for liquid compression.
    
    Parameters:
        - efficiency: Isentropic efficiency (0-1), default 0.85
        - outlet_pressure: Target outlet pressure (Pa)
        - pressure_ratio: Alternative to outlet_pressure
        - mass_flow: Mass flow rate (kg/s)
    """
    
    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        """Initialize pump component."""
        super().__init__(component_id, name, ComponentType.PUMP, parameters)
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Validate pump parameters."""
        errors = []
        
        # Check efficiency
        efficiency = self.get_parameter("efficiency", 0.85)
        if not 0 < efficiency <= 1:
            errors.append(f"Efficiency must be between 0 and 1, got {efficiency}")
        
        # Check that either outlet_pressure or pressure_ratio is specified
        outlet_pressure = self.get_parameter("outlet_pressure")
        pressure_ratio = self.get_parameter("pressure_ratio")
        
        if outlet_pressure is None and pressure_ratio is None:
            errors.append("Must specify either 'outlet_pressure' or 'pressure_ratio'")
        
        if outlet_pressure is not None and outlet_pressure <= 0:
            errors.append(f"Outlet pressure must be positive, got {outlet_pressure}")
        
        if pressure_ratio is not None and pressure_ratio <= 1:
            errors.append(f"Pressure ratio must be > 1 for pump, got {pressure_ratio}")
        
        # Check mass flow
        mass_flow = self.get_mass_flow()
        if mass_flow is not None and mass_flow <= 0:
            errors.append(f"Mass flow rate must be positive, got {mass_flow}")
        
        return (len(errors) == 0, errors)
    
    def calculate(self) -> ComponentResult:
        """
        Calculate pump performance.
        
        Process:
        1. Get inlet state (must be liquid or compressed liquid)
        2. Calculate isentropic outlet state
        3. Apply efficiency to get actual outlet state
        4. Calculate work input
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
                    error_message="Insufficient inlet data for pump calculation"
                )
            
            inlet_state = self.get_inlet_state()
            if inlet_state is None:
                return ComponentResult(
                    success=False,
                    error_message="Inlet state not defined"
                )
            
            # Get parameters
            efficiency = self.get_parameter("efficiency", 0.85)
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
                outlet_pressure = inlet_state.pressure * pressure_ratio
            
            # Check that inlet pressure is less than outlet (pump increases pressure)
            if inlet_state.pressure >= outlet_pressure:
                return ComponentResult(
                    success=False,
                    error_message=f"Inlet pressure ({inlet_state.pressure} Pa) must be less than outlet pressure ({outlet_pressure} Pa)"
                )
            
            # Check that fluid is in liquid phase (pumps work on liquids)
            warnings = []
            if inlet_state.phase not in ['liquid', None]:
                warnings.append(f"Warning: Pump inlet is not liquid phase (phase: {inlet_state.phase}). Pumps should operate on liquids.")
            
            # Calculate isentropic outlet state (constant entropy)
            try:
                isentropic_outlet = self.get_isentropic_outlet(inlet_state, outlet_pressure)
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Failed to calculate isentropic outlet state: {e}"
                )
            
            # Calculate isentropic work (ideal work input)
            # For pumps: w_s = h_out_s - h_in
            work_isentropic = (isentropic_outlet.enthalpy - inlet_state.enthalpy) * mass_flow
            
            # Calculate actual work with efficiency
            # w_actual = w_isentropic / efficiency
            work_actual = work_isentropic / efficiency
            
            # Calculate actual outlet enthalpy
            # h_out_actual = h_in + w_actual/m_dot
            outlet_enthalpy_actual = inlet_state.enthalpy + work_actual / mass_flow
            
            # Calculate actual outlet state
            try:
                outlet_state = self.calculate_properties(
                    inlet_state.fluid,
                    'P', outlet_pressure,
                    'H', outlet_enthalpy_actual
                )
                outlet_state.mass_flow = mass_flow
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Failed to calculate actual outlet state: {e}"
                )
            
            # Set outlet state on component
            self.set_outlet_state(outlet_state)
            
            # Calculate entropy generation
            entropy_generation = mass_flow * (outlet_state.entropy - inlet_state.entropy)
            
            # For exergy destruction, need ambient conditions
            # Assuming T0 = 298.15 K (25°C)
            T0 = 298.15
            exergy_destruction = T0 * entropy_generation
            
            # Return results
            return ComponentResult(
                success=True,
                inlet_state=inlet_state,
                outlet_state=outlet_state,
                work=-work_actual,  # Negative because work is input
                heat=0.0,  # Pumps are typically adiabatic
                efficiency=efficiency,
                entropy_generation=entropy_generation,
                exergy_destruction=exergy_destruction,
                warnings=warnings,
                metadata={
                    'work_isentropic': work_isentropic,
                    'pressure_increase': outlet_pressure - inlet_state.pressure,
                    'specific_work': work_actual / mass_flow,
                    'pressure_ratio': outlet_pressure / inlet_state.pressure
                }
            )
            
        except Exception as e:
            logger.error(f"Pump calculation failed for {self.name}: {e}", exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Pump calculation failed: {str(e)}"
            )
    
    def get_required_power(self) -> float:
        """
        Get required power input for this pump.
        Must be called after calculate().
        
        Returns:
            Power in Watts (positive value)
        """
        outlet_state = self.get_outlet_state()
        inlet_state = self.get_inlet_state()
        
        if outlet_state is None or inlet_state is None:
            raise RuntimeError("Cannot get required power - component not calculated yet")
        
        mass_flow = self.get_mass_flow()
        efficiency = self.get_parameter("efficiency", 0.85)
        
        work_isentropic = (outlet_state.enthalpy - inlet_state.enthalpy) * mass_flow
        work_actual = work_isentropic / efficiency
        
        return abs(work_actual)
