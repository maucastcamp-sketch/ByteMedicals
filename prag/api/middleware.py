from fastapi import Security, HTTPException
from fastapi.security import APIKeyHeader
from config.settings import settings

api_key_header = APIKeyHeader(
    name="X-API-Key",
    auto_error=False,
)


def verify_user_api_key(
    api_key: str = Security(api_key_header),
) -> str:
    """Verify access for regular PRAG users."""

    if not settings.prag_user_api_key:
        raise HTTPException(
            status_code=500,
            detail="User API key is not configured.",
        )

    if not api_key or api_key != settings.prag_user_api_key:
        raise HTTPException(
            status_code=403,
            detail="Invalid or missing user API key.",
        )

    return api_key


def verify_admin_api_key(
    api_key: str = Security(api_key_header),
) -> str:
    """Verify administrative access to PRAG."""

    if not settings.prag_admin_api_key:
        raise HTTPException(
            status_code=500,
            detail="Admin API key is not configured.",
        )

    if not api_key or api_key != settings.prag_admin_api_key:
        raise HTTPException(
            status_code=403,
            detail="Invalid or missing admin API key.",
        )

    return api_key
