"""
Base component class for all thermodynamic components.
Defines the interface and common functionality for pumps, turbines, heat exchangers, etc.
"""
from abc import ABC, abstractmethod
from typing import Dict, Optional, List, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
import logging

from app.core.property_engine import PropertyEngine, get_property_engine, PropertyError

logger = logging.getLogger(__name__)


class ComponentType(str, Enum):
    """Enumeration of component types."""
    PUMP = "pump"
    COMPRESSOR = "compressor"
    TURBINE = "turbine"
    HEAT_EXCHANGER = "heat_exchanger"
    BOILER = "boiler"
    CONDENSER = "condenser"
    EVAPORATOR = "evaporator"
    EXPANSION_VALVE = "expansion_valve"
    REGENERATOR = "regenerator"
    MIXING_CHAMBER = "mixing_chamber"
    SPLITTER = "splitter"
    CUSTOM = "custom"


class PortType(str, Enum):
    """Port types for component connections."""
    INLET = "inlet"
    OUTLET = "outlet"
    HOT_INLET = "hot_inlet"
    HOT_OUTLET = "hot_outlet"
    COLD_INLET = "cold_inlet"
    COLD_OUTLET = "cold_outlet"


@dataclass
class ThermodynamicState:
    """
    Represents the thermodynamic state at a point in the cycle.
    All properties in SI units.
    """
    fluid: str
    temperature: Optional[float] = None      # K
    pressure: Optional[float] = None         # Pa
    enthalpy: Optional[float] = None         # J/kg
    entropy: Optional[float] = None          # J/(kg·K)
    density: Optional[float] = None          # kg/m³
    quality: Optional[float] = None          # 0-1 (None for single-phase)
    internal_energy: Optional[float] = None  # J/kg
    cp: Optional[float] = None               # J/(kg·K)
    cv: Optional[float] = None               # J/(kg·K)
    viscosity: Optional[float] = None        # Pa·s
    conductivity: Optional[float] = None     # W/(m·K)
    phase: Optional[str] = None              # 'liquid', 'vapor', 'two_phase', 'supercritical'
    
    # Mass flow rate (kg/s) - component-level property
    mass_flow: Optional[float] = None
    
    def is_fully_defined(self) -> bool:
        """Check if state has minimum required properties (any two intensive properties)."""
        defined_props = sum([
            self.temperature is not None,
            self.pressure is not None,
            self.enthalpy is not None,
            self.entropy is not None,
            self.quality is not None
        ])
        return defined_props >= 2
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert state to dictionary."""
        return {
            'fluid': self.fluid,
            'temperature': self.temperature,
            'pressure': self.pressure,
            'enthalpy': self.enthalpy,
            'entropy': self.entropy,
            'density': self.density,
            'quality': self.quality,
            'internal_energy': self.internal_energy,
            'cp': self.cp,
            'cv': self.cv,
            'viscosity': self.viscosity,
            'conductivity': self.conductivity,
            'phase': self.phase,
            'mass_flow': self.mass_flow
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ThermodynamicState':
        """Create state from dictionary."""
        return cls(**data)
    
    def copy(self) -> 'ThermodynamicState':
        """Create a copy of this state."""
        return ThermodynamicState(**self.to_dict())


@dataclass
class ComponentPort:
    """Represents a connection port on a component."""
    name: str
    port_type: PortType
    state: Optional[ThermodynamicState] = None
    connected_to: Optional[str] = None  # Component ID this port connects to
    
    def is_connected(self) -> bool:
        """Check if port is connected."""
        return self.connected_to is not None
    
    def has_state(self) -> bool:
        """Check if port has a defined state."""
        return self.state is not None and self.state.is_fully_defined()


@dataclass
class ComponentResult:
    """Results from component calculations."""
    success: bool
    inlet_state: Optional[ThermodynamicState] = None
    outlet_state: Optional[ThermodynamicState] = None
    work: Optional[float] = None              # W (positive = work out, negative = work in)
    heat: Optional[float] = None              # W (positive = heat in, negative = heat out)
    efficiency: Optional[float] = None        # 0-1
    entropy_generation: Optional[float] = None  # W/K
    exergy_destruction: Optional[float] = None  # W
    error_message: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return {
            'success': self.success,
            'inlet_state': self.inlet_state.to_dict() if self.inlet_state else None,
            'outlet_state': self.outlet_state.to_dict() if self.outlet_state else None,
            'work': self.work,
            'heat': self.heat,
            'efficiency': self.efficiency,
            'entropy_generation': self.entropy_generation,
            'exergy_destruction': self.exergy_destruction,
            'error_message': self.error_message,
            'warnings': self.warnings,
            'metadata': self.metadata
        }


class BaseComponent(ABC):
    """
    Abstract base class for all thermodynamic components.
    Defines the interface that all components must implement.
    """
    
    def __init__(
        self,
        component_id: str,
        name: str,
        component_type: ComponentType,
        parameters: Dict[str, Any]
    ):
        """
        Initialize base component.
        
        Args:
            component_id: Unique identifier for this component
            name: Human-readable name
            component_type: Type of component
            parameters: Component-specific parameters
        """
        self.id = component_id
        self.name = name
        self.component_type = component_type
        self.parameters = parameters
        self.ports: Dict[str, ComponentPort] = {}
        self._property_engine = get_property_engine()
        self._initialized = False
        
        # Initialize component-specific ports
        self._initialize_ports()
        self._initialized = True
    
    @abstractmethod
    def _initialize_ports(self) -> None:
        """Initialize component ports. Must be implemented by subclass."""
        pass
    
    @abstractmethod
    def calculate(self) -> ComponentResult:
        """
        Perform thermodynamic calculations for this component.
        Must be implemented by subclass.
        
        Returns:
            ComponentResult with calculated states and performance metrics
        """
        pass
    
    @abstractmethod
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """
        Validate component parameters.
        
        Returns:
            Tuple of (is_valid, list_of_error_messages)
        """
        pass
    
    def add_port(self, name: str, port_type: PortType) -> None:
        """Add a port to this component."""
        self.ports[name] = ComponentPort(name=name, port_type=port_type)
    
    def get_port(self, name: str) -> Optional[ComponentPort]:
        """Get a port by name."""
        return self.ports.get(name)
    
    def set_inlet_state(self, state: ThermodynamicState, port_name: str = "inlet") -> None:
        """Set the inlet state for this component."""
        port = self.get_port(port_name)
        if port is None:
            raise ValueError(f"Port '{port_name}' not found on component '{self.name}'")
        port.state = state
    
    def get_inlet_state(self, port_name: str = "inlet") -> Optional[ThermodynamicState]:
        """Get the inlet state for this component."""
        port = self.get_port(port_name)
        return port.state if port else None
    
    def set_outlet_state(self, state: ThermodynamicState, port_name: str = "outlet") -> None:
        """Set the outlet state for this component."""
        port = self.get_port(port_name)
        if port is None:
            raise ValueError(f"Port '{port_name}' not found on component '{self.name}'")
        port.state = state
    
    def get_outlet_state(self, port_name: str = "outlet") -> Optional[ThermodynamicState]:
        """Get the outlet state for this component."""
        port = self.get_port(port_name)
        return port.state if port else None
    
    def connect_to(self, other_component: 'BaseComponent', from_port: str, to_port: str) -> None:
        """
        Connect this component to another component.
        
        Args:
            other_component: Component to connect to
            from_port: Port name on this component
            to_port: Port name on other component
        """
        self_port = self.get_port(from_port)
        other_port = other_component.get_port(to_port)
        
        if self_port is None:
            raise ValueError(f"Port '{from_port}' not found on component '{self.name}'")
        if other_port is None:
            raise ValueError(f"Port '{to_port}' not found on component '{other_component.name}'")
        
        self_port.connected_to = other_component.id
    
    def has_sufficient_inlet_data(self) -> bool:
        """Check if component has sufficient inlet data to perform calculations."""
        for port in self.ports.values():
            if port.port_type in [PortType.INLET, PortType.HOT_INLET, PortType.COLD_INLET]:
                if not port.has_state():
                    return False
        return True
    
    def calculate_properties(
        self,
        fluid: str,
        input1_type: str,
        input1_value: float,
        input2_type: str,
        input2_value: float
    ) -> ThermodynamicState:
        """
        Helper method to calculate full thermodynamic state.
        
        Args:
            fluid: Fluid name
            input1_type: First property type
            input1_value: First property value
            input2_type: Second property type
            input2_value: Second property value
            
        Returns:
            ThermodynamicState with all calculated properties
        """
        try:
            props = self._property_engine.calculate_properties(
                fluid, input1_type, input1_value, input2_type, input2_value
            )
            
            return ThermodynamicState(
                fluid=props['fluid'],
                temperature=props['temperature'],
                pressure=props['pressure'],
                enthalpy=props['enthalpy'],
                entropy=props['entropy'],
                density=props['density'],
                quality=props['quality'],
                internal_energy=props['internal_energy'],
                cp=props['cp'],
                cv=props['cv'],
                viscosity=props['viscosity'],
                conductivity=props['conductivity'],
                phase=props['phase']
            )
        except PropertyError as e:
            logger.error(f"Property calculation failed in {self.name}: {e}")
            raise
    
    def get_isentropic_outlet(
        self,
        inlet_state: ThermodynamicState,
        outlet_pressure: float
    ) -> ThermodynamicState:
        """
        Calculate isentropic outlet state.
        
        Args:
            inlet_state: Inlet thermodynamic state
            outlet_pressure: Outlet pressure (Pa)
            
        Returns:
            Outlet state assuming isentropic process
        """
        try:
            props = self._property_engine.get_isentropic_state(
                inlet_state.fluid,
                inlet_state.pressure,
                inlet_state.temperature,
                outlet_pressure
            )
            
            return ThermodynamicState(
                fluid=props['fluid'],
                temperature=props['temperature'],
                pressure=props['pressure'],
                enthalpy=props['enthalpy'],
                entropy=props['entropy'],
                density=props['density'],
                quality=props['quality'],
                internal_energy=props['internal_energy'],
                cp=props['cp'],
                cv=props['cv'],
                phase=props['phase']
            )
        except PropertyError as e:
            logger.error(f"Isentropic state calculation failed in {self.name}: {e}")
            raise
    
    def get_parameter(self, key: str, default: Any = None) -> Any:
        """Get a parameter value with optional default."""
        return self.parameters.get(key, default)
    
    def set_parameter(self, key: str, value: Any) -> None:
        """Set a parameter value."""
        self.parameters[key] = value
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert component to dictionary representation."""
        return {
            'id': self.id,
            'name': self.name,
            'type': self.component_type.value,
            'parameters': self.parameters,
            'ports': {
                name: {
                    'type': port.port_type.value,
                    'connected_to': port.connected_to,
                    'state': port.state.to_dict() if port.state else None
                }
                for name, port in self.ports.items()
            }
        }
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id='{self.id}', name='{self.name}')>"


