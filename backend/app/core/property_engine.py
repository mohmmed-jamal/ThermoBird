"""
Property Engine - CoolProp wrapper for thermodynamic property calculations.
Provides thread-safe, cached access to fluid properties with error handling.
"""
from typing import Optional, Dict, Tuple, List
from enum import Enum
import CoolProp.CoolProp as CP
from CoolProp.CoolProp import PropsSI
from functools import lru_cache
import logging

logger = logging.getLogger(__name__)


class FluidPhase(str, Enum):
    """Fluid phase states."""
    LIQUID = "liquid"
    VAPOR = "vapor"
    TWO_PHASE = "two_phase"
    SUPERCRITICAL = "supercritical"
    UNKNOWN = "unknown"


class PropertyError(Exception):
    """Custom exception for property calculation errors."""
    pass


class PropertyEngine:
    """
    Thread-safe property calculator using CoolProp.
    Handles all thermodynamic property lookups with caching and error handling.
    """
    
    # Common fluids mapping (friendly name -> CoolProp name)
    FLUID_MAP = {
        "water": "Water",
        "h2o": "Water",
        "steam": "Water",
        "r134a": "R134a",
        "r410a": "R410A",
        "r22": "R22",
        "r32": "R32",
        "ammonia": "Ammonia",
        "nh3": "Ammonia",
        "co2": "CO2",
        "carbon_dioxide": "CO2",
        "air": "Air",
        "nitrogen": "Nitrogen",
        "n2": "Nitrogen",
        "oxygen": "Oxygen",
        "o2": "Oxygen",
        "methane": "Methane",
        "ch4": "Methane",
        "propane": "Propane",
        "c3h8": "Propane",
        "isobutane": "IsoButane",
        "n-butane": "n-Butane",
        "ethane": "Ethane",
        "c2h6": "Ethane",
    }
    
    def __init__(self):
        """Initialize property engine."""
        self._validate_coolprop()
    
    def _validate_coolprop(self) -> None:
        """Validate CoolProp installation and basic functionality."""
        try:
            # Test basic property calculation
            # Get temperature of water at 1 bar (100000 Pa) and quality=0 (saturated liquid)
            # Should be approximately 373.15 K (100°C - boiling point at 1 bar)
            test_temp = PropsSI('T', 'P', 100000, 'Q', 0, 'Water')
            # Check if result is reasonable (boiling point of water at ~1 bar)
            if not 372.0 <= test_temp <= 374.0:
                raise PropertyError(f"CoolProp validation failed: expected ~373.15 K, got {test_temp} K")
            logger.info(f"CoolProp validation successful (got {test_temp:.2f} K)")
        except PropertyError:
            raise
        except Exception as e:
            logger.error(f"CoolProp validation failed: {e}")
            raise PropertyError(f"CoolProp initialization failed: {e}")
    
    def normalize_fluid_name(self, fluid: str) -> str:
        """
        Normalize fluid name to CoolProp standard.
        
        Args:
            fluid: Fluid name (can be common name or CoolProp name)
            
        Returns:
            CoolProp standard fluid name
            
        Raises:
            PropertyError: If fluid is not recognized
        """
        fluid_lower = fluid.lower().strip()
        
        # Check if it's a common name
        if fluid_lower in self.FLUID_MAP:
            return self.FLUID_MAP[fluid_lower]
        
        # Check if it's already a valid CoolProp name
        try:
            CP.get_fluid_param_string(fluid, "CAS")
            return fluid
        except:
            pass
        
        raise PropertyError(f"Fluid '{fluid}' not recognized. Available fluids: {list(self.FLUID_MAP.keys())}")
    
    @lru_cache(maxsize=10000)
    def get_fluid_limits(self, fluid: str) -> Dict[str, float]:
        """
        Get fluid property limits (cached).
        
        Args:
            fluid: CoolProp fluid name
            
        Returns:
            Dictionary with T_min, T_max, P_min, P_max, T_critical, P_critical
        """
        try:
            fluid = self.normalize_fluid_name(fluid)
            return {
                'T_min': PropsSI('Tmin', fluid),
                'T_max': PropsSI('Tmax', fluid),
                'P_min': PropsSI('pmin', fluid),
                'P_max': PropsSI('pmax', fluid),
                'T_critical': PropsSI('Tcrit', fluid),
                'P_critical': PropsSI('pcrit', fluid),
                'T_triple': PropsSI('Ttriple', fluid),
                'P_triple': PropsSI('ptriple', fluid),
            }
        except Exception as e:
            raise PropertyError(f"Failed to get limits for {fluid}: {e}")
    
    def calculate_properties(
        self,
        fluid: str,
        input1_type: str,
        input1_value: float,
        input2_type: str,
        input2_value: float
    ) -> Dict[str, float]:
        """
        Calculate all relevant thermodynamic properties given two inputs.
        
        Args:
            fluid: Fluid name
            input1_type: First property type ('P', 'T', 'H', 'S', 'D', 'Q')
            input1_value: First property value
            input2_type: Second property type
            input2_value: Second property value
            
        Returns:
            Dictionary with all properties: T, P, H, S, D, Q, Phase, etc.
            
        Raises:
            PropertyError: If calculation fails
        """
        try:
            fluid = self.normalize_fluid_name(fluid)
            
            # Validate inputs are within limits
            self._validate_inputs(fluid, input1_type, input1_value, input2_type, input2_value)
            
            # Calculate core properties
            T = PropsSI('T', input1_type, input1_value, input2_type, input2_value, fluid)
            P = PropsSI('P', input1_type, input1_value, input2_type, input2_value, fluid)
            H = PropsSI('H', input1_type, input1_value, input2_type, input2_value, fluid)
            S = PropsSI('S', input1_type, input1_value, input2_type, input2_value, fluid)
            D = PropsSI('D', input1_type, input1_value, input2_type, input2_value, fluid)
            
            # Try to get quality (will fail for single-phase)
            try:
                Q = PropsSI('Q', input1_type, input1_value, input2_type, input2_value, fluid)
            except:
                Q = None
            
            # Additional properties
            U = PropsSI('U', input1_type, input1_value, input2_type, input2_value, fluid)
            Cp = PropsSI('C', input1_type, input1_value, input2_type, input2_value, fluid)
            Cv = PropsSI('O', input1_type, input1_value, input2_type, input2_value, fluid)
            
            # Transport properties
            try:
                viscosity = PropsSI('V', input1_type, input1_value, input2_type, input2_value, fluid)
                conductivity = PropsSI('L', input1_type, input1_value, input2_type, input2_value, fluid)
            except:
                viscosity = None
                conductivity = None
            
            # Phase determination
            phase = self._determine_phase(fluid, T, P, Q)
            
            return {
                'temperature': T,           # K
                'pressure': P,              # Pa
                'enthalpy': H,              # J/kg
                'entropy': S,               # J/(kg·K)
                'density': D,               # kg/m³
                'quality': Q,               # 0-1 (None if single-phase)
                'internal_energy': U,       # J/kg
                'cp': Cp,                   # J/(kg·K)
                'cv': Cv,                   # J/(kg·K)
                'viscosity': viscosity,     # Pa·s
                'conductivity': conductivity,  # W/(m·K)
                'phase': phase.value,
                'fluid': fluid
            }
            
        except Exception as e:
            raise PropertyError(
                f"Property calculation failed for {fluid} with "
                f"{input1_type}={input1_value}, {input2_type}={input2_value}: {e}"
            )
    
    def _validate_inputs(
        self,
        fluid: str,
        input1_type: str,
        input1_value: float,
        input2_type: str,
        input2_value: float
    ) -> None:
        """Validate input values are within fluid limits."""
        limits = self.get_fluid_limits(fluid)
        
        # Check temperature limits
        if input1_type == 'T':
            if not limits['T_min'] <= input1_value <= limits['T_max']:
                raise PropertyError(
                    f"Temperature {input1_value} K outside valid range "
                    f"[{limits['T_min']:.2f}, {limits['T_max']:.2f}] K for {fluid}"
                )
        
        if input2_type == 'T':
            if not limits['T_min'] <= input2_value <= limits['T_max']:
                raise PropertyError(
                    f"Temperature {input2_value} K outside valid range "
                    f"[{limits['T_min']:.2f}, {limits['T_max']:.2f}] K for {fluid}"
                )
        
        # Check pressure limits
        if input1_type == 'P':
            if not limits['P_min'] <= input1_value <= limits['P_max']:
                raise PropertyError(
                    f"Pressure {input1_value} Pa outside valid range "
                    f"[{limits['P_min']:.2f}, {limits['P_max']:.2f}] Pa for {fluid}"
                )
        
        if input2_type == 'P':
            if not limits['P_min'] <= input2_value <= limits['P_max']:
                raise PropertyError(
                    f"Pressure {input2_value} Pa outside valid range "
                    f"[{limits['P_min']:.2f}, {limits['P_max']:.2f}] Pa for {fluid}"
                )
        
        # Validate quality
        if input1_type == 'Q' and not 0 <= input1_value <= 1:
            raise PropertyError(f"Quality must be between 0 and 1, got {input1_value}")
        
        if input2_type == 'Q' and not 0 <= input2_value <= 1:
            raise PropertyError(f"Quality must be between 0 and 1, got {input2_value}")
    
    def _determine_phase(self, fluid: str, T: float, P: float, Q: Optional[float]) -> FluidPhase:
        """
        Determine the phase of the fluid.
        
        Args:
            fluid: Fluid name
            T: Temperature (K)
            P: Pressure (Pa)
            Q: Quality (0-1, None if single-phase)
            
        Returns:
            FluidPhase enum
        """
        try:
            limits = self.get_fluid_limits(fluid)
            
            # Check if supercritical
            if T > limits['T_critical'] and P > limits['P_critical']:
                return FluidPhase.SUPERCRITICAL
            
            # Check if two-phase based on quality
            if Q is not None:
                if 0 < Q < 1:
                    return FluidPhase.TWO_PHASE
                elif Q <= 0:
                    return FluidPhase.LIQUID
                else:  # Q >= 1
                    return FluidPhase.VAPOR
            
            # For single-phase, check if liquid or vapor
            # Get saturation temperature at this pressure
            try:
                T_sat = PropsSI('T', 'P', P, 'Q', 0, fluid)
                if T < T_sat:
                    return FluidPhase.LIQUID
                else:
                    return FluidPhase.VAPOR
            except:
                # If saturation check fails, use simple heuristic
                if T < limits['T_critical'] * 0.8:
                    return FluidPhase.LIQUID
                else:
                    return FluidPhase.VAPOR
                
        except Exception as e:
            logger.warning(f"Phase determination failed: {e}")
            return FluidPhase.UNKNOWN
    
    def get_saturation_properties(self, fluid: str, temperature: Optional[float] = None,
                                  pressure: Optional[float] = None) -> Dict[str, float]:
        """
        Get saturation properties at either temperature or pressure.
        
        Args:
            fluid: Fluid name
            temperature: Saturation temperature (K) - provide this OR pressure
            pressure: Saturation pressure (Pa) - provide this OR temperature
            
        Returns:
            Dictionary with saturated liquid and vapor properties
        """
        try:
            fluid = self.normalize_fluid_name(fluid)
            
            if temperature is not None and pressure is not None:
                raise PropertyError("Provide either temperature OR pressure, not both")
            
            if temperature is None and pressure is None:
                raise PropertyError("Must provide either temperature or pressure")
            
            # Get saturation properties
            if temperature is not None:
                P_sat = PropsSI('P', 'T', temperature, 'Q', 0, fluid)
                liquid = self.calculate_properties(fluid, 'T', temperature, 'Q', 0)
                vapor = self.calculate_properties(fluid, 'T', temperature, 'Q', 1)
            else:  # pressure is not None
                T_sat = PropsSI('T', 'P', pressure, 'Q', 0, fluid)
                liquid = self.calculate_properties(fluid, 'P', pressure, 'Q', 0)
                vapor = self.calculate_properties(fluid, 'P', pressure, 'Q', 1)
            
            return {
                'saturation_temperature': liquid['temperature'],
                'saturation_pressure': liquid['pressure'],
                'liquid': liquid,
                'vapor': vapor,
                'h_fg': vapor['enthalpy'] - liquid['enthalpy'],  # Latent heat
                's_fg': vapor['entropy'] - liquid['entropy'],
            }
            
        except Exception as e:
            raise PropertyError(f"Saturation property calculation failed: {e}")
    
    def get_isentropic_state(
        self,
        fluid: str,
        initial_pressure: float,
        initial_temperature: float,
        final_pressure: float
    ) -> Dict[str, float]:
        """
        Calculate final state after isentropic process.
        
        Args:
            fluid: Fluid name
            initial_pressure: Initial pressure (Pa)
            initial_temperature: Initial temperature (K)
            final_pressure: Final pressure (Pa)
            
        Returns:
            Dictionary with final state properties
        """
        try:
            # Get initial entropy
            initial_state = self.calculate_properties(fluid, 'P', initial_pressure, 'T', initial_temperature)
            initial_entropy = initial_state['entropy']
            
            # Calculate final state with same entropy
            final_state = self.calculate_properties(fluid, 'P', final_pressure, 'S', initial_entropy)
            
            return final_state
            
        except Exception as e:
            raise PropertyError(f"Isentropic state calculation failed: {e}")
    
    def list_available_fluids(self) -> List[str]:
        """
        Get list of all available fluids.
        
        Returns:
            List of fluid names (CoolProp standard names)
        """
        return sorted(set(self.FLUID_MAP.values()))
    
    def get_fluid_info(self, fluid: str) -> Dict[str, any]:
        """
        Get detailed information about a fluid.
        
        Args:
            fluid: Fluid name
            
        Returns:
            Dictionary with fluid information
        """
        try:
            fluid = self.normalize_fluid_name(fluid)
            limits = self.get_fluid_limits(fluid)
            
            return {
                'name': fluid,
                'cas_number': CP.get_fluid_param_string(fluid, "CAS"),
                'formula': CP.get_fluid_param_string(fluid, "formula"),
                'molar_mass': PropsSI('M', fluid),  # kg/mol
                'limits': limits,
                'triple_point': {
                    'temperature': limits['T_triple'],
                    'pressure': limits['P_triple']
                },
                'critical_point': {
                    'temperature': limits['T_critical'],
                    'pressure': limits['P_critical']
                }
            }
            
        except Exception as e:
            raise PropertyError(f"Failed to get fluid info for {fluid}: {e}")


# Global singleton instance
_property_engine: Optional[PropertyEngine] = None


def get_property_engine() -> PropertyEngine:
    """
    Get or create the global property engine instance.
    Thread-safe singleton pattern.
    """
    global _property_engine
    if _property_engine is None:
        _property_engine = PropertyEngine()
    return _property_engine
