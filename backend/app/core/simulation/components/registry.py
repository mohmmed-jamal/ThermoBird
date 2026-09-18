"""
Component Registry - Maps canvas components to transient models
"""

from typing import Dict, List, Callable, Optional, Any
from ..types import ComponentModelDict, ComponentType


# Component Model Registry
COMPONENT_REGISTRY: Dict[str, ComponentModelDict] = {
    # ═══════════════════════════════════════════════════════════════════════════════
    # HEAT EXCHANGERS
    # ═══════════════════════════════════════════════════════════════════════════════
    
    "boiler": {
        "state_vars": ["T_wall", "T_fluid", "h_fluid"],
        "params": [
            "wall_mass", "fluid_mass", "cp_wall",
            "UA_source", "UA_fluid_wall",
            "T_source", "P_operating", "mass_flow"
        ],
        "odes": "boiler_ode",
        "algebraic": ["Q_source_to_wall", "Q_wall_to_fluid", "h_out"],
        "icon": "🔥",
        "category": "heat_exchanger",
        "description": "Heat addition with thermal inertia"
    },
    
    "condenser": {
        "state_vars": ["T_wall", "T_fluid", "h_fluid"],
        "params": [
            "wall_mass", "fluid_mass", "cp_wall",
            "UA_sink", "UA_fluid_wall",
            "T_sink", "P_operating", "mass_flow"
        ],
        "odes": "condenser_ode",
        "algebraic": ["Q_fluid_to_wall", "Q_wall_to_sink", "h_out"],
        "icon": "❄️",
        "category": "heat_exchanger",
        "description": "Heat rejection with thermal inertia"
    },
    
    "evaporator": {
        "state_vars": ["T_wall", "T_refrigerant", "m_vapor", "x"],
        "params": [
            "wall_mass", "UA_source", "UA_fluid_wall",
            "T_source", "P_evap", "mass_flow"
        ],
        "odes": "evaporator_ode",
        "algebraic": ["Q_in", "h_fg", "x_eq"],
        "icon": "🌀",
        "category": "heat_exchanger",
        "description": "Refrigerant evaporation"
    },
    
    "heater": {
        "state_vars": ["T_out"],
        "params": ["UA", "T_source", "mass_flow"],
        "odes": "heater_ode",
        "algebraic": ["Q_in"],
        "icon": "🌡️",
        "category": "heat_exchanger",
        "description": "Simplified heater"
    },
    
    "cooler": {
        "state_vars": ["T_out"],
        "params": ["UA", "T_sink", "mass_flow"],
        "odes": "cooler_ode",
        "algebraic": ["Q_out"],
        "icon": "🧊",
        "category": "heat_exchanger",
        "description": "Simplified cooler"
    },
    
    # ═══════════════════════════════════════════════════════════════════════════════
    # WORK DEVICES
    # ═══════════════════════════════════════════════════════════════════════════════
    
    "turbine": {
        "state_vars": ["omega", "T_out"],
        "params": [
            "inertia", "eta_isentropic",
            "P_in", "P_out", "mass_flow"
        ],
        "odes": "turbine_ode",
        "algebraic": ["W_dot", "h_out", "h_out_isen", "torque"],
        "icon": "⚙️",
        "category": "work_device",
        "description": "Expand fluid to produce work"
    },
    
    "compressor": {
        "state_vars": ["omega", "T_out"],
        "params": [
            "inertia", "eta_isentropic",
            "P_in", "P_out", "displacement", "mass_flow"
        ],
        "odes": "compressor_ode",
        "algebraic": ["W_dot", "h_out", "h_out_isen", "torque"],
        "icon": "🔧",
        "category": "work_device",
        "description": "Compress fluid, consume work"
    },
    
    "pump": {
        "state_vars": ["omega", "T_out"],
        "params": [
            "inertia", "eta_isentropic",
            "P_in", "P_out", "mass_flow"
        ],
        "odes": "pump_ode",
        "algebraic": ["W_dot", "h_out", "h_out_isen", "torque"],
        "icon": "💧",
        "category": "work_device",
        "description": "Pump liquid, consume work"
    },
    
    # ═══════════════════════════════════════════════════════════════════════════════
    # EXPANSION DEVICES
    # ═══════════════════════════════════════════════════════════════════════════════
    
    "throttle": {
        "state_vars": ["T_out", "x"],
        "params": ["C_v", "P_in", "P_out", "mass_flow"],
        "odes": "throttle_ode",
        "algebraic": ["h_out", "x_out"],
        "icon": "🔽",
        "category": "expansion",
        "description": "Isenthalpic expansion"
    },
    
    "expansion_valve": {
        "state_vars": ["T_out", "x"],
        "params": ["orifice_area", "P_in", "P_out", "mass_flow"],
        "odes": "expansion_valve_ode",
        "algebraic": ["h_out", "x_out", "m_dot_actual"],
        "icon": "⬇️",
        "category": "expansion",
        "description": "Refrigerant expansion valve"
    },
    
    # ═══════════════════════════════════════════════════════════════════════════════
    # FLOW COMPONENTS
    # ═══════════════════════════════════════════════════════════════════════════════
    
    "tank": {
        "state_vars": ["m_fluid", "T_fluid", "P_tank", "h_fluid"],
        "params": ["volume", "UA_ambient", "T_ambient"],
        "odes": "tank_ode",
        "algebraic": ["rho", "V_in", "V_out", "Q_loss"],
        "icon": "🛢️",
        "category": "flow",
        "description": "Fluid storage with accumulation"
    },
    
    "splitter": {
        "state_vars": [],  # Algebraic only
        "params": ["split_ratio"],
        "odes": None,
        "algebraic": ["m_dot_1", "m_dot_2"],
        "icon": "⫯",
        "category": "flow",
        "description": "Split flow into two streams"
    },
    
    "mixer": {
        "state_vars": [],  # Algebraic only
        "params": [],
        "odes": None,
        "algebraic": ["h_out", "m_dot_total"],
        "icon": "⫰",
        "category": "flow",
        "description": "Mix two fluid streams"
    },
    
    # ═══════════════════════════════════════════════════════════════════════════════
    # HEAT RECOVERY
    # ═══════════════════════════════════════════════════════════════════════════════
    
    "hrsg": {
        "state_vars": ["T_gas_out", "T_steam_out", "h_steam"],
        "params": [
            "UA_gas", "UA_steam", "T_gas_in",
            "P_steam", "mass_flow_gas", "mass_flow_steam"
        ],
        "odes": "hrsg_ode",
        "algebraic": ["Q_recovered", "epsilon_effectiveness"],
        "icon": "♨️",
        "category": "heat_recovery",
        "description": "Heat recovery steam generator"
    },
    
    "recuperator": {
        "state_vars": ["T_hot_out", "T_cold_out"],
        "params": ["UA", "epsilon", "mass_flow_hot", "mass_flow_cold"],
        "odes": "recuperator_ode",
        "algebraic": ["Q_recuperated"],
        "icon": "🔄",
        "category": "heat_recovery",
        "description": "Internal heat recovery"
    },
}


