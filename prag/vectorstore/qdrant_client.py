
import logging
import uuid

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    FilterSelector,
    PayloadSchemaType,
    SparseVector,
    Prefetch,
    FusionQuery,
    Fusion,
    PointIdsList,
)

from config.settings import settings
from ingestion.chunker import Chunk
from embeddings.embedder import EmbeddedDocs, EmbeddedQuery

logger = logging.getLogger(__name__)

_client = None


def get_client() -> QdrantClient:
    """Return the singleton Qdrant client."""
    global _client

    if _client is None:
        if settings.qdrant_api_key:
            _client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
            )
        else:
            _client = QdrantClient(url=settings.qdrant_url)

        logger.info(
            "Qdrant client connected to '%s'",
            settings.qdrant_url,
        )

        _ensure_collection(_client)

    return _client


def _ensure_collection(client: QdrantClient) -> None:
    """Create the collection and required payload indexes if needed."""

    existing = [
        collection.name
        for collection in client.get_collections().collections
    ]

    if settings.qdrant_collection not in existing:
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config={
                "dense": VectorParams(
                    size=settings.qdrant_vector_size,
                    distance=Distance.COSINE,
                )
            },
            sparse_vectors_config={
                "sparse": SparseVectorParams()
            },
        )

        logger.info(
            "Created Qdrant collection '%s'",
            settings.qdrant_collection,
        )

    for field in ("source_file", "drive_file_id", "document_key"):
        client.create_payload_index(
            collection_name=settings.qdrant_collection,
            field_name=field,
            field_schema=PayloadSchemaType.KEYWORD,
        )


def _document_key(chunk: Chunk) -> str:
    """Generate a stable identity for a document."""

    if chunk.drive_file_id:
        return f"drive:{chunk.drive_file_id}"

    return f"local:{chunk.source_file}"


def _scroll_document_points(
    client: QdrantClient,
    document_key: str,
) -> list:
    """Retrieve all points belonging to one document."""

    points = []
    offset = None

    while True:
        batch, next_offset = client.scroll(
            collection_name=settings.qdrant_collection,
            scroll_filter=Filter(
                must=[
                    FieldCondition(
                        key="document_key",
                        match=MatchValue(value=document_key),
                    )
                ]
            ),
            limit=256,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )

        points.extend(batch)

        if next_offset is None:
            break

        offset = next_offset

    return points


def upsert_chunks(
    chunks: list[Chunk],
    vectors: EmbeddedDocs,
) -> None:
    """
    Store document chunks using deterministic IDs.

    New chunks are written first. Only after a successful write
    are obsolete chunks removed.
    """

    if len(chunks) != len(vectors.dense_vectors):
        raise ValueError(
            "Chunk count and dense vector count must match."
        )

    if len(chunks) != len(vectors.sparse_vectors):
        raise ValueError(
            "Chunk count and sparse vector count must match."
        )

    if not chunks:
        raise ValueError("Cannot index an empty document.")

    client = get_client()

    document_key = _document_key(chunks[0])

    if any(_document_key(chunk) != document_key for chunk in chunks):
        raise ValueError("All chunks must belong to the same document.")

    old_points = _scroll_document_points(client, document_key)

    points = []

    for chunk, dense_vector, sparse_vector in zip(
        chunks,
        vectors.dense_vectors,
        vectors.sparse_vectors,
    ):
        point_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{document_key}:{chunk.chunk_index}",
            )
        )

        points.append(
            PointStruct(
                id=point_id,
                vector={
                    "dense": dense_vector,
                    "sparse": SparseVector(
                        indices=sparse_vector.get("indices", []),
                        values=sparse_vector.get("values", []),
                    ),
                },
                payload={
                    "text": chunk.text,
                    "source_file": chunk.source_file,
                    "chunk_index": chunk.chunk_index,
                    "total_chunks": chunk.total_chunks,
                    "file_hash": chunk.file_hash,
                    "file_url": chunk.file_url,
                    "drive_file_id": chunk.drive_file_id,
                    "document_key": document_key,
                },
            )
        )

    # Write the new version before deleting anything.
    client.upsert(
        collection_name=settings.qdrant_collection,
        points=points,
        wait=True,
    )

    new_ids = {point.id for point in points}

    obsolete_ids = [
        point.id
        for point in old_points
        if point.id not in new_ids
    ]

    if obsolete_ids:
        client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=PointIdsList(points=obsolete_ids),
            wait=True,
        )

    logger.info(
        "Indexed %d chunks for '%s'; removed %d obsolete chunks.",
        len(points),
        chunks[0].source_file,
        len(obsolete_ids),
    )


