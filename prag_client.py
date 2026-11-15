"""Cliente del backend hacia PRAG (servicio aparte, solo localhost).

Toda llamada lleva la clave de usuario del SERVIDOR (nunca del
navegador). Si PRAG no responde, se traduce a un error claro para que
el chat muestre "PRAG no disponible" en lugar de un fallo genérico.
"""

import httpx

from config import settings

# El modelo local 3B hace 2 llamadas al LLM por pregunta (reescritura
# + respuesta): el tiempo de espera debe ser generoso.
TIMEOUT = 180.0


class PragUnavailable(Exception):
    """PRAG no responde (no arrancado, caído o demasiado lento)."""


class PragError(Exception):
    """PRAG respondió con un error (clave, configuración, fallo RAG)."""


async def _request(method: str, path: str, json: dict | None = None,
                   admin: bool = False) -> dict:
    key = (settings.prag_admin_api_key if admin
           else settings.prag_user_api_key)
    if not key:
        raise PragError(
            "Clave de PRAG no configurada en el servidor."
        )
    try:
        # trust_env=False: el backend solo habla con servicios locales
        # (PRAG en 127.0.0.1); las variables de proxy del entorno no
        # deben interceptar ni romper estas llamadas.
        async with httpx.AsyncClient(
            base_url=settings.prag_base_url, timeout=TIMEOUT,
            trust_env=False,
        ) as client:
            resp = await client.request(
                method, path, json=json,
                headers={"X-API-Key": key},
            )
    except httpx.ConnectError:
        raise PragUnavailable(
            "PRAG no está disponible (no se pudo conectar a "
            f"{settings.prag_base_url}). Revisa que PRAG esté corriendo."
        )
    except httpx.TimeoutException:
        raise PragUnavailable(
            "PRAG tardó demasiado en responder."
        )
    except httpx.HTTPError as exc:
        raise PragUnavailable(f"Error de conexión con PRAG: {exc}")
    if resp.status_code == 403:
        raise PragError("PRAG rechazó la clave de acceso.")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", "")
        except Exception:
            detail = ""
        raise PragError(
            detail or f"PRAG devolvió el error {resp.status_code}."
        )
    return resp.json()


async def prag_health() -> dict:
    return await _request("GET", "/health")


async def prag_query(query: str, top_k: int = 5,
                     history: list | None = None,
                     context: dict | None = None) -> dict:
    body = {"query": query, "top_k": top_k}
    if history:
        body["history"] = history
    if context:
        body["context"] = context
    return await _request("POST", "/query", json=body)


async def prag_files() -> dict:
    return await _request("GET", "/files")


async def prag_sync() -> dict:
    """Solo la usa el panel de administración (Paso 5)."""
    return await _request("POST", "/sync", admin=True)
