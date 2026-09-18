"""
ODE models for work devices (turbines, compressors, pumps)
"""

import numpy as np
from typing import Dict
import CoolProp.CoolProp as CP


def turbine_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Turbine with rotational inertia
    
    State variables:
        y[0] = omega (rotational speed, rad/s)
        y[1] = T_out (outlet temperature, K)
    
    Parameters:
        inertia: Rotational inertia (kg·m²)
        eta_isentropic: Isentropic efficiency
        P_in, P_out: Inlet/outlet pressure
        mass_flow: Mass flow rate
    """
    omega, T_out = y
    
    inertia = params.get('inertia', 10.0)
    eta_s = params.get('eta_isentropic', 0.85)
    P_in = params.get('P_in', 3e6)
    P_out = params.get('P_out', 10e3)
    m_dot = params.get('mass_flow', 2.5)
    
    try:
        # Inlet state
        if inlet_state:
            h_in = inlet_state.get('h', 0)
            s_in = inlet_state.get('s', 0)
            T_in = inlet_state.get('T', 500)
        else:
            # Assume saturated vapor at P_in
            T_in = CP.PropsSI('T', 'P', P_in, 'Q', 1, fluid)
            h_in = CP.PropsSI('H', 'P', P_in, 'Q', 1, fluid)
            s_in = CP.PropsSI('S', 'P', P_in, 'Q', 1, fluid)
        
        # Isentropic outlet
        h_out_isen = CP.PropsSI('H', 'P', P_out, 'S', s_in, fluid)
        T_out_isen = CP.PropsSI('T', 'P', P_out, 'S', s_in, fluid)
        
        # Actual outlet (with efficiency)
        h_out = h_in - eta_s * (h_in - h_out_isen)
        
        # Power output
        W_dot = m_dot * (h_in - h_out)
        
        # Torque (simplified - assume load proportional to omega)
        load_torque = 0.1 * omega  # Linear load model
        generated_torque = W_dot / omega if omega > 1 else W_dot
        
        # Rotational dynamics: I * d(omega)/dt = torque_net
        domega_dt = (generated_torque - load_torque) / inertia
        
        # Temperature dynamics (thermal lag)
        T_out_actual = CP.PropsSI('T', 'P', P_out, 'H', h_out, fluid)
        dT_dt = (T_out_actual - T_out) / 5.0  # Time constant 5s
        
    except Exception as e:
        domega_dt = 0.0
        dT_dt = 0.0
    
    return np.array([domega_dt, dT_dt])


def compressor_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Compressor with rotational inertia
    
    State variables:
        y[0] = omega (rotational speed, rad/s)
        y[1] = T_out (outlet temperature, K)
    """
    omega, T_out = y
    
    inertia = params.get('inertia', 5.0)
    eta_s = params.get('eta_isentropic', 0.80)
    P_in = params.get('P_in', 1e5)
    P_out = params.get('P_out', 1e6)
    displacement = params.get('displacement', 0.001)
    m_dot = params.get('mass_flow', 0.1)
    
    try:
        # Inlet state
        if inlet_state:
            h_in = inlet_state.get('h', 0)
            s_in = inlet_state.get('s', 0)
            T_in = inlet_state.get('T', 300)
        else:
            T_in = 300
            h_in = CP.PropsSI('H', 'T', T_in, 'P', P_in, fluid)
            s_in = CP.PropsSI('S', 'T', T_in, 'P', P_in, fluid)
        
        # Isentropic outlet
        h_out_isen = CP.PropsSI('H', 'P', P_out, 'S', s_in, fluid)
        
        # Actual outlet (compressor work input)
        h_out = h_in + (h_out_isen - h_in) / eta_s
        
        # Power input (negative for work input)
        W_dot = m_dot * (h_out - h_in)
        
        # Torque balance
        load_torque = 0.2 * omega
        required_torque = W_dot / omega if omega > 1 else W_dot
        
        domega_dt = (load_torque - required_torque) / inertia
        
        # Temperature dynamics
        T_out_actual = CP.PropsSI('T', 'P', P_out, 'H', h_out, fluid)
        dT_dt = (T_out_actual - T_out) / 3.0  # Faster thermal response
        
    except:
        domega_dt = 0.0
        dT_dt = 0.0
    
    return np.array([domega_dt, dT_dt])


def pump_ode(
    t: float,
    y: np.ndarray,
    params: Dict[str, float],
    fluid: str,
    inlet_state: Dict[str, float] = None
) -> np.ndarray:
    """
    Pump with rotational inertia (for liquids)
    
    State variables:
        y[0] = omega (rad/s)
        y[1] = T_out (K)
    """
    omega, T_out = y
    
    inertia = params.get('inertia', 2.0)
    eta_s = params.get('eta_isentropic', 0.80)
    P_in = params.get('P_in', 10e3)
    P_out = params.get('P_out', 3e6)
    m_dot = params.get('mass_flow', 2.5)
    
    try:
        # Inlet state (subcooled liquid)
        if inlet_state:
            h_in = inlet_state.get('h', 0)
            T_in = inlet_state.get('T', 320)
            v_in = inlet_state.get('v', 0.001)  # Specific volume
        else:
            T_in = CP.PropsSI('T', 'P', P_in, 'Q', 0, fluid)
            h_in = CP.PropsSI('H', 'P', P_in, 'Q', 0, fluid)
            v_in = 1.0 / CP.PropsSI('D', 'P', P_in, 'Q', 0, fluid)
        
        # Isentropic work for pump (incompressible)
        w_pump_isen = v_in * (P_out - P_in)
        h_out_isen = h_in + w_pump_isen
        
        # Actual work
        w_pump = w_pump_isen / eta_s
        h_out = h_in + w_pump
        
        # Power
        W_dot = m_dot * w_pump
        
        # Rotational dynamics
        load_torque = 0.15 * omega
        required_torque = W_dot / omega if omega > 1 else W_dot
        
        domega_dt = (load_torque - required_torque) / inertia
        
        # Temperature rise (minimal for liquids)
        T_out_actual = T_in + w_pump / 4184  # Approx cp = 4184 J/kg·K
        dT_dt = (T_out_actual - T_out) / 2.0
        
    except:
        domega_dt = 0.0
        dT_dt = 0.0
    
    return np.array([domega_dt, dT_dt])
