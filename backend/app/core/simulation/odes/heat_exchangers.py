"""
ODE models for heat exchangers with thermal inertia
"""

import numpy as np
from typing import Dict, Callable, Tuple
import CoolProp.CoolProp as CP


def boiler_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Boiler transient model with wall thermal inertia
    
    State variables:
        y[0] = T_wall (wall temperature, K)
        y[1] = T_fluid (fluid temperature, K)
        y[2] = h_fluid (fluid specific enthalpy, J/kg)
    
    Parameters:
        wall_mass, cp_wall: Wall thermal mass
        UA_source: Heat transfer from source to wall
        UA_fluid_wall: Heat transfer from wall to fluid
        T_source: Heat source temperature
        P_operating: Operating pressure
        mass_flow: Mass flow rate
    """
    T_wall, T_fluid, h_fluid = y
    
    # Extract parameters
    m_wall = params.get('wall_mass', 200.0)
    cp_wall = params.get('cp_wall', 500.0)
    m_fluid = params.get('fluid_mass', 80.0)
    UA_source = params.get('UA_source', 5000.0)
    UA_fw = params.get('UA_fluid_wall', 2000.0)
    T_source = params.get('T_source', 900.0)
    P_op = params.get('P_operating', 3e6)
    m_dot = params.get('mass_flow', 2.5)
    
    # Inlet conditions
    if inlet_state:
        h_in = inlet_state.get('h', h_fluid)
        T_in = inlet_state.get('T', T_fluid)
    else:
        h_in = h_fluid
        T_in = T_fluid
    
    try:
        # Get fluid properties
        rho_fluid = CP.PropsSI('D', 'H', h_fluid, 'P', P_op, fluid)
        cp_fluid = CP.PropsSI('C', 'H', h_fluid, 'P', P_op, fluid)
        
        # Heat transfers
        Q_source_to_wall = UA_source * (T_source - T_wall)
        Q_wall_to_fluid = UA_fw * (T_wall - T_fluid)
        
        # Wall energy balance: dT_wall/dt
        dT_wall_dt = (Q_source_to_wall - Q_wall_to_fluid) / (m_wall * cp_wall)
        
        # Fluid energy balance: dT_fluid/dt (lumped capacitance)
        V_fluid = m_fluid / rho_fluid
        E_fluid = m_fluid * h_fluid
        
        # Energy in - energy out + heat transfer
        h_out = h_fluid  # Simplified
        dE_dt = m_dot * (h_in - h_out) + Q_wall_to_fluid
        dh_dt = dE_dt / m_fluid
        
        # Temperature derivative (for tracking, not primary state)
        dT_dt = dh_dt / cp_fluid if cp_fluid > 0 else 0
        
    except Exception as e:
        # CoolProp failure - return zero derivatives
        dT_wall_dt = 0.0
        dh_dt = 0.0
        dT_dt = 0.0
    
    return np.array([dT_wall_dt, dT_dt, dh_dt])


def condenser_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Condenser transient model with thermal inertia
    
    State variables:
        y[0] = T_wall (K)
        y[1] = T_fluid (K)
        y[2] = h_fluid (J/kg)
    """
    T_wall, T_fluid, h_fluid = y
    
    # Parameters
    m_wall = params.get('wall_mass', 150.0)
    cp_wall = params.get('cp_wall', 500.0)
    m_fluid = params.get('fluid_mass', 60.0)
    UA_sink = params.get('UA_sink', 3000.0)
    UA_fw = params.get('UA_fluid_wall', 1500.0)
    T_sink = params.get('T_sink', 298.15)
    P_op = params.get('P_operating', 10e3)
    m_dot = params.get('mass_flow', 2.5)
    
    # Inlet
    if inlet_state:
        h_in = inlet_state.get('h', h_fluid)
    else:
        h_in = h_fluid
    
    try:
        # Heat transfers
        Q_fluid_to_wall = UA_fw * (T_fluid - T_wall)
        Q_wall_to_sink = UA_sink * (T_wall - T_sink)
        
        # Wall balance
        dT_wall_dt = (Q_fluid_to_wall - Q_wall_to_sink) / (m_wall * cp_wall)
        
        # Fluid balance
        Q_out = m_dot * (h_in - h_fluid) if h_in > h_fluid else 0
        dh_dt = (-Q_fluid_to_wall + m_dot * (h_in - h_fluid)) / m_fluid
        
        # Temperature derivative
        cp_fluid = CP.PropsSI('C', 'H', h_fluid, 'P', P_op, fluid)
        dT_dt = dh_dt / cp_fluid if cp_fluid > 0 else 0
        
    except:
        dT_wall_dt = 0.0
        dT_dt = 0.0
        dh_dt = 0.0
    
    return np.array([dT_wall_dt, dT_dt, dh_dt])


