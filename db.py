"""MySQL: usuarios, conversaciones y mensajes.

Base de datos `bytemedicals_db`. El
esquema vive en `bytemedicals_auth.sql`; la aplicación también crea
la base y las tablas sola al arrancar si el usuario de la base tiene
permiso. Guarda SOLO usuarios y conversaciones: nunca documentos
ni datos médicos.

- users: cuentas individuales con rol ('user' | 'admin').
- conversations / messages: memoria conversacional por usuario
  (Paso 4). Cada consulta filtra por user_id: nadie ve las
  conversaciones de otro usuario.
"""

import json
import logging
from contextlib import contextmanager

import mysql.connector
from mysql.connector import errors as mysql_errors
from mysql.connector import pooling

from config import settings

logger = logging.getLogger(__name__)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash CHAR(128) NOT NULL,
    salt CHAR(32) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT 'Nueva conversación',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
"""


class DBUnavailable(Exception):
    """La base de datos no responde (no arrancada, credenciales,
    red). Los endpoints la traducen a un 503 con mensaje claro."""


_pool = None


def _pool_config() -> dict:
    return {
        "pool_name": "bytemedicals",
        "pool_size": 5,
        "host": settings.db_host,
        "port": settings.db_port,
        "user": settings.db_user,
        "password": settings.db_password,
        "database": settings.db_name,
        "charset": "utf8mb4",
        "autocommit": True,
    }


def _get_pool():
    global _pool
    if _pool is None:
        try:
            _pool = pooling.MySQLConnectionPool(**_pool_config())
        except mysql_errors.Error as exc:
            raise DBUnavailable(
                "No se pudo conectar a MySQL en "
                f"{settings.db_host}:{settings.db_port} "
                f"({exc}). Revisa que MySQL esté corriendo y las "
                "credenciales del .env (DB_HOST, DB_USER, DB_PASSWORD)."
            )
    return _pool


@contextmanager
def get_connection():
    """Conexión del pool. Traduce errores de MySQL a DBUnavailable."""
    try:
        conn = _get_pool().get_connection()
    except mysql_errors.Error as exc:
        raise DBUnavailable(
            "No se pudo conectar a MySQL en "
            f"{settings.db_host}:{settings.db_port} ({exc})."
        )
    try:
        yield conn
    finally:
        conn.close()


def _ensure_database() -> None:
    """Crea la base si no existe (sin seleccionarla primero)."""
    cfg = _pool_config()
    cfg.pop("database")
    cfg.pop("pool_name", None)
    cfg.pop("pool_size", None)
    try:
        conn = mysql.connector.connect(**cfg)
    except mysql_errors.Error as exc:
        raise DBUnavailable(
            "No se pudo conectar a MySQL en "
            f"{settings.db_host}:{settings.db_port} ({exc})."
        )
    try:
        cursor = conn.cursor()
        cursor.execute(
            "CREATE DATABASE IF NOT EXISTS `%s` "
            "DEFAULT CHARACTER SET utf8mb4 "
            "DEFAULT COLLATE utf8mb4_unicode_ci" % settings.db_name
        )
        cursor.close()
    finally:
        conn.close()


def init_db() -> None:
    """Crea la base y las tablas si no existen. Si MySQL no está
    disponible, lanza DBUnavailable (el arranque lo registra y
    sigue sirviendo la app; los endpoints de datos dan 503)."""
    _ensure_database()
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            for statement in SCHEMA_SQL.split(";"):
                statement = statement.strip()
                if not statement:
                    continue
                try:
                    cursor.execute(statement)
                except mysql_errors.Error as exc:
                    # Los índices ya existen en rearranques: ignorar.
                    if exc.errno == 1061:
                        continue
                    raise
        finally:
            cursor.close()
    logger.info("Base de datos MySQL lista: %s", settings.db_name)


def db_ping() -> bool:
    """True si la base responde a un SELECT 1."""
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
        return True
    except DBUnavailable:
        return False


# ---------------------------------------------------------------------
# Usuarios
# ---------------------------------------------------------------------
def create_user(email: str, password_hash: str, salt: str,
                role: str = "user") -> dict | None:
    """Crea un usuario. Devuelve None si el email ya existe."""
    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            try:
                cursor.execute(
                    "INSERT INTO users (email, password_hash, salt, role)"
                    " VALUES (%s, %s, %s, %s)",
                    (email, password_hash, salt, role),
                )
                user_id = cursor.lastrowid
            finally:
                cursor.close()
    except mysql_errors.IntegrityError:
        return None
    return get_user_by_id(user_id)


def get_user_by_email(email: str) -> dict | None:
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, email, password_hash, salt, role, created_at"
                " FROM users WHERE email = %s",
                (email,),
            )
            return cursor.fetchone()
        finally:
            cursor.close()


def get_user_by_id(user_id: int) -> dict | None:
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, email, password_hash, salt, role, created_at"
                " FROM users WHERE id = %s",
                (user_id,),
            )
            return cursor.fetchone()
        finally:
            cursor.close()


def public_user(user: dict) -> dict:
    """Lo que el cliente puede ver de un usuario (nunca el hash)."""
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
    }


# ---------------------------------------------------------------------
# Conversaciones y mensajes (Paso 4)
# ---------------------------------------------------------------------
def create_conversation(user_id: int, title: str = "Nueva conversación") -> dict:
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "INSERT INTO conversations (user_id, title)"
                " VALUES (%s, %s)",
                (user_id, title),
            )
            conv_id = cursor.lastrowid
        finally:
            cursor.close()
    return get_conversation(user_id, conv_id)


def list_conversations(user_id: int) -> list:
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, user_id, title, created_at, updated_at"
                " FROM conversations WHERE user_id = %s"
                " ORDER BY updated_at DESC",
                (user_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()


def get_conversation(user_id: int, conversation_id: int) -> dict | None:
    """Solo si pertenece al usuario (aislamiento por user_id)."""
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, user_id, title, created_at, updated_at"
                " FROM conversations"
                " WHERE id = %s AND user_id = %s",
                (conversation_id, user_id),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()


def delete_conversation(user_id: int, conversation_id: int) -> bool:
    """Borra la conversación y sus mensajes (CASCADE). Solo la del
    usuario. Devuelve True si se borró algo."""
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM conversations"
                " WHERE id = %s AND user_id = %s",
                (conversation_id, user_id),
            )
            return cursor.rowcount > 0
        finally:
            cursor.close()


def add_message(conversation_id: int, role: str, content: str,
                sources: list | None = None) -> dict:
    sources_json = json.dumps(sources or [], ensure_ascii=False)
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "INSERT INTO messages (conversation_id, role, content, sources)"
                " VALUES (%s, %s, %s, %s)",
                (conversation_id, role, content, sources_json),
            )
            message_id = cursor.lastrowid
            cursor.execute(
                "SELECT id, conversation_id, role, content, sources, created_at"
                " FROM messages WHERE id = %s",
                (message_id,),
            )
            row = cursor.fetchone()
        finally:
            cursor.close()
    return _message_dict(row)


def list_messages(user_id: int, conversation_id: int,
                  limit: int = 100) -> list | None:
    """Mensajes de la conversación, solo si pertenece al usuario.
    Devuelve None si la conversación no es del usuario."""
    if get_conversation(user_id, conversation_id) is None:
        return None
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, conversation_id, role, content, sources, created_at"
                " FROM messages WHERE conversation_id = %s"
                " ORDER BY id ASC LIMIT %s",
                (conversation_id, limit),
            )
            return [_message_dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()


def list_users() -> list:
    """Todos los usuarios, sin hashes ni sales (nunca salen de aquí)."""
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, email, role, created_at FROM users"
                " ORDER BY created_at ASC"
            )
            users = []
            for row in cursor.fetchall():
                row["created_at"] = (
                    row["created_at"].isoformat()
                    if row["created_at"] is not None else None
                )
                users.append(row)
            return users
        finally:
            cursor.close()


def set_user_role(user_id: int, role: str) -> dict | None:
    """Cambia el rol. Devuelve el usuario público o None si no existe."""
    if role not in ("user", "admin"):
        raise ValueError("Rol no válido.")
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "UPDATE users SET role = %s WHERE id = %s",
                (role, user_id),
            )
            if cursor.rowcount == 0:
                return None
            cursor.execute(
                "SELECT id, email, role, created_at FROM users WHERE id = %s",
                (user_id,),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            return public_user(row)
        finally:
            cursor.close()


def delete_user(user_id: int) -> bool:
    """Borra el usuario; sus conversaciones y mensajes se borran
    en cascada (FK ON DELETE CASCADE)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            return cursor.rowcount > 0
        finally:
            cursor.close()


