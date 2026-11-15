"""Rutas /api/conversations/*: conversaciones privadas por usuario.

Cada conversación pertenece a un usuario y nadie más puede verla:
todas las consultas filtran por user_id (en db.py). Un usuario
normal que pida la conversación de otro recibe 404, igual que si
no existiera.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import auth
import db

router = APIRouter(prefix="/api/conversations", tags=["Conversations"])


class ConversationCreate(BaseModel):
    title: str = Field(default="Nueva conversación", max_length=200)


@router.get("")
async def list_conversations(
    user: dict = Depends(auth.get_current_user),
) -> list:
    try:
        return db.list_conversations(user["id"])
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate,
    user: dict = Depends(auth.get_current_user),
) -> dict:
    title = body.title.strip() or "Nueva conversación"
    try:
        return db.create_conversation(user["id"], title)
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    user: dict = Depends(auth.get_current_user),
) -> dict:
    try:
        conversation = db.get_conversation(user["id"], conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversación no encontrada.",
            )
        messages = db.list_messages(user["id"], conversation_id)
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)
    return {"conversation": conversation, "messages": messages or []}


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    user: dict = Depends(auth.get_current_user),
) -> dict:
    try:
        deleted = db.delete_conversation(user["id"], conversation_id)
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversación no encontrada.",
        )
    return {"deleted": True}
