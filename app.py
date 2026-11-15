"""
ByteMedicals — backend de la aplicación (FastAPI).

Integración con PRAG — Paso 1: el backend sirve la app estática y
expone la API de la aplicación bajo /api/...

PRAG corre como servicio aparte (puerto 8001) y este backend lo llamará
con la clave de usuario del servidor. El navegador nunca habla con
PRAG directamente ni ve ninguna clave.

Seguridad: NO se sirve todo el directorio. Solo se exponen las rutas
que el navegador necesita (/, /bytemedicals.html, /assets/* y el SQL de
insumos enlazado desde Medicamentos). El código del backend, el .env
y la base de datos de usuarios nunca son alcanzables por HTTP.

Ejecutar (desde esta carpeta, con el venv activo):
    python -m uvicorn app:app --reload --port 8000
Abrir: http://127.0.0.1:8000/
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import api_admin
import api_conversations
import api_prag
import auth
import db
from config import APP_VERSION

BASE_DIR = Path(__file__).resolve().parent

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Si MySQL no está disponible al arrancar, la app sigue sirviendo
    # las páginas; los endpoints de datos responden 503 con el motivo.
    try:
        db.init_db()
        auth.ensure_admin_seed()
    except db.DBUnavailable as exc:
        logger.warning("Base de datos no disponible al arrancar: %s", exc)
    yield


app = FastAPI(
    title="ByteMedicals",
    description="Space Health Monitoring System — aplicación + API",
    version=APP_VERSION,
    lifespan=lifespan,
)


app.include_router(auth.router)
app.include_router(api_prag.router)
app.include_router(api_conversations.router)
app.include_router(api_admin.router)


@app.get("/api/health")
def api_health() -> dict:
    """Estado de la aplicación (solo este backend).

    El estado de PRAG está en GET /api/prag/health (con sesión).
    """
    return {
        "status": "ok",
        "service": "bytemedicals",
        "database": "ok" if db.db_ping() else "unavailable",
        "prag": "see /api/prag/health",
    }


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html")


@app.get("/bytemedicals.html", include_in_schema=False)
def bytemedicals_page() -> FileResponse:
    return FileResponse(BASE_DIR / "bytemedicals.html")


@app.get(
    "/bytemedicals_insumos_espaciales.sql",
    include_in_schema=False,
)
def insumos_sql() -> FileResponse:
    """Catálogo de insumos espaciales, enlazado desde Medicamentos."""
    return FileResponse(
        BASE_DIR / "bytemedicals_insumos_espaciales.sql",
        media_type="application/sql",
    )


# Solo los assets públicos. Nada más del disco es alcanzable por HTTP.
app.mount(
    "/assets",
    StaticFiles(directory=BASE_DIR / "assets"),
    name="assets",
)
