"""
Pydantic schemas for API request/response validation.
Complete schema definitions for ThermoBird API.
"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr, validator


# ============================================================================
# Authentication & User Schemas
# ============================================================================

# Authentication/user management has been removed in the public deployment.
# Keep minimal placeholder schema classes with explicit docstrings so imports
# from other modules do not break during import-time. These placeholders
# intentionally contain no security-sensitive fields (passwords, tokens).


class SignupRequest(BaseModel):
    """Signup removed: placeholder used to avoid import errors."""
    email: Optional[EmailStr] = None


class LoginRequest(BaseModel):
    """Login removed: placeholder used to avoid import errors."""
    email: Optional[EmailStr] = None


class TokenResponse(BaseModel):
    """Token response removed: placeholder."""
    access_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: Optional[int] = None


class RefreshRequest(BaseModel):
    """Refresh removed: placeholder."""
    refresh_token: Optional[str] = None


class UserResponse(BaseModel):
    """User response removed: minimal placeholder."""
    id: Optional[int] = None
    email: Optional[str] = None


class UserCreate(BaseModel):
    """User creation removed: placeholder."""
    email: Optional[EmailStr] = None


class UserLogin(BaseModel):
    """User login removed: placeholder."""
    email: Optional[EmailStr] = None


class Token(BaseModel):
    """JWT Token removed: placeholder."""
    access_token: Optional[str] = None
    token_type: str = "bearer"


# ============================================================================
# Property Calculation Schemas
# ============================================================================

class PropertyRequest(BaseModel):
    """Schema for thermodynamic property calculation request."""
    fluid: str = Field(..., min_length=1, description="Fluid name (e.g., 'Water', 'R134a')")
    input1_type: str = Field(..., description="First property type (P, T, H, S, D, Q)")
    input1_value: float = Field(..., description="Value of first property")
    input2_type: str = Field(..., description="Second property type (P, T, H, S, D, Q)")
    input2_value: float = Field(..., description="Value of second property")
    
    @validator('input1_type', 'input2_type')
    def validate_property_type(cls, v):
        """Validate property type."""
        valid_types = ['P', 'T', 'H', 'S', 'D', 'Q']
        v_upper = v.upper()
        if v_upper not in valid_types:
            raise ValueError(f"Property type must be one of {valid_types}")
        return v_upper


class PropertyResponse(BaseModel):
    """Schema for thermodynamic property calculation response."""
    fluid: str
    temperature: float = Field(..., description="Temperature in K")
    pressure: float = Field(..., description="Pressure in Pa")
    enthalpy: float = Field(..., description="Specific enthalpy in J/kg")
    entropy: float = Field(..., description="Specific entropy in J/(kg·K)")
    density: float = Field(..., description="Density in kg/m³")
    quality: Optional[float] = Field(None, ge=0, le=1, description="Vapor quality (0-1)")
    internal_energy: float = Field(..., description="Specific internal energy in J/kg")
    cp: float = Field(..., description="Specific heat at constant pressure in J/(kg·K)")
    cv: float = Field(..., description="Specific heat at constant volume in J/(kg·K)")
    viscosity: Optional[float] = Field(None, description="Dynamic viscosity in Pa·s")
    conductivity: Optional[float] = Field(None, description="Thermal conductivity in W/(m·K)")
    phase: str = Field(..., description="Phase (liquid, gas, two-phase)")


class FluidListResponse(BaseModel):
    """Schema for list of available fluids."""
    fluids: List[str]
    count: int


# ============================================================================
# Component Schemas
# ============================================================================

class ComponentParametersSchema(BaseModel):
    """Flexible schema for component parameters."""
    # Common parameters
    efficiency: Optional[float] = Field(None, ge=0, le=1)
    mass_flow: Optional[float] = Field(None, gt=0)
    
    # Pressure parameters
    inlet_pressure: Optional[float] = Field(None, gt=0)
    outlet_pressure: Optional[float] = Field(None, gt=0)
    pressure_ratio: Optional[float] = Field(None, gt=1)
    pressure_drop: Optional[float] = Field(None, ge=0)
    
    # Temperature parameters
    inlet_temperature: Optional[float] = Field(None, gt=0)
    outlet_temperature: Optional[float] = Field(None, gt=0)
    
    # Heat/work parameters
    heat_input: Optional[float] = Field(None, gt=0)
    heat_rejected: Optional[float] = Field(None, gt=0)
    heat_transfer: Optional[float] = None
    work_input: Optional[float] = None
    work_output: Optional[float] = None
    
    # Heat exchanger specific
    effectiveness: Optional[float] = Field(None, ge=0, le=1)
    
    # Quality (for two-phase)
    outlet_quality: Optional[float] = Field(None, ge=0, le=1)
    
    class Config:
        extra = "allow"  # Allow additional parameters


class ComponentCreate(BaseModel):
    """Schema for creating a component."""
    component_type: str = Field(..., description="Type of component (pump, turbine, boiler, etc.)")
    component_name: str = Field(..., min_length=1, max_length=255)
    position_x: float
    position_y: float
    parameters: ComponentParametersSchema
    constraints: Optional[Dict[str, Any]] = None


class ComponentUpdate(BaseModel):
    """Schema for updating a component."""
    component_name: Optional[str] = Field(None, min_length=1, max_length=255)
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    parameters: Optional[ComponentParametersSchema] = None
    constraints: Optional[Dict[str, Any]] = None


class ComponentResponse(BaseModel):
    """Schema for component response."""
    id: int
    component_type: str
    component_name: str
    position_x: float
    position_y: float
    parameters: Dict[str, Any]
    constraints: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ============================================================================
# Connection Schemas
# ============================================================================

class ConnectionCreate(BaseModel):
    """Schema for creating a connection between components."""
    from_component_id: int = Field(..., gt=0)
    to_component_id: int = Field(..., gt=0)
    from_port: str = Field(..., min_length=1)
    to_port: str = Field(..., min_length=1)
    fluid_name: str = Field(default="Water")
    mass_flow_rate: Optional[float] = Field(None, gt=0)


class ConnectionResponse(BaseModel):
    """Schema for connection response."""
    id: int
    from_component_id: int
    to_component_id: int
    from_port: str
    to_port: str
    fluid_name: str
    mass_flow_rate: Optional[float]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============================================================================
# Simulation Schemas
# ============================================================================

class SimulationCreate(BaseModel):
    """Schema for creating a simulation."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    cycle_type: str = Field(..., description="Type of cycle (rankine, refrigeration, brayton, etc.)")
    is_public: bool = False


