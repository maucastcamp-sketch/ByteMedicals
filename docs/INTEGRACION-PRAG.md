# Integración de PRAG en ByteMedicals

Fecha de inicio: 15 de noviembre de 2026.

## FASE 1 — Auditoría (completada 2026-11-15)

Base de la integración: la app actual de ByteMedicals y el motor
PRAG (45 archivos).

### La app actual (base de la integración)

- La app actual de ByteMedicals:
  6 áreas (Panel de control, Resumen de misión, Signos vitales,
  Anatomía Humana, AI Health Assistant, Medicamentos), 16 archivos,
  `bytemedicals.js` reescrito a 341 líneas, `bytemedicals.html` a 149 líneas.
- Estática: se corría con `python -m http.server 8080`. Sin backend,
  sin `app.py`, sin `requirements.txt`, sin login ni base de datos.
- Archivo nuevo: `bytemedicals_insumos_espaciales.sql` (449 líneas,
  catálogo/inventario/trazabilidad
  de insumos espaciales). No se toca.
- El asistente actual es local y basado en reglas (`answer()` en
  `bytemedicals.js`: 3 ramas por palabra clave). El chat ya existe en la
  página (`#chatLog`, `#chatForm`, `#chatInput`, sugerencias).
- El ZIP incluía el `.venv` entero; las entregas lo excluyen.

### PRAG

- Motor de IA con licencia MIT (ver `prag/LICENSE`). FastAPI +
  Ollama (`qwen2.5:3b-instruct`) + Qdrant
  (colección `personal-rag`) + Google Drive (cuenta de servicio,
  carpeta "MI IA — KNOWLEDGE BASE", sincronización recursiva con
  diff por md5, parsers PDF/DOCX/imágenes OCR/Markdown/texto/SQL).
- Endpoints: `GET /health` (sin auth), `GET /auth`, `GET /files`,
  `POST /query` (sin estado; máx. 500 caracteres; `top_k` 1–20),
  `POST /sync` (solo clave admin). Auth: `X-API-Key` compartida
  usuario/admin, sin usuarios ni JWT.
- Motor RAG: reescritura+clasificación de la consulta con el LLM,
  búsqueda híbrida densa + BM25 (fusión RRF), umbral 0.38, respuesta
  fundamentada solo en los fragmentos, con fuentes y su URL de Drive.
  Cada pregunta hace 2 llamadas al LLM.
- El ZIP no trae `.env` ni `gdrive_credentials.json` (bien).
- `ingestion/parsers.py` está vacío (0 bytes) junto al paquete
  `parsers/`; verificado que Python resuelve al paquete, así que
  funciona. Se borrará el archivo vacío por higiene.
- `.env.example` desactualizado: trae solo `PRAG_API_KEY`, pero el
  código usa `PRAG_USER_API_KEY` y `PRAG_ADMIN_API_KEY`.

### Conflictos encontrados

1. **Embeddings (el serio):** tres configuraciones distintas — el
   prompt pedía `MiniLM-L12-v2` (384); `settings.py` trae por
   defecto `BAAI/bge-small-en-v1.5` (384); `.env.example` dice
   `nomic-embed-text` con `QDRANT_VECTOR_SIZE=768`. Qdrant crea la
   colección una vez con un tamaño; si el modelo produce otro, las
   inserciones fallan. **Decisión (Mauricio, 2026-11-15): el modelo
   lo elijo yo → `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`,
   384 dimensiones, `QDRANT_VECTOR_SIZE=384`.** Multilingüe, mejor
   para documentos en español que el bge en inglés. Si la colección
   ya existe con otro tamaño, hay que recrearla y re-sincronizar.
2. **Puerto 8000:** PRAG y el viejo backend lo usaban. La app actual
   no tiene backend. Decisión: backend de la app en 8000, PRAG en
   8001 (solo localhost, interno).
