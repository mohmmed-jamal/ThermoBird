"""
ThermoBird — NaK (Sodium-Potassium) Eutectic Property Functions
================================================================
Simplified correlations for NaK-22 (22% Na, 78% K by weight) liquid metal.

Temperature range: 260–820 K (-13 to 547°C)
Pressure range: 0.1–30 MPa

Based on:
- Levi, E. (1970): "Liquid Metals Handbook: Sodium-NaK Supplement"
- IAEA TECDOC-1289 (2002): "Thermophysical properties of materials for water cooled reactors"

Units (consistent with ThermoBird):
- Temperature: K
- Pressure: Pa
- Enthalpy: kJ/kg
- Entropy: kJ/(kg·K)
- Density: kg/m³
"""
import math

# NaK-22 properties
MW_NAK = 680.6  # g/mol (approximate for 22% Na, 78% K mixture)

def enthalpy_nak(T_kelvin: float, P_pascal: float = 101325.0) -> float:
    """
    Specific enthalpy of NaK-22.
    
    Parameters:
    -----------
    T_kelvin : float
        Temperature in Kelvin
    P_pascal : float
        Pressure in Pascal (has minimal effect on liquid metal enthalpy)
    
    Returns:
    --------
    h : float
        Specific enthalpy in J/kg (will be converted to kJ/kg by solver)
    """
    # Clamp to valid range
    T = max(260.0, min(820.0, T_kelvin))
    
    # Reference state: h = 0 at T_ref = 273.15 K
    T_ref = 273.15
    
    # Specific heat capacity correlation (J/(kg·K))
    # cp = a + b*T (linear approximation)
    # For NaK-22: cp ≈ 946 J/(kg·K) at 373 K
    a = 800.0
    b = 0.4
    cp_avg = a + b * ((T + T_ref) / 2.0)
    
    # Enthalpy: h = ∫cp dT from T_ref to T
    # For linear cp: h = a*(T - T_ref) + (b/2)*(T² - T_ref²)
    h = a * (T - T_ref) + (b / 2.0) * (T**2 - T_ref**2)
    
    return h  # J/kg


def entropy_nak(T_kelvin: float) -> float:
    """
    Specific entropy of NaK-22.
    
    Parameters:
    -----------
    T_kelvin : float
        Temperature in Kelvin
    
    Returns:
    --------
    s : float
        Specific entropy in J/(kg·K) (will be converted to kJ/(kg·K) by solver)
    """
    # Clamp to valid range
    T = max(260.0, min(820.0, T_kelvin))
    
    # Reference state: s = 0 at T_ref = 273.15 K
    T_ref = 273.15
    
    # Specific heat capacity correlation (same as enthalpy)
    a = 800.0
    b = 0.4
    
    # Entropy: s = ∫(cp/T) dT from T_ref to T
    # For cp = a + b*T: s = a*ln(T/T_ref) + b*(T - T_ref)
    s = a * math.log(T / T_ref) + b * (T - T_ref)
    
    return s  # J/(kg·K)


def density_nak(T_kelvin: float) -> float:
    """
    Density of NaK-22.
    
    Parameters:
    -----------
    T_kelvin : float
        Temperature in Kelvin
    
    Returns:
    --------
    rho : float
        Density in kg/m³
    """
    # Clamp to valid range
    T = max(260.0, min(820.0, T_kelvin))
    
    # Density correlation (kg/m³)
    # rho = rho0 - d_rho_dT * (T - T0)
    # At 373 K: rho ≈ 855 kg/m³
    rho0 = 855.0
    T0 = 373.15
    d_rho_dT = 0.23  # kg/(m³·K) (thermal expansion)
    
    rho = rho0 - d_rho_dT * (T - T0)
    
    return rho  # kg/m³
