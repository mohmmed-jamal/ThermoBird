"""
ThermoBird — Real-time Transient Simulation Streaming

SSE (Server-Sent Events) endpoint for live simulation updates.
"""

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.services.transient_job_manager import TransientJobManager
from app.redis_client import get_redis

router = APIRouter()


async def event_generator(job_id: int) -> AsyncGenerator[str, None]:
    """
    Generate SSE events for transient simulation progress.
    
    Event types:
    - status: pending, running, completed, failed
    - progress: percentage complete with ETA
    - partial: intermediate results for real-time plotting
    - complete: final results
    - error: simulation error details
    """
    job_manager = TransientJobManager(await get_redis())
    last_progress = -1
    
    try:
        while True:
            job = await job_manager.get_job(job_id)
            
            if not job:
                yield f"event: error\ndata: {json.dumps({'error': 'Job not found'})}\n\n"
                break
            
            # Send status event
            yield f"event: status\ndata: {json.dumps({'status': job.status})}\n\n"
            
            # Send progress if changed
            if job.progress != last_progress:
                last_progress = job.progress
                progress_data = {
                    'status': job.status,
                    'progress': job.progress,
                }
                if job.eta_seconds:
                    progress_data['eta_seconds'] = job.eta_seconds
                yield f"event: progress\ndata: {json.dumps(progress_data)}\n\n"
            
            # Send partial results if available
            if job.partial_results:
                yield f"event: partial\ndata: {json.dumps(job.partial_results)}\n\n"
            
            # Handle completion
            if job.status == 'completed':
                yield f"event: complete\ndata: {json.dumps(job.result)}\n\n"
                break
            
            # Handle failure
            if job.status == 'failed':
                yield f"event: error\ndata: {json.dumps({'error': job.error or 'Unknown error'})}\n\n"
                break
            
            # Wait before next update (2Hz update rate)
            await asyncio.sleep(0.5)
            
    except asyncio.CancelledError:
        # Client disconnected
        raise
    except Exception as e:
        yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"


@router.get("/transient/{job_id}/stream")
async def stream_transient_results(
    job_id: int,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Stream transient simulation results via Server-Sent Events.
    
    This endpoint provides real-time updates on simulation progress,
    partial results for live charting, and final results when complete.
    """
    # Verify job exists
    job_manager = TransientJobManager(await get_redis())
    job = await job_manager.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return StreamingResponse(
        event_generator(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
