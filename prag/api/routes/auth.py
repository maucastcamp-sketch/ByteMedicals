from fastapi import APIRouter, Security

from api.middleware import verify_user_api_key

router = APIRouter()


@router.get("/auth")
def verify_auth(
    _: str = Security(verify_user_api_key),
):
    """Validate access for a regular PRAG user."""

    return {
        "status": "authenticated",
        "role": "user",
    }