def get_component_model(comp_type: str) -> Optional[ComponentModelDict]:
    """Get component model metadata"""
    return COMPONENT_REGISTRY.get(comp_type)


def list_component_types(category: Optional[str] = None) -> List[str]:
    """List available component types, optionally filtered by category"""
    if category is None:
        return list(COMPONENT_REGISTRY.keys())
    return [
        name for name, model in COMPONENT_REGISTRY.items()
        if model["category"] == category
    ]


def get_default_params(comp_type: str) -> Dict[str, float]:
    """Get default parameters for a component type"""
    defaults = {
        "boiler": {
            "wall_mass": 200.0,
            "fluid_mass": 80.0,
            "cp_wall": 500.0,
            "UA_source": 5000.0,
            "UA_fluid_wall": 2000.0,
            "T_source": 900.0,
            "P_operating": 3_000_000.0,
            "mass_flow": 2.5,
        },
        "condenser": {
            "wall_mass": 150.0,
            "fluid_mass": 60.0,
            "cp_wall": 500.0,
            "UA_sink": 3000.0,
            "UA_fluid_wall": 1500.0,
            "T_sink": 298.15,
            "P_operating": 10_000.0,
            "mass_flow": 2.5,
        },
        "turbine": {
            "inertia": 10.0,
            "eta_isentropic": 0.85,
            "P_in": 3_000_000.0,
            "P_out": 10_000.0,
            "mass_flow": 2.5,
        },
        "compressor": {
            "inertia": 5.0,
            "eta_isentropic": 0.80,
            "P_in": 100_000.0,
            "P_out": 1_000_000.0,
            "displacement": 0.001,
            "mass_flow": 0.1,
        },
        "pump": {
            "inertia": 2.0,
            "eta_isentropic": 0.80,
            "P_in": 10_000.0,
            "P_out": 3_000_000.0,
            "mass_flow": 2.5,
        },
        "throttle": {
            "C_v": 0.5,
            "P_in": 3_000_000.0,
            "P_out": 10_000.0,
            "mass_flow": 2.5,
        },
    }
    return defaults.get(comp_type, {})


def get_default_initial_conditions(comp_type: str) -> Dict[str, float]:
    """Get default initial conditions for a component type"""
    ics = {
        "boiler": {
            "T_wall": 330.0,
            "T_fluid": 320.0,
            "h_fluid": 300_000.0,
        },
        "condenser": {
            "T_wall": 310.0,
            "T_fluid": 320.0,
            "h_fluid": 200_000.0,
        },
        "turbine": {
            "omega": 0.0,
            "T_out": 320.0,
        },
        "compressor": {
            "omega": 0.0,
            "T_out": 320.0,
        },
        "pump": {
            "omega": 0.0,
            "T_out": 320.0,
        },
        "tank": {
            "m_fluid": 100.0,
            "T_fluid": 300.0,
            "P_tank": 101325.0,
            "h_fluid": 100_000.0,
        },
    }
    return ics.get(comp_type, {"T": 300.0})


def requires_transient_model(comp_type: str) -> bool:
    """Check if component has transient dynamics"""
    model = get_component_model(comp_type)
    if model is None:
        return False
    return model["odes"] is not None
