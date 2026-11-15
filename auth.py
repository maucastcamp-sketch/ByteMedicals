"""Autenticación: registro, login, JWT y roles.

- Contraseñas con `hashlib.scrypt` (librería estándar), sal única por
  usuario y comparación en tiempo constante.
- Sesiones con JWT (PyJWT, HS256, 24 h). El token viaja como
  `Authorization: Bearer <token>`; el cliente lo guarda en
  localStorage y lo envía en cada llamada a /api/*.
- El rol NUNCA viene del cliente: el registro siempre crea 'user'.
  El admin se crea solo desde ADMIN_EMAIL/ADMIN_PASSWORD del .env
  (ver `ensure_admin_seed`) o desde el panel de administración.
"""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import db
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# scrypt: n=2**14, r=8, p=1, 64 bytes de clave derivada.
_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 64

_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------
# Contraseñas
# ---------------------------------------------------------------------
def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return derived.hex(), salt.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return hmac.compare_digest(derived, expected)


# ---------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------
def _require_secret() -> str:
    if not settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET no configurado en el servidor.",
        )
    return settings.jwt_secret


def create_access_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, _require_secret(),
                      algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _require_secret(),
                          algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión expirada. Inicia sesión de nuevo.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido.",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Dependencia: usuario autenticado a partir del token Bearer."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falta el token de sesión.",
        )
    payload = decode_token(credentials.credentials)
    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido.",
        )
    try:
        user = db.get_user_by_id(user_id)
    except db.DBUnavailable as exc:
        raise db_error_to_http(exc)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado.",
        )
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependencia: solo rol admin (el permiso se comprueba aquí,
    en el servidor, nunca en lo que envía el frontend)."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere rol de administrador.",
        )
    return user


# ---------------------------------------------------------------------
# Esquemas y rutas
# ---------------------------------------------------------------------
class AuthRequest(BaseModel):
    email: str = Field(..., max_length=120)
    password: str = Field(..., min_length=8, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


def db_error_to_http(exc: db.DBUnavailable) -> HTTPException:
    """La base no responde: 503 con mensaje claro (no un 500)."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=str(exc),
    )


def _validate_auth_request(body: AuthRequest) -> str:
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Correo electrónico no válido.",
        )
    return email


@router.post("/register", response_model=AuthResponse,
             status_code=status.HTTP_201_CREATED)
def register(body: AuthRequest) -> AuthResponse:
    email = _validate_auth_request(body)
    password_hash, salt = hash_password(body.password)
    try:
        user = db.create_user(email, password_hash, salt, role="user")
    except db.DBUnavailable as exc:
        raise db_error_to_http(exc)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ese correo ya está registrado.",
        )
    logger.info("Usuario registrado: %s", email)
    return AuthResponse(
        access_token=create_access_token(user),
        user=db.public_user(user),
    )


@router.post("/login", response_model=AuthResponse)
def login(body: AuthRequest) -> AuthResponse:
    email = _validate_auth_request(body)
    try:
        user = db.get_user_by_email(email)
    except db.DBUnavailable as exc:
        raise db_error_to_http(exc)
    # Mismo mensaje exista o no el usuario: no revelar si el correo
    # está registrado.
    if user is None or not verify_password(
        body.password, user["salt"], user["password_hash"]
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas.",
        )
    return AuthResponse(
        access_token=create_access_token(user),
        user=db.public_user(user),
    )


@router.get("/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    return db.public_user(user)


# ---------------------------------------------------------------------
# Arranque: cuenta administradora inicial
# ---------------------------------------------------------------------
def ensure_admin_seed() -> None:
    """Crea el admin desde ADMIN_EMAIL/ADMIN_PASSWORD del .env si no
    existe ese usuario. Sin esas variables no se crea nada."""
    email = settings.admin_email.strip().lower()
    password = settings.admin_password
    if not email or not password:
        return
    if len(password) < 8:
        logger.warning(
            "ADMIN_PASSWORD demasiado corta (mínimo 8 caracteres);"
            " no se creó la cuenta administradora."
        )
        return
    if db.get_user_by_email(email) is not None:
        return
    password_hash, salt = hash_password(password)
    user = db.create_user(email, password_hash, salt, role="admin")
    if user is not None:
        logger.info("Cuenta administradora creada: %s", email)