class SingleInletOutletComponent(BaseComponent):
    """
    Base class for components with single inlet and outlet.
    Most components (pump, turbine, valve, etc.) inherit from this.
    """
    
    def _initialize_ports(self) -> None:
        """Initialize standard inlet and outlet ports."""
        self.add_port("inlet", PortType.INLET)
        self.add_port("outlet", PortType.OUTLET)
    
    def calculate(self) -> ComponentResult:
        """Must be implemented by concrete subclass."""
        raise NotImplementedError(f"Subclass {self.__class__.__name__} must implement calculate()")
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Must be implemented by concrete subclass."""
        raise NotImplementedError(f"Subclass {self.__class__.__name__} must implement validate_parameters()")
    
    def get_mass_flow(self) -> Optional[float]:
        """Get mass flow rate from inlet or parameters."""
        inlet_state = self.get_inlet_state()
        if inlet_state and inlet_state.mass_flow is not None:
            return inlet_state.mass_flow
        return self.get_parameter("mass_flow")
    
    def set_mass_flow(self, mass_flow: float) -> None:
        """Set mass flow rate."""
        inlet_state = self.get_inlet_state()
        if inlet_state:
            inlet_state.mass_flow = mass_flow
        else:
            self.set_parameter("mass_flow", mass_flow)


class HeatExchangerBase(BaseComponent):
    """
    Base class for heat exchangers (two fluid streams).
    Boiler, condenser, evaporator inherit from this.
    """
    
    def _initialize_ports(self) -> None:
        """Initialize hot and cold side ports."""
        self.add_port("hot_inlet", PortType.HOT_INLET)
        self.add_port("hot_outlet", PortType.HOT_OUTLET)
        self.add_port("cold_inlet", PortType.COLD_INLET)
        self.add_port("cold_outlet", PortType.COLD_OUTLET)
    
    def calculate(self) -> ComponentResult:
        """Must be implemented by concrete subclass."""
        raise NotImplementedError(f"Subclass {self.__class__.__name__} must implement calculate()")
    
    def validate_parameters(self) -> Tuple[bool, List[str]]:
        """Must be implemented by concrete subclass."""
        raise NotImplementedError(f"Subclass {self.__class__.__name__} must implement validate_parameters()")
    
    def get_hot_side_states(self) -> Tuple[Optional[ThermodynamicState], Optional[ThermodynamicState]]:
        """Get hot side inlet and outlet states."""
        return (self.get_inlet_state("hot_inlet"), self.get_outlet_state("hot_outlet"))
    
    def get_cold_side_states(self) -> Tuple[Optional[ThermodynamicState], Optional[ThermodynamicState]]:
        """Get cold side inlet and outlet states."""
        return (self.get_inlet_state("cold_inlet"), self.get_outlet_state("cold_outlet"))
