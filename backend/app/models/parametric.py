"""
ParametricStudy model — stores parametric sweep definitions and results.
Each study belongs to a user, references an optional canvas simulation or
solver script, and persists the sweep matrix + output matrix as JSON.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean,
    ForeignKey, JSON, Text, Index,
)
from sqlalchemy.orm import relationship
from app.database import Base


class ParametricStudy(Base):
    """
    One saved parametric study.

    variables_config  – list of swept variable definitions:
        [{name, source, min, max, steps, values?}, ...]
        source = 'canvas' | 'solver'

    output_config     – list of output KPIs the user wants tracked:
        [{name, label}]

    result_matrix     – the full N-dimensional result, stored as:
        {
          "axes": [{"name": "P_boil", "values": [1e6, 2e6, ...]}, ...],
          "outputs": {"eta_cycle": [[0.31, 0.33, ...], ...], ...}
        }

    generate_plots    – user preference: attach sparkline plot data
    """

    __tablename__ = "parametric_studies"

    id           = Column(Integer, primary_key=True, index=True)
    owner_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False, index=True)

    name         = Column(String(255), nullable=False)
    description  = Column(Text, nullable=True)

    # Optional links to source data
    simulation_id   = Column(Integer, ForeignKey("simulations.id",  ondelete="SET NULL"),
                              nullable=True)
    solver_script_id = Column(Integer, ForeignKey("solver_scripts.id", ondelete="SET NULL"),
                               nullable=True)

    # Source type: 'canvas' | 'solver' | 'mixed'
    source_type  = Column(String(32), nullable=False, default="canvas")

    # The raw script text (for solver-mode studies; stores a snapshot)
    script_snapshot = Column(Text, nullable=True)

    # Study configuration (JSON arrays)
    variables_config = Column(JSON, nullable=False, default=list)  # sweep axes
    output_config    = Column(JSON, nullable=False, default=list)  # KPI names

    # Results
    result_matrix    = Column(JSON, nullable=True)   # filled after run
    generate_plots   = Column(Boolean, default=True, nullable=False)
    plot_data        = Column(JSON, nullable=True)   # pre-computed sparkline series

    # Execution metadata
    status           = Column(String(32), default="draft", nullable=False)
    # draft | running | completed | failed
    execution_time_ms = Column(Float, nullable=True)
    error_message    = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, nullable=False)

    # Relationships
    owner = relationship("User", backref="parametric_studies")

    __table_args__ = (
        Index("ix_parametric_owner_created", "owner_id", "created_at"),
        Index("ix_parametric_source", "source_type", "status"),
    )

    def __repr__(self):
        return (f"<ParametricStudy(id={self.id}, name='{self.name}', "
                f"source='{self.source_type}', status='{self.status}')>")
