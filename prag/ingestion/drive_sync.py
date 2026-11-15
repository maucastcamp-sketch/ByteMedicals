
import io
import json
import logging
import os
import tempfile

from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from config.settings import settings
from ingestion.pipeline import ingest_file_safe, remove_file
from vectorstore.qdrant_client import (
    get_file_hash_from_store,
    list_indexed_documents,
)

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
]

FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".docx",
    ".md",
    ".markdown",
    ".txt",
    ".text",
    ".sql",
}


def get_drive_service():
    """Authenticate and return a Google Drive API service."""

    creds_path = Path(settings.google_credentials_path)

    if creds_path.exists():
        creds = service_account.Credentials.from_service_account_file(
            str(creds_path),
            scopes=SCOPES,
        )

    elif settings.google_credentials_json:
        creds_info = json.loads(
            settings.google_credentials_json
        )

        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=SCOPES,
        )

    else:
        raise RuntimeError(
            "No Google credentials found. "
            "Configure GOOGLE_CREDENTIALS_PATH or "
            "GOOGLE_CREDENTIALS_JSON."
        )

    return build(
        "drive",
        "v3",
        credentials=creds,
        cache_discovery=False,
    )


def _list_children(service, folder_id: str) -> list[dict]:
    """List every direct child of a Drive folder, with pagination."""

    files = []
    page_token = None

    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            pageSize=1000,
            pageToken=page_token,
            fields=(
                "nextPageToken,"
                "files(id,name,mimeType,modifiedTime,"
                "md5Checksum,webViewLink,size)"
            ),
        ).execute()

        files.extend(response.get("files", []))

        page_token = response.get("nextPageToken")

        if not page_token:
            break

    return files


def list_drive_files(service) -> list[dict]:
    """
    Recursively list supported files inside the configured
    knowledge-base folder.
    """

    root_id = settings.drive_folder_id

    if not root_id:
        raise RuntimeError("DRIVE_FOLDER_ID is not configured.")

    discovered_files = []
    visited_folders = set()

    def walk(folder_id: str, relative_path: str = ""):
        if folder_id in visited_folders:
            return

        visited_folders.add(folder_id)

        children = _list_children(service, folder_id)

        for item in children:
            name = item["name"]
            item_id = item["id"]
            mime_type = item.get("mimeType", "")

            if mime_type == FOLDER_MIME_TYPE:
                child_path = (
                    f"{relative_path}/{name}"
                    if relative_path
                    else name
                )

                walk(item_id, child_path)
                continue

            extension = Path(name).suffix.lower()

            if extension not in SUPPORTED_EXTENSIONS:
                logger.info(
                    "Skipping unsupported file: %s",
                    name,
                )
                continue

            item["relative_path"] = (
                f"{relative_path}/{name}"
                if relative_path
                else name
            )

            discovered_files.append(item)

    walk(root_id)

    logger.info(
        "Drive traversal completed: %d supported files, %d folders.",
        len(discovered_files),
        len(visited_folders),
    )

    return discovered_files


def download_file(
    service,
    file_id: str,
    filename: str,
) -> str:
    """Download a binary Drive file to a temporary local file."""

    suffix = Path(filename).suffix

    fd, tmp_name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)

    tmp_path = Path(tmp_name)

    try:
        request = service.files().get_media(
            fileId=file_id
        )

        with tmp_path.open("wb") as file_handle:
            downloader = MediaIoBaseDownload(
                file_handle,
                request,
            )

            done = False

            while not done:
                _, done = downloader.next_chunk()

        return str(tmp_path)

    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _get_drive_hash(file: dict) -> str:
    """
    Return the Drive MD5 checksum or modified timestamp.

    The timestamp is used as a fallback when Drive does not
    provide an MD5 checksum.
    """

    return (
        file.get("md5Checksum")
        or f"modified:{file.get('modifiedTime', '')}"
    )


def _download_and_ingest(service, file: dict) -> bool:
    """Download, ingest and clean up one Drive document."""

    tmp_path = None

    filename = file["name"]
    file_id = file["id"]

    source_path = file.get("relative_path", filename)

    try:
        tmp_path = download_file(
            service,
            file_id,
            filename,
        )

        file_url = file.get("webViewLink") or (
            f"https://drive.google.com/file/d/{file_id}/view"
        )

        success, error = ingest_file_safe(
            path=tmp_path,
            file_hash=_get_drive_hash(file),
            source_filename=source_path,
            file_url=file_url,
            drive_file_id=file_id,
        )

        if not success:
            logger.error(
                "Ingestion failed for '%s': %s",
                source_path,
                error,
            )
            return False

        logger.info(
            "Successfully ingested: %s",
            source_path,
        )

        return True

    except Exception:
        logger.exception(
            "Could not process Drive file: %s",
            source_path,
        )
        return False

    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


def sync_drive() -> dict:
    """
    Synchronize the configured Drive knowledge base with Qdrant.

    Documents are identified by Drive ID, not filename.
    Old document chunks are retained until new chunks are
    successfully indexed.
    """

    logger.info("Starting recursive Google Drive synchronization.")

    service = get_drive_service()

    # If traversal fails, the function raises and no deletions occur.
    drive_files = list_drive_files(service)

    drive_ids = {
        file["id"]
        for file in drive_files
    }

    indexed_documents = list_indexed_documents()

    indexed_drive_ids = {
        document["drive_file_id"]
        for document in indexed_documents
        if document.get("drive_file_id")
    }

    ingested = 0
    skipped = 0
    failed = 0
    removed = 0

    logger.info(
        "Found %d Drive documents and %d indexed Drive documents.",
        len(drive_files),
        len(indexed_drive_ids),
    )

    # Process new or changed documents.
    for file in drive_files:
        file_id = file["id"]
        source_path = file.get("relative_path", file["name"])
        drive_hash = _get_drive_hash(file)

        try:
            stored_hash = get_file_hash_from_store(
                drive_file_id=file_id,
            )

            if stored_hash == drive_hash:
                skipped += 1
                logger.info(
                    "Unchanged, skipping: %s",
                    source_path,
                )
                continue

            logger.info(
                "New or changed document: %s",
                source_path,
            )

            if _download_and_ingest(service, file):
                ingested += 1
            else:
                failed += 1

        except Exception:
            failed += 1
            logger.exception(
                "Synchronization failed for: %s",
                source_path,
            )

    # Delete documents that no longer exist in Drive.
    # This happens only after a complete Drive traversal.
    stale_ids = indexed_drive_ids - drive_ids

    for file_id in stale_ids:
        try:
            logger.info(
                "Removing document deleted from Drive: %s",
                file_id,
            )

            remove_file(
                drive_file_id=file_id,
            )

            removed += 1

        except Exception:
            logger.exception(
                "Could not remove deleted Drive document: %s",
                file_id,
            )

    summary = {
        "discovered": len(drive_files),
        "ingested": ingested,
        "unchanged": skipped,
        "failed": failed,
        "removed": removed,
    }

    logger.info(
        "Drive synchronization finished: %s",
        summary,
    )

    return summary
