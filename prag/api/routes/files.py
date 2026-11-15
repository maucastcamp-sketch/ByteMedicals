from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel

from vectorstore.qdrant_client import list_indexed_files_with_urls
from api.middleware import verify_user_api_key

router = APIRouter()


class FileEntry(BaseModel):
    filename: str
    file_url: str


class FilesResponse(BaseModel):
    total: int
    files: list[FileEntry]


@router.get("/files", response_model=FilesResponse)
def get_indexed_files(
    _: str = Security(verify_user_api_key),
):
    try:
        files = list_indexed_files_with_urls()

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch indexed files.",
        )

    return FilesResponse(
        total=len(files),
        files=[FileEntry(**file) for file in files],
    )