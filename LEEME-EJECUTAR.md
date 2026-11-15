# Ejecutar ByteMedicals + PRAG

ByteMedicals con su IA (PRAG) conectada a tu Google Drive. La app
es una página web: el navegador abre la app, inicias sesión y
chateas. Por detrás hay dos servicios: la **app** (puerto 8000) y
**PRAG** (puerto 8001). El navegador nunca habla directo con PRAG,
Qdrant, Ollama ni Drive: todo pasa por el backend de la app.

## Requisitos previos

- **Python 3.11 o superior** instalado. En Windows, el comando que
  funciona es `py` (si `python` abre la Microsoft Store, usa `py`).
- **MySQL corriendo** (el servicio de MySQL o XAMPP). La app crea
  sola la base `bytemedicals_db` y sus tablas al arrancar.
- **Qdrant corriendo** en http://localhost:6333 (con Docker o el
  binario de Qdrant).
- **Ollama corriendo** en http://localhost:11434 con el modelo
  descargado: `ollama pull qwen2.5:3b-instruct`.
- **Tesseract** instalado (solo para leer texto de imágenes y PDF
  escaneados durante la sincronización).

## Primera vez (una sola vez por carpeta)

1. Extrae el ZIP en una **carpeta nueva** (no encima de otra versión).
   Funciona en cualquier carpeta, incluso si la ruta tiene espacios.
2. Abre una terminal en esa carpeta (en el Explorador: clic derecho
   en la carpeta → "Abrir en Terminal", o en VS Code: Terminal →
   Nueva terminal).
3. Crea el entorno virtual e instala las dependencias (tarda unos
   minutos la primera vez):
   ```
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```
   Las dependencias tienen ruedas para Windows con Python 3.11 a
   3.14. Si `python` abre la Microsoft Store, usa `py`.
4. Comprueba que todo está listo antes de arrancar:
   ```
   python verificar.py
   ```
   Te dice qué falta (archivos `.env`, MySQL, Qdrant, Ollama, el
   modelo, Tesseract) y cómo arreglarlo. Vuelve a ejecutarlo hasta
   que diga "todo listo". Si algo falla al arrancar después, este
   es el primer sitio donde mirar.
5. Los archivos `.env` y `prag\.env` **ya vienen incluidos en este
   ZIP** con las claves de ejemplo de PRAG y un `JWT_SECRET` generado
   para uso local. Solo tienes que completar estos valores:
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el `.env` de la raíz: tu
     cuenta de administrador (sin ellos no se crea ninguna cuenta
     admin al arrancar).
   - `DB_PASSWORD` en el `.env` de la raíz: la contraseña de tu
     MySQL (por ejemplo `root` y tu contraseña; la base `bytemedicals_db`
     la crea la app sola).
   - `DRIVE_FOLDER_ID` en `prag\.env`: el ID de tu carpeta "MI IA —
     KNOWLEDGE BASE" de Google Drive.
   Las claves de PRAG ya están puestas e iguales en los dos archivos.
   Si vas a publicar la app, cambia las dos claves y el `JWT_SECRET`
   por valores propios antes.
6. Copia tu `gdrive_credentials.json` (cuenta de servicio con acceso
   a esa carpeta) dentro de la carpeta `prag\`.

> ⚠️ **Si tu colección `personal-rag` de Qdrant ya existía con el
> modelo anterior (768 dimensiones):** el modelo actual usa 384
> dimensiones y Qdrant no mezcla tamaños. Borra la colección
> `personal-rag` en Qdrant y vuelve a sincronizar desde el panel de
> administración; PRAG la recrea sola con 384.

## Arrancar (dos terminales)

**Terminal 1 — la app:**
```
.venv\Scripts\Activate.ps1
python -m uvicorn app:app --port 8000
```
Abre http://127.0.0.1:8000/ (si el puerto 8000 está ocupado, es que la
app ya corre en otra terminal: ciérrala con Ctrl+C o usa `--port 8002`).

**Terminal 2 — PRAG:**
```
cd prag
..\.venv\Scripts\Activate.ps1
python -m uvicorn api.main:app --port 8001
```

Qdrant y Ollama deben estar corriendo antes que PRAG.

## Primera entrada

1. Entra con tu cuenta de administrador (`ADMIN_EMAIL` /
   `ADMIN_PASSWORD` del `.env`). Si no existe, la app la crea sola
   al arrancar.
2. Ve a **Administración** (barra lateral) → **Sincronizar con
   Google Drive**. Cuando termine, verás cuántos documentos se
   indexaron.
3. Ve a **AI Health Assistant** y pregunta. Las respuestas citan sus
   fuentes de Drive.

## Uso diario

- **Registrarse / iniciar sesión:** cada usuario tiene su cuenta y
  sus conversaciones son privadas: nadie más puede verlas.
- **Conversaciones:** el chat guarda cada conversación (botón
  "+ Nueva" para empezar otra, clic en una guardada para seguirla).
  PRAG recuerda los últimos turnos para responder preguntas de
  seguimiento.
- **Administración (solo admin):** estado de PRAG, Qdrant, Ollama y
  MySQL; documentos indexados; sincronización con Drive; usuarios
  y roles.

## Si algo falla

Lo primero: ejecuta `python verificar.py` y mira qué marca con
FALTA. Suele decir directamente qué servicio falta.

- **El login dice que la base no responde (503):** MySQL no está
  corriendo o los datos `DB_*` del `.env` están mal.
- **El chat dice "PRAG no está disponible":** PRAG no está corriendo
  (terminal 2) o Qdrant/Ollama están caídos. Mira el panel de
  Administración → Estado.
- **Error de dimensiones en Qdrant al sincronizar:** la colección
  es del modelo anterior (768). Bórrala y sincroniza de nuevo (ver
  el aviso de arriba).
- **PRAG no arranca con `InvalidURL`:** hay variables de proxy en la
  terminal (`HTTP_PROXY`, `NO_PROXY`). Ciérralas en esa terminal
  (`$env:HTTP_PROXY=""` y lo mismo para las demás) y arranca de nuevo.
- **La sincronización falla en imágenes o PDF escaneados:**
  falta Tesseract.
- **La página se ve como antes de actualizar:** Ctrl+F5 para
  recargar sin caché, y comprueba que extrajiste el ZIP en una
  carpeta nueva.
- **El mapa de NASA Eyes o el modelo 3D de Anatomía no cargan:**
  necesitan internet (NASA Eyes es la app de la NASA y los modelos
  3D se descargan de jsDelivr). Sin internet, la app funciona igual
  y la figura anatómica muestra el esquema. Los valores médicos son
  simulados y no sirven para diagnóstico.

## Publicación como página web

Los mismos servicios corren en un servidor (VPS o nube) y el dominio
apunta al backend de la app (puerto 8000). Drive sigue siendo la
fuente de los documentos, actualizada con la sincronización del panel
de admin. Ollama (modelo local) necesita un servidor con suficiente
RAM/CPU; la alternativa es `MODEL_PROVIDER=groq` (en la nube) en el
`.env` de PRAG, con tu `GROQ_API_KEY`.

## Seguridad

Nunca subas ni compartas los archivos `.env` ni
`gdrive_credentials.json` (están en `.gitignore`). Las claves de
ejemplo de los `.env.example` no son para producción. La clave de
admin de PRAG nunca llega al navegador.
