"""
ThermoBird — LiBr-H2O Solution Property Functions
==================================================
Simplified correlations for Lithium Bromide - Water absorption chiller solutions.

Based on:
- Kaita, Y. (2001): "Thermodynamic properties of lithium bromide-water solutions at high temperatures"
- Pátek & Klomfar (2006): "A computationally effective formulation of the thermodynamic properties of LiBr–H2O solutions"

Temperature range: 0–175°C
Concentration range: 0.40–0.70 (mass fraction LiBr)

Units (consistent with ThermoBird):
- Temperature: K
- Concentration: mass fraction (0–1)
- Enthalpy: kJ/kg
- Entropy: kJ/(kg·K)
"""
import math

def h_librh2o(T_celsius: float, X: float) -> float:
    """
    Specific enthalpy of LiBr-H2O solution.
    
    Parameters:
    -----------
    T_celsius : float
        Temperature in Celsius
    X : float
        LiBr mass fraction (0–1)
    
    Returns:
    --------
    h : float
        Specific enthalpy in kJ/kg
    """
    # Convert to Kelvin
    T = T_celsius + 273.15
    
    # Clamp X to valid range
    X = max(0.40, min(0.70, X))
    
    # Simplified polynomial correlation (Pátek & Klomfar simplified form)
    # h = h_water(T) + h_mix(T, X)
    
    # Water component (pure water enthalpy approximation)
    h_water = 4.186 * T_celsius  # Simplified cp*T for water
    
    # Mixing enthalpy (negative, endothermic mixing)
    # Polynomial fit: h_mix = a0 + a1*X + a2*X^2 + a3*T*X + a4*T*X^2
    a0 = -2024.33
    a1 = 163.04
    a2 = -4.88
    a3 = -0.02
    a4 = 0.001
    
    h_mix = a0 + a1*X + a2*X**2 + a3*T_celsius*X + a4*T_celsius*X**2
    
    h = h_water + h_mix
    
    return h


def s_librh2o(T_celsius: float, X: float) -> float:
    """
    Specific entropy of LiBr-H2O solution.
    
    Parameters:
    -----------
    T_celsius : float
        Temperature in Celsius
    X : float
        LiBr mass fraction (0–1)
    
    Returns:
    --------
    s : float
        Specific entropy in kJ/(kg·K)
    """
    # Convert to Kelvin
    T = T_celsius + 273.15
    
    # Clamp X to valid range
    X = max(0.40, min(0.70, X))
    
    # Simplified polynomial correlation
    # s = s_water(T) + s_mix(T, X)
    
    # Water component (pure water entropy approximation)
    # s_water ≈ cp * ln(T/T_ref)
    T_ref = 273.15
    s_water = 4.186 * math.log(T / T_ref)
    
    # Mixing entropy (negative, ordering effect)
    # Polynomial fit: s_mix = b0 + b1*X + b2*X^2 + b3*ln(T)*X
    b0 = -6.12
    b1 = 9.85
    b2 = -2.15
    b3 = -0.05
    
    s_mix = b0 + b1*X + b2*X**2 + b3*math.log(T)*X
    
    s = s_water + s_mix
    
    return s
