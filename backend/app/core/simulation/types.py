"""
Core type definitions for the unified simulation engine
"""

from __future__ import annotations
from typing import Literal, Dict, List, Any, Optional, TypedDict
from dataclasses import dataclass, field
from enum import Enum
import numpy as np


class SimulationMode(str, Enum):
    """Simulation methodology"""
    STEADY_STATE = "steady_state"
    TRANSIENT = "transient"
    PARAMETRIC = "parametric"


class ComponentType(str, Enum):
    """Available component types"""
    # Heat exchangers
    BOILER = "boiler"
    CONDENSER = "condenser"
    EVAPORATOR = "evaporator"
    HEATER = "heater"
    COOLER = "cooler"
    
    # Work devices
    TURBINE = "turbine"
    COMPRESSOR = "compressor"
    PUMP = "pump"
    
    # Expansion
    THROTTLE = "throttle"
    EXPANSION_VALVE = "expansion_valve"
    
    # Flow manipulation
    TANK = "tank"
    SPLITTER = "splitter"
    MIXER = "mixer"
    
    # Heat recovery
    HRSG = "hrsg"
    RECUPERATOR = "recuperator"
    REGENERATOR = "regenerator"


@dataclass
class ComponentParams:
    """Base component parameters"""
    name: str = ""
    type: ComponentType = ComponentType.BOILER
    
    # Thermal mass parameters
    wall_mass: float = 100.0  # kg
    fluid_mass: float = 50.0  # kg
    cp_wall: float = 500.0  # J/kg·K
    
    # Heat transfer
    UA_source: float = 5000.0  # W/K
    UA_sink: float = 5000.0  # W/K
    UA_fluid_wall: float = 2000.0  # W/K
    
    # Operating conditions
    P_operating: float = 101325.0  # Pa
    T_source: float = 600.0  # K
    T_sink: float = 300.0  # K
    mass_flow: float = 1.0  # kg/s
    
    # Efficiency
    eta_isentropic: float = 0.85
    eta_mech: float = 0.95
    
    # Geometry/Inertia
    inertia: float = 10.0  # kg·m²
    volume: float = 0.1  # m³
    
    # Custom params
    custom: Dict[str, float] = field(default_factory=dict)


@dataclass
class StateVariable:
    """Thermodynamic state variable"""
    name: str
    value: float
    unit: str
    description: str = ""


@dataclass
class ComponentState:
    """State of a component at a point in time"""
    component_id: str
    T: float = 300.0  # K
    P: float = 101325.0  # Pa
    h: float = 0.0  # J/kg
    s: float = 0.0  # J/kg·K
    x: Optional[float] = None  # Quality
    psi: float = 0.0  # Specific exergy, J/kg
    m_dot: float = 1.0  # kg/s
    
    # Transient-specific
    T_wall: Optional[float] = None
    omega: Optional[float] = None  # Rotational speed rad/s


@dataclass
class SimulationConfig:
    """Complete simulation configuration"""
    mode: SimulationMode = SimulationMode.STEADY_STATE
    
    # Canvas configuration
    components: List[Dict[str, Any]] = field(default_factory=list)
    connections: List[Dict[str, Any]] = field(default_factory=list)
    
    # Working fluid
    fluid: str = "Water"
    
    # Dead state for exergy
    T0: float = 298.15  # K
    P0: float = 101325.0  # Pa
    
    # Transient settings
    t_end: float = 600.0  # s
    t_steps: int = 500
    solver_method: str = "Auto"
    stiffness_detection: bool = True
    rtol: float = 1e-4
    atol: float = 1e-6
    
    # Steady-state settings
    max_iterations: int = 100
    tolerance: float = 1e-6
    
    # Equation solver integration
    tbs_script: Optional[str] = None
    use_tbs_for_ic: bool = False


@dataclass
class TimePointResult:
    """Results at a single time point"""
    t: float
    component_states: Dict[str, ComponentState]
    
    # Global metrics
    W_net: float = 0.0  # W
    Q_in: float = 0.0  # W
    Q_out: float = 0.0  # W
    eta_thermal: float = 0.0
    eta_carnot: float = 0.0
    epsilon_exergy: float = 0.0
    
    # Exergy destruction by component
    exergy_destruction: Dict[str, float] = field(default_factory=dict)
    
    # Entropy generation by component
    entropy_generation: Dict[str, float] = field(default_factory=dict)


@dataclass
class SimulationResult:
    """Complete simulation results"""
    success: bool
    mode: SimulationMode
    cycle_type: str
    
    # Time series (for transient)
    time: List[float] = field(default_factory=list)
    time_points: List[TimePointResult] = field(default_factory=list)
    
    # Steady-state result (single point)
    steady_state: Optional[TimePointResult] = None
    
    # State points table
    state_points: List[Dict[str, Any]] = field(default_factory=list)
    
    # Component-level results
    component_results: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    
    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    
    # Solver info
    solver_iterations: int = 0
    solver_nfev: int = 0
    execution_time_ms: int = 0


# Type aliases for numpy arrays
ArrayF64 = np.ndarray[Any, np.dtype[np.float64]]


class ComponentModelDict(TypedDict):
    """Component model metadata"""
    state_vars: List[str]
    params: List[str]
    odes: str
    algebraic: List[str]
    icon: str
    category: str
    description: str