def evaporator_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Evaporator with phase change (refrigeration)
    
    State variables:
        y[0] = T_wall (K)
        y[1] = T_refrigerant (K)
        y[2] = m_vapor (kg) - mass of vapor generated
        y[3] = x (quality)
    """
    T_wall, T_ref, m_vapor, x = y
    
    m_wall = params.get('wall_mass', 100.0)
    cp_wall = params.get('cp_wall', 500.0)
    UA_source = params.get('UA_source', 3000.0)
    UA_fr = params.get('UA_fluid_wall', 1500.0)
    T_source = params.get('T_source', 300.0)
    P_evap = params.get('P_evap', 3e5)
    m_dot = params.get('mass_flow', 0.1)
    
    try:
        # Saturation properties at evaporation pressure
        T_sat = CP.PropsSI('T', 'P', P_evap, 'Q', 0, fluid)
        h_fg = CP.PropsSI('H', 'P', P_evap, 'Q', 1, fluid) - CP.PropsSI('H', 'P', P_evap, 'Q', 0, fluid)
        
        # Heat transfers
        Q_source_to_wall = UA_source * (T_source - T_wall)
        Q_wall_to_ref = UA_fr * (T_wall - T_ref)
        
        # Wall temperature derivative
        dT_wall_dt = (Q_source_to_wall - Q_wall_to_ref) / (m_wall * cp_wall)
        
        # Refrigerant at saturation during evaporation
        dT_ref_dt = 0.0  # Fixed at saturation
        
        # Vapor generation rate
        if T_ref >= T_sat and Q_wall_to_ref > 0:
            dm_vapor_dt = Q_wall_to_ref / h_fg
        else:
            dm_vapor_dt = 0.0
        
        # Quality change
        dx_dt = dm_vapor_dt / m_dot if m_dot > 0 else 0
        
    except:
        dT_wall_dt = 0.0
        dT_ref_dt = 0.0
        dm_vapor_dt = 0.0
        dx_dt = 0.0
    
    return np.array([dT_wall_dt, dT_ref_dt, dm_vapor_dt, dx_dt])


def heater_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """Simplified heater (no thermal mass)"""
    T_out = y[0]
    
    UA = params.get('UA', 1000.0)
    T_source = params.get('T_source', 500.0)
    m_dot = params.get('mass_flow', 1.0)
    
    if inlet_state:
        T_in = inlet_state.get('T', T_out)
    else:
        T_in = T_out
    
    # Effectiveness-NTU approach
    C_min = m_dot * 1000  # Approximate cp
    NTU = UA / C_min if C_min > 0 else 0
    eps = 1 - np.exp(-NTU)
    
    Q_max = C_min * (T_source - T_in)
    Q_actual = eps * Q_max
    
    # Simplified ODE
    dT_dt = (Q_actual / (m_dot * 1000)) / 10  # Time constant ~10s
    
    return np.array([dT_dt])


def cooler_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """Simplified cooler (no thermal mass)"""
    T_out = y[0]
    
    UA = params.get('UA', 1000.0)
    T_sink = params.get('T_sink', 300.0)
    m_dot = params.get('mass_flow', 1.0)
    
    if inlet_state:
        T_in = inlet_state.get('T', T_out)
    else:
        T_in = T_out
    
    C_min = m_dot * 1000
    NTU = UA / C_min if C_min > 0 else 0
    eps = 1 - np.exp(-NTU)
    
    Q_max = C_min * (T_in - T_sink)
    Q_actual = eps * Q_max
    
    dT_dt = -(Q_actual / (m_dot * 1000)) / 10
    
    return np.array([dT_dt])
