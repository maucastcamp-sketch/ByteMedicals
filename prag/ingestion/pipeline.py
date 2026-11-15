
import hashlib
import logging
from pathlib import Path

from embeddings.embedder import embed_batch
from ingestion.chunker import chunk_text
from ingestion.parsers import parse_file
from vectorstore.qdrant_client import (
    delete_file_chunks,
    upsert_chunks,
)

logger = logging.getLogger(__name__)


def compute_file_hash(path: str) -> str:
    """Calculate the SHA-256 hash of a file."""
    h = hashlib.sha256()

    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(8192), b""):
            h.update(chunk)

    return h.hexdigest()


def ingest_file(
    path: str,
    file_hash: str = "",
    source_filename: str = "",
    file_url: str = "",
    drive_file_id: str = "",
) -> None:
    """Parse, split, embed and store a document."""

    file_path = Path(path)

    if not file_path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    source = (source_filename or file_path.name).replace("\\", "/")

    if not file_hash:
        file_hash = compute_file_hash(str(file_path))

    logger.info("Processing document: %s", source)

    text = parse_file(str(file_path))

    if not text or not text.strip():
        raise ValueError(f"No readable text found in: {source}")

    chunks = chunk_text(
        text=text,
        source_file=source,
        drive_file_id=drive_file_id,
    )

    for chunk in chunks:
        chunk.file_hash = file_hash
        chunk.file_url = file_url

    texts = [chunk.text for chunk in chunks]
    vectors = embed_batch(texts)

    if len(vectors.dense_vectors) != len(chunks):
        raise RuntimeError(
            "Dense embedding count does not match chunk count."
        )

    if len(vectors.sparse_vectors) != len(chunks):
        raise RuntimeError(
            "Sparse embedding count does not match chunk count."
        )

    upsert_chunks(chunks, vectors)

    logger.info(
        "Successfully indexed %s (%d chunks)",
        source,
        len(chunks),
    )


def ingest_file_safe(
    path: str,
    file_hash: str = "",
    source_filename: str = "",
    file_url: str = "",
    drive_file_id: str = "",
) -> tuple[bool, str]:
    """Ingest a file without propagating exceptions."""

    try:
        ingest_file(
            path=path,
            file_hash=file_hash,
            source_filename=source_filename,
            file_url=file_url,
            drive_file_id=drive_file_id,
        )
        return True, ""

    except Exception as exc:
        logger.exception("Failed to ingest file: %s", path)
        return False, str(exc)


def remove_file(
    filename: str = "",
    drive_file_id: str = "",
) -> None:
    """Remove a document from the vector database."""

    delete_file_chunks(
        source_file=filename,
        drive_file_id=drive_file_id,
    )


def reingest_file(
    path: str,
    file_hash: str = "",
    source_filename: str = "",
    file_url: str = "",
    drive_file_id: str = "",
) -> None:
    """Re-index a document."""

    ingest_file(
        path=path,
        file_hash=file_hash,
        source_filename=source_filename,
        file_url=file_url,
        drive_file_id=drive_file_id,
    )
