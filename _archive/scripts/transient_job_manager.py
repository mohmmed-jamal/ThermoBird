"""
ThermoBird — Transient Job Manager with SSE Support

Manages job lifecycle and partial results for real-time streaming.
"""

import asyncio
import json
from typing import Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import redis.asyncio as redis


@dataclass
class TransientJob:
    """Represents a transient simulation job."""
    job_id: int
    status: str = "pending"  # pending, running, completed, failed
    progress: float = 0.0
    eta_seconds: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    partial_results: Optional[dict] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    
    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "progress": self.progress,
            "eta_seconds": self.eta_seconds,
            "result": self.result,
            "error": self.error,
            "partial_results": self.partial_results,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TransientJobManager:
    """
    Manages transient simulation jobs with Redis backend.
    Supports real-time progress updates and partial results.
    """
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.job_prefix = "transient:job:"
        self.ttl = timedelta(hours=24)  # Jobs expire after 24 hours
    
    def _key(self, job_id: int) -> str:
        return f"{self.job_prefix}{job_id}"
    
    async def create_job(self, job_id: int, config: dict) -> TransientJob:
        """Create a new job entry."""
        job = TransientJob(job_id=job_id, status="pending", progress=0.0)
        await self._save_job(job)
        return job
    
    async def get_job(self, job_id: int) -> Optional[TransientJob]:
        """Retrieve a job by ID."""
        key = self._key(job_id)
        data = await self.redis.get(key)
        if not data:
            return None
        
        try:
            job_dict = json.loads(data)
            return TransientJob(
                job_id=job_dict["job_id"],
                status=job_dict["status"],
                progress=job_dict.get("progress", 0.0),
                eta_seconds=job_dict.get("eta_seconds"),
                result=job_dict.get("result"),
                error=job_dict.get("error"),
                partial_results=job_dict.get("partial_results"),
                created_at=datetime.fromisoformat(job_dict["created_at"]) if job_dict.get("created_at") else datetime.utcnow(),
                updated_at=datetime.fromisoformat(job_dict["updated_at"]) if job_dict.get("updated_at") else datetime.utcnow(),
            )
        except Exception:
            return None
    
    async def update_job(
        self,
        job_id: int,
        status: Optional[str] = None,
        progress: Optional[float] = None,
        eta_seconds: Optional[float] = None,
        partial_results: Optional[dict] = None,
    ) -> Optional[TransientJob]:
        """Update job status and progress."""
        job = await self.get_job(job_id)
        if not job:
            return None
        
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = progress
        if eta_seconds is not None:
            job.eta_seconds = eta_seconds
        if partial_results is not None:
            job.partial_results = partial_results
        
        job.updated_at = datetime.utcnow()
        await self._save_job(job)
        return job
    
    async def complete_job(self, job_id: int, result: dict) -> Optional[TransientJob]:
        """Mark a job as completed with results."""
        job = await self.get_job(job_id)
        if not job:
            return None
        
        job.status = "completed"
        job.progress = 1.0
        job.result = result
        job.updated_at = datetime.utcnow()
        await self._save_job(job)
        return job
    
    async def fail_job(self, job_id: int, error: str) -> Optional[TransientJob]:
        """Mark a job as failed with error message."""
        job = await self.get_job(job_id)
        if not job:
            return None
        
        job.status = "failed"
        job.error = error
        job.updated_at = datetime.utcnow()
        await self._save_job(job)
        return job
    
    async def _save_job(self, job: TransientJob) -> None:
        """Persist job to Redis."""
        key = self._key(job.job_id)
        data = json.dumps(job.to_dict(), default=str)
        await self.redis.setex(key, self.ttl, data)
    
    async def delete_job(self, job_id: int) -> bool:
        """Delete a job."""
        key = self._key(job_id)
        result = await self.redis.delete(key)
        return result > 0
    
    async def list_jobs(self) -> list[TransientJob]:
        """List all active jobs."""
        pattern = f"{self.job_prefix}*"
        keys = []
        cursor = 0
        while True:
            cursor, batch = await self.redis.scan(cursor, match=pattern, count=100)
            keys.extend(batch)
            if cursor == 0:
                break
        
        jobs = []
        for key in keys:
            try:
                job_id = int(key.decode().split(":")[-1])
                job = await self.get_job(job_id)
                if job:
                    jobs.append(job)
            except Exception:
                continue
        
        return jobs