class SimulationUpdate(BaseModel):
    """Schema for updating a simulation."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_public: Optional[bool] = None


class SimulationWithComponents(BaseModel):
    """Schema for creating simulation with components in one request."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    cycle_type: str
    is_public: bool = False
    components: List[ComponentCreate] = []
    connections: List[ConnectionCreate] = []


class SimulationResponse(BaseModel):
    """Schema for simulation response."""
    id: int
    owner_id: int
    name: str
    description: Optional[str]
    cycle_type: str
    status: str
    is_template: bool
    is_public: bool
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]
    execution_time_ms: Optional[int]
    error_message: Optional[str]
    version: int
    
    class Config:
        from_attributes = True


class SimulationDetailResponse(SimulationResponse):
    """Schema for detailed simulation response with components."""
    components: List[ComponentResponse] = []
    connections: List[ConnectionResponse] = []


# ============================================================================
# Cycle Schemas (for legacy cycle solver)
# ============================================================================

class CycleRequest(BaseModel):
    """Schema for cycle analysis request (legacy solver)."""
    name: Optional[str] = None
    cycle_type: str = Field(..., description="Type of cycle")
    working_fluid: str = Field(..., description="Working fluid name")
    parameters: Dict[str, Any] = Field(..., description="Cycle parameters")
    save_canvas: bool = False
    canvas_json: Optional[Dict[str, Any]] = None


class CycleResponse(BaseModel):
    """Schema for cycle analysis response."""
    simulation_id: str
    cycle_type: str
    working_fluid: str
    run_duration_ms: int
    state_points: Dict[str, Any]
    energy_balance: Dict[str, Any]
    entropy_gen: Dict[str, Any]
    exergy: Dict[str, Any]
    performance: Dict[str, Any]
    commentary: Dict[str, Any]
    ts_diagram: Optional[Dict[str, Any]] = None
    ph_diagram: Optional[Dict[str, Any]] = None


