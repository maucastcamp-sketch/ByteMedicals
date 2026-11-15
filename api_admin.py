"""Rutas /api/admin/*: panel de administración.

Todo exige rol admin (auth.require_admin, comprobado en el
servidor en cada petición). Un usuario normal recibe 403 en
todas. La clave de admin de PRAG nunca sale del servidor: el
navegador solo ve el resultado de la sincronización.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Literal

import auth
import db
import prag_client
from config import APP_VERSION, settings

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def _prag_error_to_http(exc: Exception) -> HTTPException:
    """PRAG caído o con error: 502 con mensaje claro."""
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=str(exc),
    )


@router.get("/status")
async def admin_status(
    admin: dict = Depends(auth.require_admin),
) -> dict:
    """Estado de cada servicio: la página del admin lo muestra tal
    cual (200 aunque un servicio esté caído, para ver cuál es)."""
    database = "ok"
    try:
        db.db_ping()
    except db.DBUnavailable:
        database = "unavailable"

    prag = "ok"
    prag_detail = None
    prag_error = None
    try:
        prag_detail = await prag_client.prag_health()
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        prag = "unavailable"
        prag_error = str(exc)

    return {
        "database": database,
        "prag": prag,
        "prag_detail": prag_detail,
        "prag_error": prag_error,
        "version": APP_VERSION,
        "prag_base_url": settings.prag_base_url,
    }


@router.get("/files")
async def admin_files(
    admin: dict = Depends(auth.require_admin),
) -> dict:
    try:
        return await prag_client.prag_files()
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        raise _prag_error_to_http(exc)


@router.post("/sync")
async def admin_sync(
    admin: dict = Depends(auth.require_admin),
) -> dict:
    """Sincronizar Drive (clave de admin de PRAG, solo servidor)."""
    try:
        return await prag_client.prag_sync()
    except (prag_client.PragUnavailable, prag_client.PragError) as exc:
        raise _prag_error_to_http(exc)


@router.get("/users")
async def admin_users(
    admin: dict = Depends(auth.require_admin),
) -> list:
    try:
        return db.list_users()
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)


class RoleChange(BaseModel):
    role: Literal["user", "admin"]


@router.patch("/users/{user_id}/role")
async def admin_set_role(
    user_id: int,
    body: RoleChange,
    admin: dict = Depends(auth.require_admin),
) -> dict:
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes cambiar tu propio rol.",
        )
    try:
        user = db.set_user_role(user_id, body.role)
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )
    return user


@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    admin: dict = Depends(auth.require_admin),
) -> dict:
    if user_id == admin["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes borrar tu propia cuenta.",
        )
    try:
        deleted = db.delete_user(user_id)
    except db.DBUnavailable as exc:
        raise auth.db_error_to_http(exc)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )
    return {"deleted": True}
