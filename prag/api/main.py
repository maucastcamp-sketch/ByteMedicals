
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import settings
from api.routes import query, health, files, auth, sync

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PRAG API starting.")
    yield
    logger.info("PRAG API shutting down.")


def get_allowed_origins() -> list[str]:
    if settings.environment == "development":
        return [
            "http://localhost:5173",
            "http://localhost:3000",
        ]

    origins = settings.allowed_origins

    if not origins:
        raise RuntimeError(
            "ALLOWED_ORIGINS must be set in production."
        )

    return [origin.strip() for origin in origins.split(",") if origin.strip()]


app = FastAPI(
    title="PRAG - Personal RAG API",
    description="Query your personal documents using natural language.",
    version="1.0.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
    max_age=3600,
)


app.include_router(health.router, tags=["System"])
app.include_router(auth.router, tags=["Auth"])
app.include_router(files.router, tags=["Files"])
app.include_router(query.router, tags=["RAG"])
app.include_router(sync.router, tags=["Sync"])
