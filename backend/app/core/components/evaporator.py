"""
Evaporator component - adds heat to liquid to produce vapor (for refrigeration cycles).
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


class Evaporator(SingleInletOutletComponent):
    """
    Evaporator component (typically for refrigeration cycles).
    Adds heat to fluid, converting liquid to vapor at low pressure.
    
    Parameters:
        - heat_input: Heat absorbed by refrigerant (W) - cooling capacity
        - outlet_temperature: Target outlet temperature (K) - alternative to heat_input
        - outlet_quality: Target outlet quality (0-1) - for two-phase exit
        - outlet_pressure: Outlet pressure (Pa) - if None, assumes constant pressure
        - pressure_drop: Pressure drop through evaporator (Pa), default 0
        - mass_flow: Mass flow rate (kg/s)
    """
    
    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        """Initialize evaporator component."""
        super().__init__(component_id, name, ComponentType.EVAPORATOR, parameters)
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Validate evaporator parameters."""
        errors = []
        
        # Check that at least one outlet condition is specified
        heat_input = self.get_parameter("heat_input")
        outlet_temperature = self.get_parameter("outlet_temperature")
        outlet_quality = self.get_parameter("outlet_quality")
        
        if heat_input is None and outlet_temperature is None and outlet_quality is None:
            errors.append("Must specify 'heat_input', 'outlet_temperature', or 'outlet_quality'")
        
        if heat_input is not None and heat_input <= 0:
            errors.append(f"Heat input must be positive, got {heat_input}")
        
        if outlet_temperature is not None and outlet_temperature <= 0:
            errors.append(f"Outlet temperature must be positive, got {outlet_temperature}")
        
        if outlet_quality is not None and not 0 <= outlet_quality <= 1:
            errors.append(f"Outlet quality must be between 0 and 1, got {outlet_quality}")
        
        # Check pressure drop
        pressure_drop = self.get_parameter("pressure_drop", 0)
        if pressure_drop < 0:
            errors.append(f"Pressure drop must be non-negative, got {pressure_drop}")
        
        # Check mass flow
        mass_flow = self.get_mass_flow()
        if mass_flow is not None and mass_flow <= 0:
            errors.append(f"Mass flow rate must be positive, got {mass_flow}")
        
        return (len(errors) == 0, errors)
    
    def calculate(self) -> ComponentResult:
        """
        Calculate evaporator performance.
        
        Process:
        1. Get inlet state (typically saturated liquid or two-phase mixture)
        2. Calculate outlet state based on heat input or target condition
        3. Calculate heat transfer and entropy generation
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
                    error_message="Insufficient inlet data for evaporator calculation"
                )
            
            inlet_state = self.get_inlet_state()
            if inlet_state is None:
                return ComponentResult(
                    success=False,
                    error_message="Inlet state not defined"
                )
            
            # Get parameters
            heat_input = self.get_parameter("heat_input")
            outlet_temperature = self.get_parameter("outlet_temperature")
            outlet_quality = self.get_parameter("outlet_quality")
            outlet_pressure_param = self.get_parameter("outlet_pressure")
            pressure_drop = self.get_parameter("pressure_drop", 0)
            mass_flow = self.get_mass_flow()
            
            if mass_flow is None:
                return ComponentResult(
                    success=False,
                    error_message="Mass flow rate not specified"
                )
            
            warnings = []
            
            # Determine outlet pressure
            if outlet_pressure_param is not None:
                outlet_pressure = outlet_pressure_param
            else:
                outlet_pressure = inlet_state.pressure - pressure_drop
            
            if outlet_pressure <= 0:
                return ComponentResult(
                    success=False,
                    error_message=f"Outlet pressure must be positive, got {outlet_pressure}"
                )
            
            # Calculate outlet state based on specified parameter
            if heat_input is not None:
                # Calculate outlet enthalpy from heat input
                outlet_enthalpy = inlet_state.enthalpy + heat_input / mass_flow
                
                try:
                    outlet_state = self.calculate_properties(
                        inlet_state.fluid,
                        'P', outlet_pressure,
                        'H', outlet_enthalpy
                    )
                    outlet_state.mass_flow = mass_flow
                except Exception as e:
                    return ComponentResult(
                        success=False,
                        error_message=f"Failed to calculate outlet state from heat input: {e}"
                    )
                
                actual_heat_input = heat_input
                
            elif outlet_quality is not None:
                # Calculate outlet state from quality
                try:
                    outlet_state = self.calculate_properties(
                        inlet_state.fluid,
                        'P', outlet_pressure,
                        'Q', outlet_quality
                    )
                    outlet_state.mass_flow = mass_flow
                except Exception as e:
                    return ComponentResult(
                        success=False,
                        error_message=f"Failed to calculate outlet state from quality: {e}"
                    )
                
                # Calculate actual heat input
                actual_heat_input = mass_flow * (outlet_state.enthalpy - inlet_state.enthalpy)
                
            else:  # outlet_temperature is specified
                # Calculate outlet state from temperature
                try:
                    outlet_state = self.calculate_properties(
                        inlet_state.fluid,
                        'T', outlet_temperature,
                        'P', outlet_pressure
                    )
                    outlet_state.mass_flow = mass_flow
                except Exception as e:
                    return ComponentResult(
                        success=False,
                        error_message=f"Failed to calculate outlet state from temperature: {e}"
                    )
                
                # Calculate actual heat input
                actual_heat_input = mass_flow * (outlet_state.enthalpy - inlet_state.enthalpy)
            
            # Check if outlet temperature is less than inlet (shouldn't happen in evaporator)
            if outlet_state.temperature < inlet_state.temperature:
                warnings.append(f"Warning: Outlet temperature ({outlet_state.temperature:.1f} K) is less than inlet temperature ({inlet_state.temperature:.1f} K)")
            
            # Check if heat input is negative (heat removed instead of added)
            if actual_heat_input < 0:
                warnings.append(f"Warning: Calculated heat input is negative ({actual_heat_input:.1f} W). Heat is being removed instead of added.")
            
            # Check for superheating
            if outlet_state.quality is None or outlet_state.quality >= 1.0:
                if outlet_state.phase == 'vapor':
                    # Get saturation temperature at outlet pressure
                    try:
                        sat_props = self._property_engine.get_saturation_properties(
                            inlet_state.fluid,
                            pressure=outlet_pressure
                        )
                        T_sat = sat_props['saturation_temperature']
                        superheat = outlet_state.temperature - T_sat
                        if superheat > 1:
                            warnings.append(f"Info: Producing superheated vapor with {superheat:.1f} K superheat")
                    except:
                        pass
            
            # Set outlet state on component
            self.set_outlet_state(outlet_state)
            
            # Calculate entropy generation
            entropy_generation = mass_flow * (outlet_state.entropy - inlet_state.entropy)
            
            # For exergy destruction calculation
            # Assume cold source (refrigerated space) at T_cold = inlet_temp - 10K
            T_cold = inlet_state.temperature - 10
            T0 = 298.15  # Ambient
            
            # Exergy of heat input from cold source
            exergy_heat = actual_heat_input * (1 - T0 / T_cold)
            
            # Exergy increase of fluid
            exergy_fluid_increase = mass_flow * (
                (outlet_state.enthalpy - inlet_state.enthalpy) 
                - T0 * (outlet_state.entropy - inlet_state.entropy)
            )
            
            # Exergy destruction
            exergy_destruction = exergy_heat - exergy_fluid_increase
            
            # Return results
            return ComponentResult(
                success=True,
                inlet_state=inlet_state,
                outlet_state=outlet_state,
                work=0.0,  # No work in evaporator
                heat=actual_heat_input,  # Positive for heat input (cooling capacity)
                efficiency=None,  # Could define as exergetic efficiency
                entropy_generation=entropy_generation,
                exergy_destruction=exergy_destruction,
                warnings=warnings,
                metadata={
                    'heat_input': actual_heat_input,
                    'cooling_capacity': actual_heat_input,  # Same as heat input
                    'specific_cooling_capacity': actual_heat_input / mass_flow,
                    'temperature_rise': outlet_state.temperature - inlet_state.temperature,
                    'pressure_drop': inlet_state.pressure - outlet_pressure,
                    'inlet_quality': inlet_state.quality,
                    'outlet_quality': outlet_state.quality,
                    'exergetic_efficiency': exergy_fluid_increase / exergy_heat if exergy_heat > 0 else None
                }
            )
            
        except Exception as e:
            logger.error(f"Evaporator calculation failed for {self.name}: {e}", exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Evaporator calculation failed: {str(e)}"
            )
