
import logging
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter
from config.settings import settings

logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    text: str
    source_file: str
    chunk_index: int
    total_chunks: int
    file_hash: str
    file_url: str
    drive_file_id: str = ""


def chunk_text(
    text: str,
    source_file: str,
    drive_file_id: str = "",
) -> list[Chunk]:

    if not text or not text.strip():
        raise ValueError(
            f"Cannot chunk empty text from '{source_file}'"
        )

    if not source_file:
        raise ValueError("source_file cannot be empty")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ".", " ", ""],
    )

    raw_chunks = splitter.split_text(text)

    chunks = [
        Chunk(
            text=chunk,
            source_file=source_file.replace("\\", "/"),
            chunk_index=i,
            total_chunks=len(raw_chunks),
            file_hash="",
            file_url="",
            drive_file_id=drive_file_id,
        )
        for i, chunk in enumerate(raw_chunks)
    ]

    logger.info(
        "Chunked '%s' into %d chunks",
        source_file,
        len(chunks),
    )

    return chunks
