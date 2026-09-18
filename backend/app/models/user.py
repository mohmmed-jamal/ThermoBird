"""
User model removed/reduced for public deployment.

This module previously defined a full User model (with passwords, flags,
and relationships). To remove authentication/user management from the
codebase the original model has been replaced with a minimal placeholder
that defines a lightweight `User` class containing only an `id` and `email`.

WARNING: This change is destructive relative to the original DB schema and
may require migration updates. The minimal placeholder is intended to
eliminate authentication-sensitive fields from the code while preserving
import paths used by other modules.
"""

from sqlalchemy import Column, Integer, String
from app.database import Base


class User(Base):
    __tablename__ = "users"

    # Minimal placeholder: only id and email kept to avoid import errors.
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=True)

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email})>"
