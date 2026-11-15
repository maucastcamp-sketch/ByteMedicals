# ByteMedicals — Space Health Monitoring System

Plataforma web integrada para que los astronautas evalúen su propia salud en misiones de larga duración y actúen en consecuencia. Basada en los 5 peligros del vuelo espacial humano del Programa de Investigación Humana (HRP) de la NASA: radiación, aislamiento y confinamiento, distancia de la Tierra, gravedad alterada y entornos cerrados y hostiles.

## Qué incluye

- **Panel de control**: estado de la misión y vista en vivo de la Tierra con NASA Eyes.
- **Signos vitales**: 7 signos (presión arterial, frecuencia cardiaca, frecuencia respiratoria, temperatura, saturación de oxígeno, dolor y peso), cada uno con su propia gráfica, más la exposición a radiación aparte.
- **Condiciones frecuentes**: las 17 categorías de condiciones médicas de la NASA (OCHMO), cada una con su gráfica y niveles de adquisición (continua, periódica, clínica).
- **Anatomía Humana**: figura 3D interactiva por sistemas (Z-Anatomy), con esquema interactivo como respaldo.
- **AI Health Assistant**: chat con memoria que responde desde los documentos de la base de conocimiento (Google Drive) y cita sus fuentes. No es IA clínica.
- **Health Log y Medicamentos**: registro de síntomas y de medicamentos (nunca recomienda ni cambia dosis), enlazado al catálogo de insumos espaciales en [bytemedicals_insumos_espaciales.sql](./bytemedicals_insumos_espaciales.sql).
- **Peligros del vuelo espacial y Evaluación de riesgos**: los 5 peligros y los 17 riesgos del HRP de la NASA.
- **Administración**: estado de los servicios, documentos indexados, sincronización con Drive, usuarios y roles.

## Requisitos

- **Python 3.11 o superior** (en Windows, el lanzador `py`; si `python` abre la Microsoft Store, usa `py`).
- **MySQL** corriendo. La app crea sola la base `bytemedicals_db` y sus tablas al arrancar.
- **Qdrant** corriendo en http://localhost:6333 (con Docker o el binario).
- **Ollama** corriendo en http://localhost:11434 con el modelo `qwen2.5:3b-instruct` (`ollama pull qwen2.5:3b-instruct`).
- **Tesseract** (opcional, solo para leer texto de imágenes y PDF escaneados al sincronizar).
- Internet para NASA Eyes, los modelos 3D de anatomía y Google Drive.

## Ejecutar

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python verificar.py
```

`verificar.py` comprueba Python, los archivos `.env`, MySQL, Qdrant, Ollama, el modelo y Tesseract, y dice qué falta. Repítelo hasta que diga "todo listo".

Copia `.env.example` como `.env` y `prag/.env.example` como `prag/.env`, y completa tus valores: `ADMIN_EMAIL` y `ADMIN_PASSWORD` (cuenta administradora inicial), `DB_PASSWORD` (tu MySQL) y `DRIVE_FOLDER_ID` (tu carpeta de Google Drive). Las claves de PRAG deben ser **iguales** en los dos archivos. Copia tu `gdrive_credentials.json` (cuenta de servicio) dentro de la carpeta `prag/`. Nunca subas `.env` ni `gdrive_credentials.json` a un repositorio.

Arranca en **dos terminales**:

Terminal 1 — la app:

```powershell
python -m uvicorn app:app --port 8000
```

Terminal 2 — PRAG (desde la carpeta `prag/`):

```powershell
cd prag
..\.venv\Scripts\Activate.ps1
python -m uvicorn api.main:app --port 8001
```

Abre http://127.0.0.1:8000 y entra con tu cuenta de administrador. En **Administración** puedes sincronizar con Google Drive; en **AI Health Assistant** puedes preguntar. Las respuestas citan sus fuentes.

## Cómo funciona

El navegador habla con el backend (FastAPI, puerto 8000), que autentica con JWT, guarda usuarios y conversaciones en MySQL y reenvía las preguntas a PRAG (puerto 8001), el motor de IA que consulta Qdrant y Ollama sobre los documentos sincronizados desde Google Drive. La telemetría es simulada y determinista, con su procedencia etiquetada (simulado, manual o real). El navegador nunca habla directo con PRAG, Qdrant, Ollama ni Drive.

## Honestidad de los datos

Todos los indicadores de salud son simulados y están etiquetados como tales. Esta aplicación no es un dispositivo médico, no diagnostica, no evalúa aptitud para el vuelo y no sustituye la orientación de profesionales de la salud. Los rangos mostrados son referencias generales, no umbrales clínicos de la NASA.

## Atribuciones y uso

- Los modelos anatómicos son de [Z-Anatomy](https://github.com/Z-Anatomy/) y se comparten bajo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- El mapa interactivo se carga desde [NASA Eyes on the Earth](https://eyes.nasa.gov/apps/earth/).
- Datos de la NASA: Programa de Investigación Humana (HRP), [5 peligros del vuelo espacial humano](https://www.nasa.gov/hrp/hazards/) y [riesgos del vuelo espacial humano](https://www.nasa.gov/hrp/risks/); Agencia Espacial Canadiense (CSA), [monitoreo de radiación para la salud de los astronautas](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp).
- El código se distribuye bajo la licencia Apache 2.0 (ver `LICENSE`) y el motor de IA PRAG bajo la licencia MIT (ver `prag/LICENSE`). Los conceptos de órbitas y tour se inspiran en [Gravity](https://github.com/qunabu/Gravity) (GPL-3.0), sin copiar su código.
