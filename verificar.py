"""ByteMedicals + PRAG — verificación de requisitos en esta computadora.

Comprueba todo lo necesario antes de arrancar (o cuando algo falla):
Python, dependencias, archivos .env, credenciales de Drive, MySQL,
Qdrant, Ollama (+ modelo) y Tesseract, y que los puertos 8000/8001
estén libres.

Uso (desde la carpeta del proyecto, con el venv activo si ya existe):
    python verificar.py

Solo usa la biblioteca estándar: funciona aunque falte instalar
requirements.txt, y dice exactamente qué falta y cómo arreglarlo.
Sale con código 0 si todo está bien, 1 si algo falla.
"""

import json
import os
import shutil
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESULTS = []  # (ok, nombre, detalle)


def check(ok, name, detail=""):
    RESULTS.append((bool(ok), name, detail))
    mark = "OK  " if ok else "FALTA"
    # El detalle es la pista para arreglarlo: solo se muestra si falla.
    print(f"[{mark}] {name}" + (f" — {detail}" if detail and not ok else ""))


def warn(name, detail=""):
    # Aviso: no impide arrancar, pero conviene arreglarlo.
    print(f"[AVISO] {name}" + (f" — {detail}" if detail else ""))


def read_env(path):
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def http_get(url, timeout=5):
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()