def set_conversation_title(user_id: int, conversation_id: int,
                           title: str) -> bool:
    """Cambia el título, solo si la conversación es del usuario."""
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE conversations SET title = %s"
                " WHERE id = %s AND user_id = %s",
                (title, conversation_id, user_id),
            )
            return cursor.rowcount > 0
        finally:
            cursor.close()


def recent_messages(user_id: int, conversation_id: int,
                    limit: int = 6) -> list | None:
    """Últimos mensajes (en orden cronológico), solo si la
    conversación pertenece al usuario. None si no es suya."""
    if get_conversation(user_id, conversation_id) is None:
        return None
    with get_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(
                "SELECT id, conversation_id, role, content, sources, created_at"
                " FROM messages WHERE conversation_id = %s"
                " ORDER BY id DESC LIMIT %s",
                (conversation_id, limit),
            )
            rows = [_message_dict(row) for row in cursor.fetchall()]
            rows.reverse()
            return rows
        finally:
            cursor.close()


def _message_dict(row: dict) -> dict:
    data = dict(row)
    try:
        data["sources"] = json.loads(data.get("sources") or "[]")
    except (ValueError, TypeError):
        data["sources"] = []
    created = data.get("created_at")
    if created is not None and not isinstance(created, str):
        data["created_at"] = created.isoformat()
    return data
