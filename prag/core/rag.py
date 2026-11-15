
import logging
from dataclasses import dataclass, field

from vectorstore.qdrant_client import query_chunks_by_text
from llm.chat_llm import call_llm
from llm.process_query_llm import process_query

logger = logging.getLogger(__name__)

SCORE_THRESHOLD = 0.38


@dataclass
class RAGResponse:
    answer: str
    query: str
    sources: list[dict] = field(default_factory=list)


def answer_query(query: str, top_k: int = 5,
                   history: list[dict] | None = None,
                   mission_context: dict | None = None) -> RAGResponse:
    """Retrieve relevant documents and generate a grounded answer."""

    logger.info("Processing query: '%s'", query)

    # Step 0: Improve and classify the query.
    processed_query = process_query(query)
    improved_query = processed_query.improved_query
    query_type = processed_query.query_type

    if query_type == "synthesis":
        top_k = 10

    # Step 1: Retrieve chunks from Qdrant.
    chunks = query_chunks_by_text(improved_query, top_k=top_k)

    logger.info("Retrieved %d chunks", len(chunks))

    # Step 2: Filter low-confidence results.
    chunks = [
        chunk for chunk in chunks
        if chunk["score"] >= SCORE_THRESHOLD
    ]

    logger.info(
        "%d chunks passed score threshold (%.2f)",
        len(chunks),
        SCORE_THRESHOLD,
    )

    # Step 3: Handle empty retrieval.
    # Even with no chunks, answer through the LLM: the mission
    # prompt tells it to say the documents do not cover the
    # question AND give the on-board next steps, instead of a bare
    # "not found" (or generic "go to a doctor").
    if not chunks:
        response = call_llm(
            improved_query,
            [],
            query_type,
            history=history,
            mission_context=mission_context,
        )
        return RAGResponse(
            answer=response.answer,
            sources=[],
            query=query,
        )

    # Step 4: Generate the answer.
    # History and mission context reach only the answer prompt,
    # never the retrieval query (Step 1 uses the improved query
    # alone).
    response = call_llm(
        improved_query,
        chunks,
        query_type,
        history=history,
        mission_context=mission_context,
    )

    # Step 5: Build sources from retrieved documents.
    # This does not depend on the indices returned by the LLM.
    seen = set()
    sources = []

    for chunk in chunks:
        filename = chunk["source_file"]

        if filename not in seen:
            seen.add(filename)

            sources.append({
                "filename": filename,
                "relevance_score": chunk["score"],
                "file_url": chunk.get("file_url", ""),
            })

    logger.info(
        "Query complete: %d sources, answer length: %d chars",
        len(sources),
        len(response.answer),
    )

    return RAGResponse(
        answer=response.answer,
        sources=sources,
        query=query,
    )
