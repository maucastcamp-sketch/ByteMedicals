import asyncio
import logging

from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel

from api.middleware import verify_admin_api_key
from ingestion.drive_sync import sync_drive

logger = logging.getLogger(__name__)
router = APIRouter()


class SyncResponse(BaseModel):
    message: str
    discovered: int
    ingested: int
    unchanged: int
    failed: int
    removed: int


@router.post("/sync", response_model=SyncResponse)
async def sync_documents(
    _: str = Security(verify_admin_api_key),
):
    try:
        result = await asyncio.to_thread(sync_drive)

        logger.info("Drive sync completed: %s", result)

        return SyncResponse(
            message="Drive synchronization completed.",
            discovered=result.get("discovered", 0),
            ingested=result.get("ingested", 0),
            unchanged=result.get("unchanged", 0),
            failed=result.get("failed", 0),
            removed=result.get("removed", 0),
        )

    except Exception:
        logger.exception("Drive sync failed.")
        raise HTTPException(
            status_code=500,
            detail="Drive synchronization failed.",
        )