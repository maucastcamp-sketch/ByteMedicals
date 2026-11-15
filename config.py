"""Configuración del backend ByteMedicals.

Solo librería estándar: lee `.env` (si existe) y variables de entorno.
Ningún secreto tiene valor por defecto: si falta JWT_SECRET, la
autenticación falla de forma explícita en lugar de arrancar insegura.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # El entorno real manda: no pisar variables ya definidas.
        os.environ.setdefault(key, value)


_load_dotenv(BASE_DIR / ".env")


APP_VERSION = "4.0.0-prag-v4.3"


class Settings:
    jwt_secret: str = os.environ.get("JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    # Base de datos MySQL (bytemedicals_db)
    db_host: str = os.environ.get("DB_HOST", "127.0.0.1")
    db_port: int = int(os.environ.get("DB_PORT", "3306"))
    db_user: str = os.environ.get("DB_USER", "root")
    db_password: str = os.environ.get("DB_PASSWORD", "")
    db_name: str = os.environ.get("DB_NAME", "bytemedicals_db")
    prag_base_url: str = os.environ.get(
        "PRAG_BASE_URL", "http://127.0.0.1:8001"
    )
    prag_user_api_key: str = os.environ.get("PRAG_USER_API_KEY", "")
    prag_admin_api_key: str = os.environ.get("PRAG_ADMIN_API_KEY", "")
    # Cuenta administradora inicial (opcional): si están definidos y
    # no existe ese usuario, se crea con rol admin al arrancar.
    admin_email: str = os.environ.get("ADMIN_EMAIL", "")
    admin_password: str = os.environ.get("ADMIN_PASSWORD", "")


settings = Settings()