class CanvasSaveRequest(BaseModel):
    """Schema for saving canvas state."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    cycle_type: str
    working_fluid: str
    canvas_json: Dict[str, Any]
    simulation_id: Optional[str] = None


class CanvasSaveResponse(BaseModel):
    """Schema for canvas save response."""
    id: str
    name: str
    description: Optional[str]
    cycle_type: str
    working_fluid: str
    simulation_id: Optional[str]
    created_at: str
    updated_at: str


# ============================================================================
# Cycle Template Schemas
# ============================================================================

class CycleTemplateRequest(BaseModel):
    """Schema for requesting a cycle template."""
    cycle_type: str = Field(..., description="Type of cycle template")
    parameters: Optional[Dict[str, Any]] = None


class CycleTemplateResponse(BaseModel):
    """Schema for cycle template response."""
    cycle_type: str
    name: str
    description: str
    components: List[ComponentCreate]
    connections: List[ConnectionCreate]
    default_parameters: Dict[str, Any]


class CycleAnalysisRequest(BaseModel):
    """Schema for cycle analysis request."""
    simulation_id: int
    analysis_type: str = Field(..., description="Type of analysis (energy, exergy, economic)")
    parameters: Optional[Dict[str, Any]] = None


class CycleAnalysisResponse(BaseModel):
    """Schema for cycle analysis response."""
    simulation_id: int
    analysis_type: str
    results: Dict[str, Any]
    charts: Optional[List[Dict[str, Any]]] = None
    recommendations: Optional[List[str]] = None


# ============================================================================
# Results Schemas
# ============================================================================

class SimulationResultsResponse(BaseModel):
    """Schema for simulation results — passes through the full engine output."""
    simulation_id: int
    success: bool
    error_message: Optional[str] = None
    execution_time_ms: int

    # Headline scalars (convenience)
    net_power:          Optional[float] = None
    thermal_efficiency: Optional[float] = None
    cop:                Optional[float] = None
    exergy_efficiency:  Optional[float] = None
    cycle_type:         Optional[str]   = None

    # Full detailed results — all passed through as-is
    state_points:       List[Dict[str, Any]] = []
    component_metrics:  List[Dict[str, Any]] = []
    energy_balance:     Optional[Dict[str, Any]] = None
    performance:        Optional[Dict[str, Any]] = None
    entropy:            Optional[Dict[str, Any]] = None
    exergy:             Optional[Dict[str, Any]] = None
    ts_diagram:         Optional[Dict[str, Any]] = None
    ph_diagram:         Optional[Dict[str, Any]] = None
    commentary:         Optional[Dict[str, Any]] = None
    warnings:           List[str] = []


class SimulationResultsSummary(BaseModel):
    """Schema for simplified results summary."""
    simulation_id: int
    success: bool
    thermal_efficiency: Optional[float]
    net_power: Optional[float]
    cop: Optional[float]
    execution_time_ms: int
    error_message: Optional[str]


class RunSimulationRequest(BaseModel):
    """Schema for running a simulation."""
    ambient_temperature: float = Field(298.15, gt=0, description="Ambient temperature in K")
    ambient_pressure: float = Field(101325, gt=0, description="Ambient pressure in Pa")
    tolerance: float = Field(0.01, gt=0, le=1, description="Convergence tolerance")
    max_iterations: int = Field(100, gt=0, le=1000, description="Maximum iterations")


# ============================================================================
# Export All Schemas
# ============================================================================

__all__ = [
    # Property schemas
    "PropertyRequest",
    "PropertyResponse",
    "FluidListResponse",
    # Component schemas
    "ComponentCreate",
    "ComponentUpdate",
    "ComponentResponse",
    "ComponentParametersSchema",
    # Connection schemas
    "ConnectionCreate",
    "ConnectionResponse",
    # Simulation schemas
    "SimulationCreate",
    "SimulationUpdate",
    "SimulationResponse",
    "SimulationDetailResponse",
    "SimulationWithComponents",
    # Cycle schemas (legacy)
    "CycleRequest",
    "CycleResponse",
    "CanvasSaveRequest",
    "CanvasSaveResponse",
    # Cycle template schemas
    "CycleTemplateRequest",
    "CycleTemplateResponse",
    "CycleAnalysisRequest",
    "CycleAnalysisResponse",
    # Results schemas
    "SimulationResultsResponse",
    "SimulationResultsSummary",
    "RunSimulationRequest",
]
