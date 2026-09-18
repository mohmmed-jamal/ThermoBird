"""
Simulation models: cycles, components, connections, and results.
Complete schema for storing and retrieving thermodynamic simulations.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, JSON, Text, Index
from sqlalchemy.orm import relationship
from app.database import Base


class Simulation(Base):
    """Top-level simulation container."""
    
    __tablename__ = "simulations"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Ownership
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Metadata
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cycle_type = Column(String(100), nullable=False)  # 'rankine', 'refrigeration', 'brayton', 'combined', 'custom'
    
    # Status
    status = Column(String(50), default="draft", nullable=False)  # 'draft', 'running', 'completed', 'failed'
    is_template = Column(Boolean, default=False, nullable=False)
    is_public = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    
    # Execution metadata
    execution_time_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Version control
    version = Column(Integer, default=1, nullable=False)
    parent_id = Column(Integer, ForeignKey("simulations.id", ondelete="SET NULL"), nullable=True)
    
    # Relationships
    # NOTE: one-directional on purpose — the placeholder User model (see
    # models/user.py) intentionally has no back-reference now that auth is
    # removed. Do not add back_populates here without also adding the
    # matching relationship on User.
    owner = relationship("User")
    components = relationship(
        "SimulationComponent",
        back_populates="simulation",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    connections = relationship(
        "SimulationConnection",
        back_populates="simulation",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    results = relationship(
        "SimulationResult",
        back_populates="simulation",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin"
    )
    parent = relationship("Simulation", remote_side=[id], backref="children")
    
    # Composite indexes
    __table_args__ = (
        Index('ix_simulations_owner_created', 'owner_id', 'created_at'),
        Index('ix_simulations_status_type', 'status', 'cycle_type'),
    )
    
    def __repr__(self):
        return f"<Simulation(id={self.id}, name='{self.name}', type='{self.cycle_type}')>"


class SimulationComponent(Base):
    """Individual component in a simulation (pump, turbine, heat exchanger, etc)."""
    
    __tablename__ = "simulation_components"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key
    simulation_id = Column(Integer, ForeignKey("simulations.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Component identification
    component_type = Column(String(100), nullable=False)  # 'pump', 'turbine', 'heat_exchanger', etc.
    component_name = Column(String(255), nullable=False)
    
    # Canvas position
    position_x = Column(Float, nullable=False)
    position_y = Column(Float, nullable=False)
    
    # Component parameters (JSON field for flexibility)
    parameters = Column(JSON, nullable=False)
    
    # Optional design constraints
    constraints = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    simulation = relationship("Simulation", back_populates="components")
    state = relationship(
        "ComponentState",
        back_populates="component",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin"
    )
    
    # For connections
    outgoing_connections = relationship(
        "SimulationConnection",
        foreign_keys="SimulationConnection.from_component_id",
        back_populates="from_component",
        cascade="all, delete-orphan"
    )
    incoming_connections = relationship(
        "SimulationConnection",
        foreign_keys="SimulationConnection.to_component_id",
        back_populates="to_component",
        cascade="all, delete-orphan"
    )
    
    # Indexes
    __table_args__ = (
        Index('ix_components_sim_type', 'simulation_id', 'component_type'),
    )
    
    def __repr__(self):
        return f"<SimulationComponent(id={self.id}, type='{self.component_type}', name='{self.component_name}')>"


class SimulationConnection(Base):
    """Connection between two components (fluid flow)."""
    
    __tablename__ = "simulation_connections"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign keys
    simulation_id = Column(Integer, ForeignKey("simulations.id", ondelete="CASCADE"), nullable=False, index=True)
    from_component_id = Column(Integer, ForeignKey("simulation_components.id", ondelete="CASCADE"), nullable=False)
    to_component_id = Column(Integer, ForeignKey("simulation_components.id", ondelete="CASCADE"), nullable=False)
    
    # Connection metadata
    from_port = Column(String(50), nullable=False)  # 'outlet', 'hot_out', 'cold_out', etc.
    to_port = Column(String(50), nullable=False)    # 'inlet', 'hot_in', 'cold_in', etc.
    
    # Fluid properties at this connection point
    fluid_name = Column(String(100), nullable=False)  # 'Water', 'R134a', 'Air', etc.
    mass_flow_rate = Column(Float, nullable=True)  # kg/s
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    simulation = relationship("Simulation", back_populates="connections")
    from_component = relationship(
        "SimulationComponent",
        foreign_keys=[from_component_id],
        back_populates="outgoing_connections"
    )
    to_component = relationship(
        "SimulationComponent",
        foreign_keys=[to_component_id],
        back_populates="incoming_connections"
    )
    
    # Indexes
    __table_args__ = (
        Index('ix_connections_components', 'from_component_id', 'to_component_id'),
    )
    
    def __repr__(self):
        return f"<SimulationConnection(id={self.id}, from={self.from_component_id}, to={self.to_component_id})>"


class ComponentState(Base):
    """Thermodynamic state at each component's inlet/outlet."""
    
    __tablename__ = "component_states"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key (one-to-one with component)
    component_id = Column(Integer, ForeignKey("simulation_components.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    
    # Inlet state
    inlet_temperature = Column(Float, nullable=True)  # K
    inlet_pressure = Column(Float, nullable=True)     # Pa
    inlet_enthalpy = Column(Float, nullable=True)     # J/kg
    inlet_entropy = Column(Float, nullable=True)      # J/(kg·K)
    inlet_quality = Column(Float, nullable=True)      # 0-1 for two-phase, None for single-phase
    inlet_density = Column(Float, nullable=True)      # kg/m³
    
    # Outlet state
    outlet_temperature = Column(Float, nullable=True)  # K
    outlet_pressure = Column(Float, nullable=True)     # Pa
    outlet_enthalpy = Column(Float, nullable=True)     # J/kg
    outlet_entropy = Column(Float, nullable=True)      # J/(kg·K)
    outlet_quality = Column(Float, nullable=True)      # 0-1 for two-phase, None for single-phase
    outlet_density = Column(Float, nullable=True)      # kg/m³
    
    # Component performance
    work_input = Column(Float, nullable=True)          # W (positive for work in)
    work_output = Column(Float, nullable=True)         # W (positive for work out)
    heat_input = Column(Float, nullable=True)          # W (positive for heat in)
    heat_output = Column(Float, nullable=True)         # W (positive for heat out)
    efficiency = Column(Float, nullable=True)          # 0-1
    
    # Timestamps
    calculated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    component = relationship("SimulationComponent", back_populates="state")
    
    def __repr__(self):
        return f"<ComponentState(component_id={self.component_id})>"


class SimulationResult(Base):
    """Aggregate results for entire simulation (cycle performance)."""
    
    __tablename__ = "simulation_results"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key (one-to-one with simulation)
    simulation_id = Column(Integer, ForeignKey("simulations.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    
    # Overall cycle metrics
    net_power_output = Column(Float, nullable=True)      # W
    heat_input_total = Column(Float, nullable=True)      # W
    heat_rejected_total = Column(Float, nullable=True)   # W
    thermal_efficiency = Column(Float, nullable=True)    # 0-1
    
    # COP for refrigeration cycles
    coefficient_of_performance = Column(Float, nullable=True)  # dimensionless
    
    # Exergy analysis
    exergy_destroyed_total = Column(Float, nullable=True)  # W
    exergy_efficiency = Column(Float, nullable=True)       # 0-1
    
    # Mass and energy balance checks
    mass_balance_error = Column(Float, nullable=True)      # %
    energy_balance_error = Column(Float, nullable=True)    # %
    
    # Environmental metrics
    carnot_efficiency = Column(Float, nullable=True)       # 0-1 (theoretical max)
    
    # Additional metrics (JSON for flexibility)
    metrics = Column(JSON, nullable=True)
    
    # Timestamps
    calculated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    simulation = relationship("Simulation", back_populates="results")
    system_metrics = relationship(
        "SystemMetrics",
        back_populates="result",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    
    def __repr__(self):
        return f"<SimulationResult(simulation_id={self.simulation_id}, efficiency={self.thermal_efficiency})>"


class SystemMetrics(Base):
    """Detailed system-level metrics and breakdown by component type."""
    
    __tablename__ = "system_metrics"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key
    result_id = Column(Integer, ForeignKey("simulation_results.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Metric category
    category = Column(String(100), nullable=False)  # 'pump_work', 'turbine_work', 'heat_exchanger_duty', etc.
    
    # Values
    value = Column(Float, nullable=False)
    unit = Column(String(50), nullable=False)       # 'W', 'J/kg', '%', etc.
    
    # Optional breakdown
    breakdown = Column(JSON, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    result = relationship("SimulationResult", back_populates="system_metrics")
    
    # Indexes
    __table_args__ = (
        Index('ix_metrics_result_category', 'result_id', 'category'),
    )
    
    def __repr__(self):
        return f"<SystemMetrics(category='{self.category}', value={self.value} {self.unit})>"


class SolverScript(Base):
    """Saved equation solver script + results, persisted per user."""

    __tablename__ = "solver_scripts"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    script = Column(Text, nullable=False)          # raw TBS script text
    result_json = Column(JSON, nullable=True)      # serialised SolveResponse

    # Denormalised quick-access fields
    variable_count = Column(Integer, nullable=True)
    execution_time_ms = Column(Float, nullable=True)
    success = Column(Boolean, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index('ix_solver_scripts_owner_created', 'owner_id', 'created_at'),
    )

    def __repr__(self):
        return f"<SolverScript(id={self.id}, name='{self.name}')>"


class CanvasSave(Base):
    """Saved canvas state for visual cycle editor."""
    
    __tablename__ = "canvas_saves"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Ownership
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Optional link to simulation
    simulation_id = Column(Integer, ForeignKey("simulations.id", ondelete="SET NULL"), nullable=True)
    
    # Metadata
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cycle_type = Column(String(100), nullable=False)
    working_fluid = Column(String(100), nullable=False)
    
    # Canvas data (JSON)
    canvas_json = Column(JSON, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Indexes
    __table_args__ = (
        Index('ix_canvas_user_updated', 'user_id', 'updated_at'),
    )
    
    def __repr__(self):
        return f"<CanvasSave(id={self.id}, name='{self.name}', cycle_type='{self.cycle_type}')>"