def port_free(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def main():
    print("ByteMedicals + PRAG — verificación de requisitos")
    print(f"Carpeta: {ROOT}")
    print()

    # 1. Python
    version = sys.version_info
    check(version >= (3, 11),
          f"Python {version.major}.{version.minor}.{version.micro}",
          "se necesita 3.11 o superior" if version < (3, 11) else "")
    print()

    # 2. Dependencias de Python (solo si el venv está instalado)
    needed = ["fastapi", "uvicorn", "jwt", "mysql.connector", "httpx",
              "langchain", "qdrant_client", "fastembed"]
    missing = []
    for module in needed:
        try:
            __import__(module)
        except ImportError:
            missing.append(module)
    check(not missing, "Dependencias instaladas (requirements.txt)",
          ("faltan: " + ", ".join(missing)
           + " — ejecuta: pip install -r requirements.txt")
          if missing else "")

    # 3. Archivos .env
    env_root = read_env(ROOT / ".env")
    env_prag = read_env(ROOT / "prag" / ".env")
    check(bool(env_root), "Archivo .env en la raíz",
          "copia .env.example como .env y completa tus valores"
          if not env_root else "")
    check(bool(env_prag), "Archivo prag/.env",
          "copia prag/.env.example como prag/.env y completa tus valores"
          if not env_prag else "")
    if env_root:
        jwt_secret = env_root.get("JWT_SECRET", "")
        check(len(jwt_secret) >= 32, "JWT_SECRET configurado",
              "genera uno con: python -c \"import secrets; "
              "print(secrets.token_hex(32))\""
              if len(jwt_secret) < 32 else "")
        user_key = env_root.get("PRAG_USER_API_KEY", "")
        admin_key = env_root.get("PRAG_ADMIN_API_KEY", "")
        check(bool(user_key) and bool(admin_key),
              "Claves de PRAG en .env",
              "pon PRAG_USER_API_KEY y PRAG_ADMIN_API_KEY" if not (
                  user_key and admin_key) else "")
        if user_key in ("1111", "2222") or admin_key in ("1111", "2222"):
            warn("Claves de ejemplo 1111/2222",
                 "funcionan en local, pero cámbialas por claves propias "
                 "antes de publicar")
        check(user_key == env_prag.get("PRAG_USER_API_KEY", "")
              and admin_key == env_prag.get("PRAG_ADMIN_API_KEY", "")
              and bool(user_key),
              "Claves iguales en .env y prag/.env",
              "las dos claves deben ser IGUALES en ambos archivos"
              if env_prag else "")
        check(bool(env_root.get("ADMIN_EMAIL", ""))
              and bool(env_root.get("ADMIN_PASSWORD", "")),
              "Cuenta de administrador (ADMIN_EMAIL/ADMIN_PASSWORD)",
              "sin ella no se crea ningún admin al arrancar"
              if not (env_root.get("ADMIN_EMAIL", "")
                      and env_root.get("ADMIN_PASSWORD", "")) else "")
    if env_prag:
        check(bool(env_prag.get("DRIVE_FOLDER_ID", "")),
              "DRIVE_FOLDER_ID en prag/.env",
              "es el ID de tu carpeta 'MI IA — KNOWLEDGE BASE' en Drive"
              if not env_prag.get("DRIVE_FOLDER_ID", "") else "")

    # 4. Credenciales de Google Drive
    creds = ROOT / "prag" / "gdrive_credentials.json"
    creds_ok = False
    if creds.is_file():
        try:
            json.loads(creds.read_text(encoding="utf-8"))
            creds_ok = True
        except (OSError, ValueError):
            pass
    check(creds_ok, "prag/gdrive_credentials.json",
          "copia tu archivo de cuenta de servicio en prag/"
          if not creds_ok else "")
    print()

    # 5. MySQL (puerto abierto; login si el conector está instalado)
    db_host = env_root.get("DB_HOST", "127.0.0.1")
    try:
        db_port = int(env_root.get("DB_PORT", "3306"))
    except ValueError:
        db_port = 3306
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    mysql_port_open = sock.connect_ex((db_host, db_port)) == 0
    sock.close()
    check(mysql_port_open, f"MySQL accesible en {db_host}:{db_port}",
          "revisa que MySQL esté corriendo" if not mysql_port_open else "")
    if mysql_port_open and "mysql.connector" not in missing:
        try:
            import mysql.connector
            conn = mysql.connector.connect(
                host=db_host, port=db_port,
                user=env_root.get("DB_USER", "root"),
                password=env_root.get("DB_PASSWORD", ""),
                connection_timeout=5,
            )
            conn.close()
            check(True, "Login a MySQL con los datos del .env")
        except Exception as exc:
            check(False, "Login a MySQL con los datos del .env", str(exc))

    # 6. Qdrant
    qdrant_url = env_prag.get("QDRANT_URL", "http://localhost:6333").rstrip("/")
    try:
        status, body = http_get(qdrant_url + "/")
        check(status == 200, f"Qdrant en {qdrant_url}",
              "" if status == 200 else f"respondió {status}")
    except Exception:
        check(False, f"Qdrant en {qdrant_url}",
              "revisa que Qdrant esté corriendo")

    # 7. Ollama + modelo
    ollama_url = env_prag.get("OLLAMA_BASE_URL",
                              "http://localhost:11434").rstrip("/")
    model = env_prag.get("CHAT_MODEL", "qwen2.5:3b-instruct")
    try:
        status, body = http_get(ollama_url + "/api/tags")
        names = [m.get("name", "") for m in json.loads(body).get("models", [])]
        check(model in names, f"Ollama en {ollama_url} con el modelo {model}",
              f"modelos presentes: {', '.join(names) or 'ninguno'} — "
              f"descárgalo con: ollama pull {model}" if model not in names else "")
    except Exception:
        check(False, f"Ollama en {ollama_url}",
              "revisa que Ollama esté corriendo (ollama serve)")

    # 8. Tesseract (OCR, solo para imágenes y PDF escaneados)
    tesseract = shutil.which("tesseract")
    if tesseract:
        check(True, "Tesseract (OCR)", tesseract)
    else:
        warn("Tesseract (OCR) no encontrado",
             "la app funciona igual; solo la sincronización no podrá "
             "leer imágenes ni PDF escaneados")
    print()

    # 9. Puertos libres
    check(port_free(8000), "Puerto 8000 libre (app)",
          "la app ya corre en otra terminal (ciérrala con Ctrl+C)"
          if not port_free(8000) else "")
    check(port_free(8001), "Puerto 8001 libre (PRAG)",
          "PRAG ya corre en otra terminal (ciérrala con Ctrl+C)"
          if not port_free(8001) else "")

    failed = [name for ok, name, _ in RESULTS if not ok]
    print()
    if failed:
        print(f"Resultado: {len(failed)} problema(s) por resolver. "
              "Arregla lo marcado con FALTA y vuelve a ejecutar "
              "python verificar.py.")
        return 1
    print("Resultado: todo listo. Arranca la app y PRAG como dice el "
          "LEEME-EJECUTAR.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