def query_chunks(
    query_vectors: EmbeddedQuery,
    top_k: int = 5,
) -> list[dict]:
    """Search for relevant chunks using hybrid dense and sparse retrieval."""

    client = get_client()

    if not query_vectors.sparse_vectors:
        raise ValueError("Sparse query embedding is missing.")

    sparse_vector = query_vectors.sparse_vectors[0]

    results = client.query_points(
        collection_name=settings.qdrant_collection,
        prefetch=[
            Prefetch(
                query=query_vectors.dense_vectors,
                using="dense",
                limit=20,
            ),
            Prefetch(
                query=SparseVector(
                    indices=sparse_vector.get("indices", []),
                    values=sparse_vector.get("values", []),
                ),
                using="sparse",
                limit=20,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        limit=top_k,
        with_payload=True,
    )

    chunks = [
        {
            "text": result.payload["text"],
            "source_file": result.payload["source_file"],
            "file_url": result.payload.get("file_url", ""),
            "score": round(result.score, 4),
        }
        for result in results.points
        if result.payload and "text" in result.payload
    ]

    logger.info(
        "Query returned %d chunks; top score: %s",
        len(chunks),
        chunks[0]["score"] if chunks else "n/a",
    )

    return chunks


def query_chunks_by_text(
    query_text: str,
    top_k: int = 5,
) -> list[dict]:
    """Embed raw text and retrieve matching chunks."""

    from embeddings.embedder import embed_text

    query_vector = embed_text(query_text)

    return query_chunks(query_vector, top_k=top_k)


def delete_file_chunks(
    source_file: str = "",
    drive_file_id: str = "",
) -> None:
    """Delete all chunks belonging to a document."""

    if drive_file_id:
        key = "drive_file_id"
        value = drive_file_id
    elif source_file:
        key = "source_file"
        value = source_file
    else:
        raise ValueError(
            "Provide either source_file or drive_file_id."
        )

    client = get_client()

    client.delete(
        collection_name=settings.qdrant_collection,
        points_selector=FilterSelector(
            filter=Filter(
                must=[
                    FieldCondition(
                        key=key,
                        match=MatchValue(value=value),
                    )
                ]
            )
        ),
        wait=True,
    )

    logger.info("Deleted document using %s: %s", key, value)


def get_file_hash_from_store(
    filename: str = "",
    drive_file_id: str = "",
) -> str | None:
    """Retrieve the stored hash of a document."""

    if drive_file_id:
        key = "drive_file_id"
        value = drive_file_id
    elif filename:
        key = "source_file"
        value = filename
    else:
        return None

    client = get_client()

    points, _ = client.scroll(
        collection_name=settings.qdrant_collection,
        scroll_filter=Filter(
            must=[
                FieldCondition(
                    key=key,
                    match=MatchValue(value=value),
                )
            ]
        ),
        limit=1,
        with_payload=True,
        with_vectors=False,
    )

    if not points or not points[0].payload:
        return None

    return points[0].payload.get("file_hash")


def list_indexed_documents() -> list[dict]:
    """Return unique indexed documents and their metadata."""

    client = get_client()

    documents = {}
    offset = None

    while True:
        points, next_offset = client.scroll(
            collection_name=settings.qdrant_collection,
            with_payload=True,
            with_vectors=False,
            limit=256,
            offset=offset,
        )

        for point in points:
            if not point.payload:
                continue

            payload = point.payload

            key = payload.get("document_key") or (
                "legacy:" + payload.get("source_file", "")
            )

            if not key or key == "legacy:":
                continue

            documents[key] = {
                "document_key": key,
                "drive_file_id": payload.get("drive_file_id", ""),
                "filename": payload.get("source_file", ""),
                "file_hash": payload.get("file_hash", ""),
                "file_url": payload.get("file_url", ""),
            }

        if next_offset is None:
            break

        offset = next_offset

    return sorted(
        documents.values(),
        key=lambda item: item["filename"],
    )


def list_indexed_files() -> list[str]:
    """Return sorted unique indexed source paths."""

    return sorted({
        document["filename"]
        for document in list_indexed_documents()
        if document["filename"]
    })


def list_indexed_files_with_urls() -> list[dict]:
    """Return indexed documents with their Drive URLs."""

    return [
        {
            "filename": document["filename"],
            "file_url": document["file_url"],
        }
        for document in list_indexed_documents()
        if document["filename"]
    ]
