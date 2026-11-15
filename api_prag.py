"""Rutas /api/prag/*: el navegador habla con el backend; el backend
habla con PRAG. Todas requieren sesión (JWT). La clave de PRAG nunca
llega al navegador: la pone el servidor en cada llamada.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import auth
import db
import prag_client

router = APIRouter(prefix="/api/prag", tags=["PRAG"])


class PragQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=20)
    # Conversación en la que guardar la pregunta y la respuesta.
    # Sin ella, la pregunta es independiente (sin memoria).
    conversation_id: int | None = None
    # Estado actual simulado de la misión (día, FC, SpO2, temp,
    # radiación) para que PRAG responda en contexto de misión.
    context: dict | None = None


def _prag_error_to_http(exc: Exception) -> HTTPException:
    # PRAG caído o con error: 502 con el mensaje claro para el chat.
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=str(exc),
    )


@router.get("/health")
async def prag_health(user: dict = Depends(auth.get_current_user)) -> dict:
    try:
        return await prag_client.prag_health()
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        raise _prag_error_to_http(exc)


@router.get("/files")
async def prag_files(user: dict = Depends(auth.get_current_user)) -> dict:
    try:
        return await prag_client.prag_files()
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        raise _prag_error_to_http(exc)


@router.post("/query")
async def prag_query(
    body: PragQueryRequest,
    user: dict = Depends(auth.get_current_user),
) -> dict:
    query = body.query.strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La pregunta no puede estar vacía.",
        )

    conversation = None
    history = None
    if body.conversation_id is not None:
        try:
            conversation = db.get_conversation(
                user["id"], body.conversation_id
            )
        except db.DBUnavailable as exc:
            raise auth.db_error_to_http(exc)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversación no encontrada.",
            )
        try:
            previous = db.recent_messages(
                user["id"], body.conversation_id, limit=6
            )
        except db.DBUnavailable as exc:
            raise auth.db_error_to_http(exc)
        # Solo rol y contenido, recortado al límite de PRAG (1000).
        # Sin el recorte, una respuesta larga haría que PRAG
        # rechazara la petición con 422.
        history = [
            {"role": turn["role"], "content": turn["content"][:1000]}
            for turn in (previous or [])
        ]

    try:
        result = await prag_client.prag_query(
            query, top_k=body.top_k,
            history=history,
            context=body.context,
        )
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        raise _prag_error_to_http(exc)

    if conversation is not None:
        # Guardar solo si PRAG respondió (si falló, no queda una
        # pregunta sin respuesta en el historial).
        try:
            db.add_message(conversation["id"], "user", query)
            db.add_message(
                conversation["id"], "assistant",
                result.get("answer", ""),
                sources=result.get("sources") or [],
            )
            if conversation.get("title") in (None, "", "Nueva conversación"):
                db.set_conversation_title(
                    user["id"], conversation["id"], query[:40]
                )
            result = dict(result)
            result["conversation_id"] = conversation["id"]
        except db.DBUnavailable as exc:
            raise auth.db_error_to_http(exc)

    return result
