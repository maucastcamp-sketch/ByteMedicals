import asyncio
import logging

from fastapi import APIRouter, HTTPException, Security

from api.schemas.query import QueryRequest, QueryResponse, SourceReference
from core.rag import answer_query
from api.middleware import verify_user_api_key

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/query", response_model=QueryResponse)
async def query_documents(
    request: QueryRequest,
    _: str = Security(verify_user_api_key),
):
    try:
        result = await asyncio.to_thread(
            answer_query,
            request.query,
            top_k=request.top_k,
            history=(
                [turn.model_dump() for turn in request.history]
                if request.history else None
            ),
            mission_context=request.context,
        )

        logger.info("Response generated successfully.")

    except Exception:
        logger.exception("RAG pipeline failed.")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate answer.",
        )

    return QueryResponse(
        answer=result.answer,
        sources=[
            SourceReference(**source)
            for source in result.sources
        ],
        query=result.query,
    )