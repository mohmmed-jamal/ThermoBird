"""
Heat Exchanger component - transfers heat between two fluid streams.
"""
from typing import Dict, Any, List, Tuple, Optional
import logging

from app.core.components.base import (
    HeatExchangerBase,
    ComponentType,
    ComponentResult,
    ThermodynamicState
)

logger = logging.getLogger(__name__)


class HeatExchanger(HeatExchangerBase):
    """
    General heat exchanger with hot and cold sides.
    
    Parameters:
        - effectiveness: Heat exchanger effectiveness (0-1), default 0.85
        - heat_transfer: Fixed heat transfer rate (W) - alternative to effectiveness
        - hot_mass_flow: Hot side mass flow rate (kg/s)
        - cold_mass_flow: Cold side mass flow rate (kg/s)
        - pressure_drop_hot: Pressure drop on hot side (Pa), default 0
        - pressure_drop_cold: Pressure drop on cold side (Pa), default 0
    """
    
    def __init__(self, component_id: str, name: str, parameters: Dict[str, Any]):
        """Initialize heat exchanger component."""
        super().__init__(component_id, name, ComponentType.HEAT_EXCHANGER, parameters)
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Validate heat exchanger parameters."""
        errors = []
        
        # Check effectiveness
        effectiveness = self.get_parameter("effectiveness")
        heat_transfer = self.get_parameter("heat_transfer")
        
        if effectiveness is None and heat_transfer is None:
            errors.append("Must specify either 'effectiveness' or 'heat_transfer'")
        
        if effectiveness is not None and not 0 < effectiveness <= 1:
            errors.append(f"Effectiveness must be between 0 and 1, got {effectiveness}")
        
        if heat_transfer is not None and heat_transfer <= 0:
            errors.append(f"Heat transfer must be positive, got {heat_transfer}")
        
        # Check mass flows
        hot_mass_flow = self.get_parameter("hot_mass_flow")
        cold_mass_flow = self.get_parameter("cold_mass_flow")
        
        if hot_mass_flow is not None and hot_mass_flow <= 0:
            errors.append(f"Hot side mass flow must be positive, got {hot_mass_flow}")
        
        if cold_mass_flow is not None and cold_mass_flow <= 0:
            errors.append(f"Cold side mass flow must be positive, got {cold_mass_flow}")
        
        # Check pressure drops
        pressure_drop_hot = self.get_parameter("pressure_drop_hot", 0)
        pressure_drop_cold = self.get_parameter("pressure_drop_cold", 0)
        
        if pressure_drop_hot < 0:
            errors.append(f"Hot side pressure drop must be non-negative, got {pressure_drop_hot}")
        
        if pressure_drop_cold < 0:
            errors.append(f"Cold side pressure drop must be non-negative, got {pressure_drop_cold}")
        
        return (len(errors) == 0, errors)
    
    def calculate(self) -> ComponentResult:
        """
        Calculate heat exchanger performance.
        
        Process:
        1. Get inlet states for both hot and cold sides
        2. Calculate maximum possible heat transfer
        3. Apply effectiveness or use fixed heat transfer
        4. Calculate outlet states
        """
        try:
            # Validate parameters first
            is_valid, errors = self.validate_parameters()
            if not is_valid:
                return ComponentResult(
                    success=False,
                    error_message=f"Invalid parameters: {'; '.join(errors)}"
                )
            
            # Check if we have inlet states for both sides
            if not self.has_sufficient_inlet_data():
                return ComponentResult(
                    success=False,
                    error_message="Insufficient inlet data for heat exchanger calculation"
                )
            
            hot_inlet = self.get_inlet_state("hot_inlet")
            cold_inlet = self.get_inlet_state("cold_inlet")
            
            if hot_inlet is None or cold_inlet is None:
                return ComponentResult(
                    success=False,
                    error_message="Hot or cold inlet state not defined"
                )
            
            # Get parameters
            effectiveness = self.get_parameter("effectiveness", 0.85)
            heat_transfer = self.get_parameter("heat_transfer")
            hot_mass_flow = self.get_parameter("hot_mass_flow")
            cold_mass_flow = self.get_parameter("cold_mass_flow")
            pressure_drop_hot = self.get_parameter("pressure_drop_hot", 0)
            pressure_drop_cold = self.get_parameter("pressure_drop_cold", 0)
            
            # Get mass flows from states if not in parameters
            if hot_mass_flow is None:
                hot_mass_flow = hot_inlet.mass_flow
            if cold_mass_flow is None:
                cold_mass_flow = cold_inlet.mass_flow
            
            if hot_mass_flow is None or cold_mass_flow is None:
                return ComponentResult(
                    success=False,
                    error_message="Mass flow rates not specified for both sides"
                )
            
            warnings = []
            
            # Check that hot inlet is hotter than cold inlet
            if hot_inlet.temperature <= cold_inlet.temperature:
                warnings.append(f"Warning: Hot inlet temperature ({hot_inlet.temperature:.1f} K) is not greater than cold inlet temperature ({cold_inlet.temperature:.1f} K)")
            
            # Calculate heat capacity rates
            # C = m_dot * cp (for single-phase)
            # For two-phase or when cp varies significantly, use enthalpy differences
            
            if heat_transfer is None:
                # Calculate using effectiveness method
                
                # Maximum possible heat transfer (if cold side reached hot inlet temp)
                Q_max_cold = cold_mass_flow * (
                    self._get_enthalpy_at_temp(cold_inlet.fluid, hot_inlet.temperature, cold_inlet.pressure) 
                    - cold_inlet.enthalpy
                )
                
                # Maximum possible heat transfer (if hot side reached cold inlet temp)
                Q_max_hot = hot_mass_flow * (
                    hot_inlet.enthalpy 
                    - self._get_enthalpy_at_temp(hot_inlet.fluid, cold_inlet.temperature, hot_inlet.pressure)
                )
                
                # Maximum heat transfer is the minimum of the two
                Q_max = min(abs(Q_max_cold), abs(Q_max_hot))
                
                # Actual heat transfer
                Q_actual = effectiveness * Q_max
            else:
                # Use specified heat transfer
                Q_actual = heat_transfer
            
            # Calculate outlet states
            
            # Hot side outlet (loses heat)
            hot_outlet_enthalpy = hot_inlet.enthalpy - Q_actual / hot_mass_flow
            hot_outlet_pressure = hot_inlet.pressure - pressure_drop_hot
            
            try:
                hot_outlet = self.calculate_properties(
                    hot_inlet.fluid,
                    'P', hot_outlet_pressure,
                    'H', hot_outlet_enthalpy
                )
                hot_outlet.mass_flow = hot_mass_flow
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Failed to calculate hot outlet state: {e}"
                )
            
            # Cold side outlet (gains heat)
            cold_outlet_enthalpy = cold_inlet.enthalpy + Q_actual / cold_mass_flow
            cold_outlet_pressure = cold_inlet.pressure - pressure_drop_cold
            
            try:
                cold_outlet = self.calculate_properties(
                    cold_inlet.fluid,
                    'P', cold_outlet_pressure,
                    'H', cold_outlet_enthalpy
                )
                cold_outlet.mass_flow = cold_mass_flow
            except Exception as e:
                return ComponentResult(
                    success=False,
                    error_message=f"Failed to calculate cold outlet state: {e}"
                )
            
            # Check for temperature crossover
            if cold_outlet.temperature > hot_outlet.temperature:
                warnings.append(f"Warning: Temperature crossover detected. Cold outlet ({cold_outlet.temperature:.1f} K) > hot outlet ({hot_outlet.temperature:.1f} K)")
            
            # Set outlet states
            self.set_outlet_state(hot_outlet, "hot_outlet")
            self.set_outlet_state(cold_outlet, "cold_outlet")
            
            # Calculate entropy generation
            entropy_gen_hot = hot_mass_flow * (hot_outlet.entropy - hot_inlet.entropy)
            entropy_gen_cold = cold_mass_flow * (cold_outlet.entropy - cold_inlet.entropy)
            total_entropy_generation = entropy_gen_hot + entropy_gen_cold
            
            # Exergy destruction
            T0 = 298.15  # Ambient temperature
            exergy_destruction = T0 * total_entropy_generation
            
            # Calculate actual effectiveness achieved
            if heat_transfer is None:
                actual_effectiveness = effectiveness
            else:
                # Back-calculate effectiveness from actual heat transfer
                Q_max_cold = cold_mass_flow * (
                    self._get_enthalpy_at_temp(cold_inlet.fluid, hot_inlet.temperature, cold_inlet.pressure) 
                    - cold_inlet.enthalpy
                )
                Q_max_hot = hot_mass_flow * (
                    hot_inlet.enthalpy 
                    - self._get_enthalpy_at_temp(hot_inlet.fluid, cold_inlet.temperature, hot_inlet.pressure)
                )
                Q_max = min(abs(Q_max_cold), abs(Q_max_hot))
                actual_effectiveness = Q_actual / Q_max if Q_max > 0 else 0
            
            # Return results
            # Note: For heat exchangers, we return the dominant inlet/outlet pair
            # Metadata contains both sides
            return ComponentResult(
                success=True,
                inlet_state=hot_inlet,  # Primary inlet
                outlet_state=hot_outlet,  # Primary outlet
                work=0.0,  # No work for passive heat exchanger
                heat=Q_actual,  # Heat transferred from hot to cold
                efficiency=actual_effectiveness,
                entropy_generation=total_entropy_generation,
                exergy_destruction=exergy_destruction,
                warnings=warnings,
                metadata={
                    'hot_inlet': hot_inlet.to_dict(),
                    'hot_outlet': hot_outlet.to_dict(),
                    'cold_inlet': cold_inlet.to_dict(),
                    'cold_outlet': cold_outlet.to_dict(),
                    'heat_transferred': Q_actual,
                    'effectiveness': actual_effectiveness,
                    'hot_temperature_drop': hot_inlet.temperature - hot_outlet.temperature,
                    'cold_temperature_rise': cold_outlet.temperature - cold_inlet.temperature,
                    'lmtd': self._calculate_lmtd(hot_inlet, hot_outlet, cold_inlet, cold_outlet)
                }
            )
            
        except Exception as e:
            logger.error(f"Heat exchanger calculation failed for {self.name}: {e}", exc_info=True)
            return ComponentResult(
                success=False,
                error_message=f"Heat exchanger calculation failed: {str(e)}"
            )
    
    def _get_enthalpy_at_temp(self, fluid: str, temperature: float, pressure: float) -> float:
        """Helper to get enthalpy at a specific temperature and pressure."""
        state = self.calculate_properties(fluid, 'T', temperature, 'P', pressure)
        return state.enthalpy
    
    def _calculate_lmtd(
        self,
        hot_inlet: ThermodynamicState,
        hot_outlet: ThermodynamicState,
        cold_inlet: ThermodynamicState,
        cold_outlet: ThermodynamicState
    ) -> Optional[float]:
        """
        Calculate Log Mean Temperature Difference.
        
        Returns:
            LMTD in Kelvin, or None if calculation fails
        """
        try:
            # Temperature differences at each end
            dT1 = hot_inlet.temperature - cold_outlet.temperature  # Hot end
            dT2 = hot_outlet.temperature - cold_inlet.temperature  # Cold end
            
            if dT1 <= 0 or dT2 <= 0:
                return None
            
            if abs(dT1 - dT2) < 1e-6:
                return dT1
            
            import math
            lmtd = (dT1 - dT2) / math.log(dT1 / dT2)
            return lmtd
            
        except Exception:
            return None
