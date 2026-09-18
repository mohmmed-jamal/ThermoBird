"""
Condenser component - removes heat from fluid to produce liquid.
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


class Condenser(SingleInletOutletComponent):
    """
    Condenser component.
    Removes heat from fluid, typically converting vapor to liquid.
    
    Parameters:
        - heat_rejected: Heat removed from fluid (W) - positive value
        - outlet_temperature: Target outlet temperature (K) - alternative to heat_rejected
        - outlet_quality: Target outlet quality (0-1) - for two-phase exit
        - outlet_pressure: Outlet pressure (Pa) - if None, assumes constant pressure
        - pressure_drop: Pressure drop through condenser (Pa), default 0
        - mass_flow: Mass flow rate (kg/s)
    """
    
    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        """Initialize condenser component."""
        super().__init__(component_id, name, ComponentType.CONDENSER, parameters)
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Validate condenser parameters."""
        errors = []
        
        # Check that at least one outlet condition is specified
        heat_rejected = self.get_parameter("heat_rejected")
        outlet_temperature = self.get_parameter("outlet_temperature")
        outlet_quality = self.get_parameter("outlet_quality")
        
        if heat_rejected is None and outlet_temperature is None and outlet_quality is None:
            errors.append("Must specify 'heat_rejected', 'outlet_temperature', or 'outlet_quality'")
        
        if heat_rejected is not None and heat_rejected <= 0:
            errors.append(f"Heat rejected must be positive, got {heat_rejected}")
        
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
        Calculate condenser performance.
        
        Process:
        1. Get inlet state (typically saturated or superheated vapor)
        2. Calculate outlet state based on heat rejection or target condition
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
                    error_message="Insufficient inlet data for condenser calculation"
                )
            
            inlet_state = self.get_inlet_state()
            if inlet_state is None:
                return ComponentResult(
                    success=False,
                    error_message="Inlet state not defined"
                )
            
            # Get parameters
            heat_rejected = self.get_parameter("heat_rejected")
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
            if heat_rejected is not None:
                # Calculate outlet enthalpy from heat rejection
                outlet_enthalpy = inlet_state.enthalpy - heat_rejected / mass_flow
                
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
                        error_message=f"Failed to calculate outlet state from heat rejected: {e}"
                    )
                
                actual_heat_rejected = heat_rejected
                
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
                
                # Calculate actual heat rejected
                actual_heat_rejected = mass_flow * (inlet_state.enthalpy - outlet_state.enthalpy)
                
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
                
                # Calculate actual heat rejected
                actual_heat_rejected = mass_flow * (inlet_state.enthalpy - outlet_state.enthalpy)
            
            # Check if outlet temperature is greater than inlet (shouldn't happen in condenser)
            if outlet_state.temperature > inlet_state.temperature:
                warnings.append(f"Warning: Outlet temperature ({outlet_state.temperature:.1f} K) is greater than inlet temperature ({inlet_state.temperature:.1f} K)")
            
            # Check if heat rejected is negative (heat added instead of removed)
            if actual_heat_rejected < 0:
                warnings.append(f"Warning: Calculated heat rejected is negative ({actual_heat_rejected:.1f} W). Heat is being added instead of removed.")
            
            # Check for subcooling
            if outlet_state.quality == 0 or outlet_state.phase == 'liquid':
                # Get saturation temperature at outlet pressure
                try:
                    sat_props = self._property_engine.get_saturation_properties(
                        inlet_state.fluid,
                        pressure=outlet_pressure
                    )
                    T_sat = sat_props['saturation_temperature']
                    if outlet_state.temperature < T_sat:
                        subcooling = T_sat - outlet_state.temperature
                        warnings.append(f"Info: Producing subcooled liquid with {subcooling:.1f} K subcooling")
                except:
                    pass
            
            # Set outlet state on component
            self.set_outlet_state(outlet_state)
            
            # Calculate entropy generation
            entropy_generation = mass_flow * (outlet_state.entropy - inlet_state.entropy)
            
            # For exergy destruction calculation
            # Assume heat sink at T_sink = outlet_temp - 10K (cooling water/air)
            T_sink = max(outlet_state.temperature - 10, 280)  # Min 280K
            T0 = 298.15  # Ambient
            
            # Exergy of heat rejection (negative because heat flows out)
            exergy_heat = actual_heat_rejected * (1 - T0 / T_sink)
            
            # Exergy decrease of fluid
            exergy_fluid_decrease = mass_flow * (
                (inlet_state.enthalpy - outlet_state.enthalpy) 
                - T0 * (inlet_state.entropy - outlet_state.entropy)
            )
            
            # Exergy destruction
            exergy_destruction = exergy_fluid_decrease - exergy_heat
            
            # Return results
            return ComponentResult(
                success=True,
                inlet_state=inlet_state,
                outlet_state=outlet_state,
                work=0.0,  # No work in condenser
                heat=-actual_heat_rejected,  # Negative for heat rejection
                efficiency=None,  # Could define as exergetic efficiency
                entropy_generation=entropy_generation,
                exergy_destruction=exergy_destruction,
                warnings=warnings,
                metadata={
                    'heat_rejected': actual_heat_rejected,
                    'specific_heat_rejected': actual_heat_rejected / mass_flow,
                    'temperature_drop': inlet_state.temperature - outlet_state.temperature,
                    'pressure_drop': inlet_state.pressure - outlet_pressure,
                    'inlet_quality': inlet_state.quality,
                    'outlet_quality': outlet_state.quality,
                    'exergetic_efficiency': exergy_heat / exergy_fluid_decrease if exergy_fluid_decrease > 0 else None
                }
            )
            
        except Exception as e:
            logger.error(f"Condenser calculation failed for {self.name}: {e}", exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Condenser calculation failed: {str(e)}"
            )