3. **Autenticación:** PRAG solo tiene claves compartidas; la app no
   tiene login. Hay que construir registro + hash de contraseñas +
   JWT + roles + conversaciones por usuario. **Decisión inicial:
   SQLite** (un archivo local, sin servidor ni instalación; guarda
   SOLO usuarios y conversaciones, no documentos ni datos médicos).
   **Cambiada por Mauricio el 2026-11-15: MySQL** (ver "Migración a
   MySQL" más abajo). Sin base de datos no hay cuentas individuales:
   solo quedaría la clave compartida, que el propio pliego de
   Mauricio prohíbe como mecanismo de usuario.
4. **Memoria conversacional:** `/query` es sin estado. Se guarda en
   el backend de la app (historial por conversación y usuario) y se
   añade a PRAG un campo opcional de historial que solo entra al
   prompt del LLM, sin contaminar la búsqueda.
5. **CORS:** el CORS de PRAG en desarrollo solo permite 5173 y 3000.
   El navegador nunca hablará directo con PRAG: hablará con el
   backend de la app (mismo origen) y el backend llamará a PRAG con
   la clave de usuario. La clave de admin jamás sale del servidor.
6. **Dependencias:** PRAG trae pins nuevos (FastAPI 0.136.3,
   LangChain 1.3.4...) y necesita Ollama + Qdrant en local y
   Tesseract en Windows para OCR. El `requirements.txt` final será
   la unión y se probará la instalación en el Python de Mauricio.
7. **Claves de desarrollo:** Mauricio fijó claves de usuario y admin
   para su `.env` local (valores en su poder, nunca en el código ni
   en `.env.example`). Son claves de desarrollo: hay que cambiarlas
   antes de cualquier despliegue.

## FASE 2 — Diseño (decidido 2026-11-15)

```
Navegador → backend app (FastAPI :8000, sirve bytemedicals.html + /api/*)
              → login JWT + roles (MySQL bytemedicals_db: users, conversations, messages)
              → proxy a PRAG (:8001, solo localhost, X-API-Key usuario)
                 → Qdrant (:6333) + Ollama (:11434) → Drive (cuenta servicio)
              → admin (rol admin): /sync, /health, /files con clave admin
El navegador nunca ve claves de PRAG, ni Qdrant, ni Ollama, ni Drive.
```

- Base: la app actual de ByteMedicals.
- Embedding: MiniLM-L12-v2 multilingüe, 384 (fastembed).
- Usuarios y conversaciones: **MySQL** (`bytemedicals_db`;
  esquema en `bytemedicals_auth.sql`; contraseñas
  con `hashlib.scrypt` de la librería estándar; tokens con PyJWT).
  Si MySQL no está disponible al arrancar, la app sigue sirviendo
  las páginas y los endpoints de datos responden 503 con el motivo.
- Llamadas backend→PRAG con `httpx` (ya dependencia de PRAG).
- Un solo venv y un solo `requirements.txt` unificado.
- El backend sirve SOLO lo necesario por HTTP (`/`, `/bytemedicals.html`,
  `/assets/*`, el SQL de insumos). El código, el `.env` y la base de
  datos nunca son alcanzables por HTTP.

## Migración a MySQL (2026-11-15, pedida por Mauricio)

SQLite queda eliminado. La base es **MySQL, `bytemedicals_db`**, la base
de la aplicación, que usa el catálogo de insumos
(`bytemedicals_insumos_espaciales.sql`).

- Esquema: `bytemedicals_auth.sql` (aditivo; no toca el catálogo de insumos):
  tablas `users`, `conversations`, `messages` en `bytemedicals_db`.
  La app también crea la base y las tablas sola al arrancar.
- Acceso: `db.py` reescrito con `mysql-connector-python` (pool de 5
  conexiones). Misma API pública que antes (`create_user`,
  `get_user_by_email`, `get_user_by_id`, `public_user`) + funciones
  de conversaciones/mensajes para el Paso 4.
- Configuración (`.env`): `DB_HOST`, `DB_PORT`, `DB_USER`,
  `DB_PASSWORD`, `DB_NAME` (por defecto `127.0.0.1:3306`, `root`,
  `bytemedicals_db`). La base debe estar corriendo antes de arrancar la
  app (en Windows: el servicio MySQL o XAMPP).
- Si MySQL no responde: la app arranca igualmente (páginas
  estáticas) y `/api/health` informa `"database": "unavailable"`;
  login/registro y `/api/prag/*` responden 503 con el motivo.
- Re-verificación tras la migración: las suites de los Pasos 2
  (17 comprobaciones) y 3 (9 + jsdom 9) se volvieron a correr
  contra MySQL. **Verificado 2026-11-15 con MariaDB 10.11.14:**
  el archivo `bytemedicals_auth.sql` crea `bytemedicals_db` con las 3
  tablas; la app crea la base y las tablas sola al arrancar;
  **21/21 comprobaciones** (auth + proxy PRAG con las claves de
  ejemplo 1111/2222) pasaron contra MySQL; ninguna contraseña en
  claro en la base; con MySQL caído la app sigue sirviendo las
  páginas (`GET /` 200), `/api/health` informa
  `"database": "unavailable"` y el login responde 503 con el
  motivo y la pista (revisar MySQL y el `.env`).

## Publicación como página web (aclaración a Mauricio, 2026-11-15)

**Sí, la app ES una página web y se publica como tal.** El
navegador abre la app, el usuario inicia sesión y chatea: todo
ocurre en el navegador, como Mauricio planeaba. Lo que el
navegador NO hace es hablar DIRECTO con PRAG, Qdrant, Ollama o
Google Drive: habla con el backend de la app, y el backend habla
con PRAG. Eso es un detalle de arquitectura invisible para el
usuario, y es por seguridad: las claves de PRAG y las credenciales
de Drive nunca llegan al navegador (además, el CORS de PRAG no
permite el origen de la app).

- Local (desarrollo): app en :8000, PRAG en :8001, Qdrant :6333,
  Ollama :11434, MySQL :3306, todo en la misma máquina.
- Publicada (despliegue): los mismos servicios corren en un
  servidor (VPS/nube); el dominio apunta al backend de la app
  (:8000). Google Drive sigue siendo la fuente de los documentos:
  el admin sincroniza desde el panel y Qdrant se actualiza — la
  "DB actualizable" es la sincronización con Drive.
- Matiz para el despliegue: Ollama (modelo 3B local) necesita un
  servidor con RAM/CPU suficiente. La alternativa que PRAG ya
  trae es `MODEL_PROVIDER=groq` (inferencia en la nube, con clave
  de Groq) sin cambiar código. Se decide en el despliegue, no en
  el desarrollo local.

## FASE 3 — Integración (paso a paso)

- [x] **Paso 1 — Backend que sirve la app:** `app.py` (FastAPI,
      estática + `GET /api/health`), `requirements.txt`,
      `.env.example`, `.gitignore`. Verificado con smoke test
      (puerto 8017): `/`, `/bytemedicals.html`, `/assets/js/bytemedicals.js`,
      `/api/health` en HTTP 200; `app.py` y `.env` NO servidos
      (404). La app se ve exactamente igual que con `http.server`.
- [x] **Paso 2 — Autenticación:** `config.py` (lee `.env` con stdlib),
      `db.py` (MySQL tras la migración; antes SQLite), `auth.py`
      (scrypt + JWT HS256 24 h con PyJWT; registro/login/`/me`; rol
      nunca viene del cliente; `ensure_admin_seed` crea el admin
      desde ADMIN_EMAIL/ADMIN_PASSWORD del `.env`),
      `assets/js/auth.js` + `assets/css/auth.css` + página
      `#page-auth` en `bytemedicals.html` (login/registro, chip de usuario y
      salir en el header; sin sesión solo se ve el login).
      Verificado con servidor real (puerto 8017): 17/17 comprobaciones
      (registro 201 + rol user, duplicado 400, `role=admin` ignorado,
      email inválido 400, contraseña corta 422, login malo 401,
      `/me` sin token/basura 401, con token 200, admin seed con rol
      admin; token con `exp` a 24 h; ninguna contraseña en claro
      guardada). La suite se re-corrió contra MySQL tras la migración.
- [x] **Paso 3 — Proxy a PRAG:** PRAG copiado a `prag/` dentro del
      proyecto (se borró el `ingestion/parsers.py` vacío; la resolución
      del paquete ya estaba verificada); `prag/config/settings.py` con
      el modelo elegido (`MiniLM-L12-v2`) y `GOOGLE_CREDENTIALS_PATH`
      corregido; `prag/.env.example` corregido (EMBED_MODEL 384,
      QDRANT_VECTOR_SIZE=384, claves USER/ADMIN, QDRANT_URL local).
      Backend: `prag_client.py` (httpx, timeout 180 s, `trust_env=False`
      — las variables de proxy del entorno rompían las llamadas a
      localhost, descubierto y corregido en la verificación) y
      `api_prag.py` (`GET /api/prag/health`, `GET /api/prag/files`,
      `POST /api/prag/query`, todas con JWT; PRAG caído/error → 502
      con mensaje claro). Chat de `bytemedicals.js` conectado a PRAG
      (estado "pensando…", respuestas con fuentes enlazadas, línea de
      documentos indexados, errores visibles; la nota de seguridad y
      los botones de sugerencia ahora hablan de documentos).
      Verificado contra un PRAG simulado: 9/9 (health/files/query,
      501 caracteres 422, vacía 400, PRAG 500 → 502, sin token 401,
      JWT nunca llega a PRAG) + PRAG caído → 502 + clave mala → 502.
      Chat verificado en jsdom: 9/9 (respuesta y fuentes renderizadas,
      error sin romper la página). La prueba con el PRAG real
      (Ollama + Qdrant + Drive) queda para la máquina de Mauricio.
- [x] **Paso 4 — Memoria conversacional:** conversaciones por
      usuario en MySQL (`api_conversations.py`: listar/crear/leer/
      borrar, todas con propiedad verificada por `user_id`; un
      usuario que pide la conversación de otro recibe 404, como si
      no existiera) + campo opcional `history` en PRAG
      (`api/schemas/query.py`: `HistoryMessage {role, content ≤1000}`,
      `core/rag.py` lo pasa a `call_llm`, `llm/chat_llm.py` lo
      añade solo al prompt de la respuesta — nunca a la consulta de
      recuperación, así que el historial no cambia qué documentos
      se buscan). El backend (`api_prag.py`) acepta `conversation_id`
      opcional: carga los 6 últimos turnos, los recorta a 1000
      caracteres cada uno, los envía a PRAG y guarda la pregunta y
      la respuesta con sus fuentes; sin `conversation_id` la
      pregunta sigue siendo independiente (sin memoria). El título
      se pone solo desde la primera pregunta. El chat muestra la
      lista de conversaciones (abrir/borrar) y el botón "+ Nueva";
      "Limpiar" empieza una conversación nueva. Verificado
      2026-11-15 contra MySQL + PRAG simulado: 21/21 (crear,
      historial con 0 turnos en la 1ª pregunta y 2 turnos en la 2ª,
      4 mensajes con fuentes, título automático, aislamiento
      entre usuarios — leer/preguntar/borrar lo de otro → 404,
      pregunta suelta sin memoria, historial truncado a 1000, borrar
      + cascada) + jsdom 14/14 (lista, crear, abrir guardada,
      preguntar dentro de la abierta con su id, error sin romper).
      El historial de PRAG se verificó a nivel de esquema y de
      formato del prompt (sin Ollama/Qdrant aquí); la prueba
      extremo a extremo con el PRAG real queda para la máquina de
      Mauricio.
- [x] **Paso 5 — Panel de administración:** página "Administración"
      (`assets/js/admin.js`, visible solo con rol admin; el permiso
      se comprueba en el servidor con `auth.require_admin` en cada
      petición) con estado de los servicios (`GET /api/admin/status`:
      PRAG, Qdrant, Ollama, MySQL, versión — devuelve 200 aunque un
      servicio esté caído para ver cuál es), documentos indexados
      (`GET /api/admin/files`), sincronización con Drive
      (`POST /api/admin/sync`, clave de admin de PRAG solo en el
      servidor, nunca en el navegador; muestra descubiertos/
      ingestados/sin cambios/fallidos/eliminados) y usuarios
      (`GET /api/admin/users` sin hashes ni sales,
      `PATCH /api/admin/users/{id}/role`, `DELETE /api/admin/users/{id}`;
      un admin no puede cambiar su propio rol ni borrarse).
      Verificado 2026-11-15 contra MySQL + PRAG simulado: 25/25
      (usuario normal 403 en los 6 endpoints, sin token 401, admin
      con estado/archivos/sync/usuarios, rol inválido 422, propio
      rol 400, inexistente 404, borrar + cascada, PRAG caído: status
      200 con "unavailable" y files/sync 502, ninguna clave en las
      respuestas) + jsdom 16/16 (panel visible solo para admin, estado
      y documentos, cambiar rol, sincronizar, borrar; usuario normal
      sin llamadas a /api/admin/*). La sincronización real con Drive
      queda para la máquina de Mauricio.
- [x] **Paso 6 — Pruebas FASE 4 + entrega:** `requirements.txt`
      unificado (gana el pin de PRAG donde había conflicto:
      fastapi 0.136.3, uvicorn[standard] 0.49.0; mysql-connector
      añadido) e instalado en un venv limpio el 2026-11-15
      (fastapi 0.136.3, uvicorn 0.49.0, importaciones de langchain/
      fastembed/qdrant-client/MySQL/JWT/httpx correctas; la app de
      PRAG importa bien — 9 rutas — con las variables de proxy del
      entorno retiradas; en el equipo de Mauricio no existen esas
      variables). Regresión completa con ese venv: 67/67 del backend
      (Pasos 2+3: 21, Paso 4: 21, Paso 5: 25) + 3 con PRAG caído
      (status 200 con "unavailable", files/sync 502) + jsdom 40/40
      (chat 14, admin 16, páginas 10 — con stub de canvas, bytemedicals.js
      evalúa entero y las funciones originales siguen funcionando).
      Seguridad: `/app.py` y `/.env` devuelven 404, `/api/auth/me`
      sin token 401, ninguna clave en los archivos servidos
      (1111/2222 solo en los `.env.example` y en esta documentación),
      `.gitignore` cubre `.env`, `gdrive_credentials.json` y `*.db`.
      `LEEME-EJECUTAR.md` reescrito con el procedimiento completo
      (requisitos, `.env` raíz y `prag/`, `gdrive_credentials.json`,
      aviso de la colección Qdrant de 768 → 384, dos terminales,
      primera sincronización, solución de problemas, publicación).
      Entrega: `ByteMedicals-PRAG-v1.zip` (nombre nuevo, completo).

## Portabilidad — que funcione en otra computadora (2026-11-15)

Pedido de Mauricio: el código debe funcionar para quien lo ejecute
en su computadora, no solo en la suya. Verificado y añadido:

- **Sin rutas de máquina en el código:** ningún `C:\`, `/home/` ni
  ruta absoluta en la app ni en PRAG; todo es relativo a la carpeta
  del proyecto o configurable por `.env` (DB_HOST/DB_PORT,
  PRAG_BASE_URL, OLLAMA_BASE_URL, QDRANT_URL).
- **Dependencias instalables en Windows:** comprobadas en PyPI las
  ruedas de todos los paquetes compilados para Windows +
  Python 3.11 y 3.14 (onnxruntime, grpcio, numpy, lxml, tokenizers,
  cryptography, pydantic-core, pillow, PyMuPDF, httptools,
  watchfiles, orjson, entre otros). `uvloop` no tiene rueda para
  Windows, pero el propio `uvicorn[standard]` lo excluye en win32,
  así que pip lo omite solo.
- **`verificar.py` (nuevo, solo biblioteca estándar):** diagnostica
  Python 3.11+, dependencias, los dos `.env`, JWT_SECRET, claves
  de PRAG (iguales en ambos archivos; avisa si siguen siendo las
  de ejemplo), ADMIN_EMAIL/PASSWORD, DRIVE_FOLDER_ID,
  `gdrive_credentials.json`, MySQL (puerto + login con los datos
  del `.env`), Qdrant, Ollama + modelo `qwen2.5:3b-instruct`,
  Tesseract (aviso, no bloqueo) y puertos 8000/8001 libres. Sale
  con 0 si todo está listo y 1 si algo falta, diciendo cómo
  arreglarlo. Probado en una copia limpia: sin configurar marca
  6 problemas con sus arreglos; configurada con servicios
  simulados marca todo listo. También se probó desde una ruta con
  espacios.
- **LEEME-EJECUTAR.md:** paso nuevo para ejecutar `verificar.py`
  antes de arrancar, nota de que NASA Eyes y el modelo 3D necesitan
  internet (sin internet la app funciona y la figura muestra el
  esquema), y versión de Python verificada (3.11 a 3.14).
- Entrega: `ByteMedicals-PRAG-v2.zip` (nombre nuevo, completo).
- **v3 (2026-11-15, a petición de Mauricio):** el ZIP ya incluye los
  archivos `.env` y `prag/.env` creados, con las claves de ejemplo de
  PRAG (iguales en ambos) y un `JWT_SECRET` generado para uso local.
  Solo faltan por completar `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
  `DB_PASSWORD` y `DRIVE_FOLDER_ID`. `APP_VERSION` pasa a
  `4.0.0-prag-v3`. Verificado desde una copia extraída en ruta con
  espacios: `verificar.py` marca OK los `.env`, las claves y el
  `JWT_SECRET`; la app arranca (health 200, bytemedicals.html 200, admin
  sin token 401). En esa VM la base marcaba "unavailable" porque
  MariaDB ya no está instalada ahí; en la máquina de Mauricio con
  MySQL corriendo y su contraseña en el `.env`, debe marcar ok.
- **v4 (2026-11-15, cambio de imagen completo, a petición de Mauricio):**
  toda mención de VITALS y de otros trabajos desaparece del código, los
  textos visibles, los nombres de archivo (`bytemedicals.html`,
  `assets/js/bytemedicals.js`, `assets/css/bytemedicals.css`), las claves
  de `localStorage` (`bytemedicals_state`, `bytemedicals_theme`), la base
  (`bytemedicals_db`) y los docs. La página de Signos vitales pasa a
  llamarse `signos` internamente. Se conservan solo los avisos que exigen
  las licencias: `LICENSE` (Apache 2.0), `prag/LICENSE` (MIT) y el crédito
  de Z-Anatomy en la página de Anatomía (CC BY-SA 4.0). `APP_VERSION`
  pasa a `4.0.0-prag-v4`.

## FASE 4 — Resumen de pruebas (2026-11-15)

| Área | Resultado |
|---|---|
| Registro/login/JWT/roles (Paso 2) | 17/17, re-corridos 21/21 con MySQL |
| Proxy a PRAG + chat (Paso 3) | 9/9 + jsdom 9/9 |
| Conversaciones + historial (Paso 4) | 21/21 + jsdom 14/14 |
| Panel de admin (Paso 5) | 25/25 + jsdom 16/16 |
| Funciones originales de la app | jsdom 10/10 |
| Instalación unificada (venv limpio) | pip OK, importaciones OK, PRAG importa OK |
| PRAG caído | status 200 "unavailable", files/sync 502 |
| Seguridad | 404 en `/app.py` y `/.env`, 401 sin token, sin claves servidas |

Pendiente en la máquina de Mauricio (necesita sus servicios
locales): pregunta real a PRAG con Ollama + Qdrant + Drive,
historial extremo a extremo con el modelo real, sincronización
real con Drive (incluida la recreación de la colección si era de
768 dimensiones) y la primera entrada como admin.

## Licencias

- El código de la aplicación se distribuye bajo la licencia Apache 2.0
  (ver `LICENSE`).
- El motor de IA PRAG se distribuye bajo la licencia MIT
  (ver `prag/LICENSE`).
- Los modelos anatómicos 3D son de Z-Anatomy, bajo CC BY-SA 4.0
  (crédito en la página de Anatomía).
- El mapa orbital se carga desde NASA Eyes on the Earth.

## Memoria y contexto de misión (v4.3)

La conversación ya enviaba los últimos 6 turnos como historial, pero
el prompt los trataba solo como referencias y, sin fragmentos, la
respuesta era una frase fija ("No encontré información relevante...").
Ahora PRAG razona como asistente médico de a bordo:

- `prag/llm/chat_llm.py`: el prompt del sistema prohíbe responder
  "ve a un doctor" como si hubiera uno cerca; pide registrar el
  síntoma en el Health Log, revisar los signos vitales relacionados,
  vigilar la evolución y avisar al oficial médico o al cirujano de
  vuelo por el enlace con retardo. El historial se usa como memoria:
  si el usuario ya mencionó un síntoma, se reconoce y se sigue su
  evolución. Sin fragmentos, el LLM responde igualmente: dice que
  los documentos no lo cubren y da los pasos de a bordo, sin
  inventar datos médicos. `call_llm` acepta `mission_context`.
- `prag/api/schemas/query.py`: `QueryRequest` acepta `context`
  opcional (día, FC, SpO2, temp, radiación).
- `prag/core/rag.py`: `answer_query(..., mission_context)`; el
  camino sin fragmentos llama al LLM en lugar de la frase fija.
- `prag/api/routes/query.py`, `api_prag.py`, `prag_client.py`:
  el contexto fluye backend → PRAG. `assets/js/bytemedicals.js`
  (`askPrag`) lo construye desde el estado de la app en cada
  pregunta. La clave de PRAG sigue sin llegar nunca al navegador.
- Verificación: `verify-prag-memory.py` 10/10 (prompt, bloque de
  misión, historial, camino sin fragmentos) y
  `test-prag-client-context.py` (cuerpo enviado a PRAG).
