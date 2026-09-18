"""
ThermoBird v2 — TransientJob SQLAlchemy model.
Separate table 'transient_jobs' — no FK conflicts with v1 tables.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from app.database import Base


class TransientJob(Base):
    __tablename__ = "transient_jobs"

    id            = Column(Integer, primary_key=True, index=True)
    owner_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    simulation_id = Column(Integer, ForeignKey("simulations.id", ondelete="SET NULL"), nullable=True)

    status     = Column(String(32), default="pending", nullable=False)
    config     = Column(JSON, nullable=False, default={})
    result     = Column(JSON, nullable=True)
    error_msg  = Column(Text, nullable=True)
    progress   = Column(Float, default=0.0)

    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at  = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates=None, lazy="select")
