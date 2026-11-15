# Integración — Condiciones frecuentes en astronautas (v4.2)

## Qué es

Las 17 categorías de condiciones descalificantes de la NASA
(OCHMO-STD-100.1A — Space Flight Medical Selection, Recertification
and Mission Evaluation Standards — y OCHMO-MTB-002 — Waivered Health
Conditions) como referencia de monitorización dentro de la app.

Cada categoría reúne sus telemetrías particulares (variable, unidad,
nivel de adquisición y gráfica propia) y compara los valores de
referencia generales con los valores simulados del astronauta en el
día actual de la misión.

## Dónde vive

- **Signos vitales** (`#page-signos`): nuevo panel «Telemetría por
  categoría» con las 17 categorías, su nivel y sus variables clave del
  día actual. Cada fila tiene un botón «Ver» que abre la categoría en
  la página nueva. Los signos vitales existentes no se tocaron.
- **Página nueva** (`#page-conditions`, «Condiciones frecuentes» en
  la barra lateral): las 17 tarjetas, cada una con su gráfica, su
  tabla de comparación (telemetría · unidad · referencia general ·
  astronauta simulado · nivel) y su nota de límite cuando aplica.
  Filtros por nivel: Todas / Continua / Periódica / Clínica.
- **Panel de control**: tarjeta resumen con el conteo de categorías
  y un botón hacia la página nueva.

## Archivos

- `assets/js/conditions.js` (v1.0.0-original): datos de las 17
  categorías, 17 renderizadores de gráfica, render de la página, del
  panel de Signos y de la tarjeta del Dashboard. API
  `window.Conditions = { VERSION, categories, refresh, showCategory, levels }`.
- `assets/css/conditions.css`: tarjetas, insignias de nivel, tablas,
  filtros, mapa corporal, odontograma y resaltado.
- `bytemedicals.html`: enlace CSS, botón de navegación, panel del
  Dashboard, panel de Signos y sección `#page-conditions` (dentro de
  `<main>`, dentro de `.app-shell`, para que `goToPage` la cubra).
- `assets/js/bytemedicals.js`: `'conditions'` añadido a `PAGE_IDS`.

## Las 17 categorías y su gráfica (una distinta por categoría)

| # | Categoría (NASA) | Nivel | Gráfica |
|---|---|---|---|
| 1 | Salud general | Continua | Carriles de tendencia (FC, temp., SpO₂) |
| 2 | Cabeza, cara y cuello | Periódica | Radar de 5 ejes |
| 3 | Obstetricia y ginecología | Clínica | Tira de ciclo de 28 días |
| 4 | Oído | Periódica | Audiograma (dB HL vs Hz) |
| 5 | Ojo | Periódica | Campo visual polar |
| 6 | Pulmones y pared torácica | Periódica | Bucle flujo-volumen |
| 7 | Salud mental | Continua | Mapa de calor 4×7 (sueño + ánimo) |
| 8 | Abdomen y digestión | Periódica | Barras horizontales con banda de referencia |
| 9 | Radiación | Continua | Área acumulada + límite 600 mSv |
| 10 | Cardiovascular | Continua | Tira de ECG simulado |
| 11 | Hematología | Clínica | Puntos sobre bandas de referencia |
| 12 | Nariz, senos, boca y garganta | Periódica | Medidor vertical de flujo nasal |
| 13 | Piel | Periódica | Mapa corporal por zonas (SVG) |
| 14 | Aptitud para el vuelo espacial | Periódica | Cuatro diales de arco |
| 15 | Dental | Clínica | Odontograma de 32 piezas (SVG) |
| 16 | Enfermedades infecciosas | Clínica | Temperatura (línea) + CRP (puntos) |
| 17 | Antropometría | Periódica | Barras verticales con banda de referencia |

## Niveles de adquisición

- **Continua**: sensores durante la misión (HR, HRV, SpO₂, RR,
  temperatura, dosimetría, sueño/actividad).
- **Periódica**: mediciones programadas (presión arterial,
  espirometría, audiometría, agudeza visual, IOP, antropometría,
  evaluaciones psicológicas y musculares).
- **Clínica**: análisis y evaluaciones médicas (hemograma, hormonas,
  CRP, cultivos, imagen, registros declarados).

## Límites honestos

- Todos los valores del astronauta son **simulados** (variación
  determinista según el día de misión). Los que ya existen en el
  estado de la app (FC, SpO₂, temperatura, radiación acumulada) se
  reutilizan tal cual, sin duplicarlos.
- Los rangos de «referencia» son **rangos generales de formación**,
  no umbrales clínicos de la NASA ni criterios de aptitud.
- El módulo **no diagnostica, no evalúa la aptitud para el vuelo**
  y no sustituye una evaluación médica.
- Variables que requieren instrumentación o laboratorio (presión
  intracraneal, presión intraocular, hematología, imagen,
  ecocardiografía, OCT, cultivos) se registran solo como telemetría
  clínica periódica, nunca como medición de wearable.
- El dosímetro mide exposición, no daño biológico directo. HRV y
  sueño son información indirecta: no diagnostican trastornos
  psiquiátricos. La antropometría es geométrica, no una señal
  fisiológica continua.
- Solo lee `localStorage['bytemedicals_state']`; nunca lo escribe.
  Su estado propio es `localStorage['bytemedicals_conditions']`
  (categoría seleccionada y filtro de nivel).

## Verificación

- `verify-conditions-jsdom.cjs`: **16/16** (17 categorías, 17
  gráficas distintas, tablas con SIMULADO, radiación reutilizada del
  estado — 120 mSv en el test —, panel de Signos con 17 filas,
  resumen del Dashboard, navegación, filtros, `showCategory`, y la
  regresión v4.1: navegar a Condiciones no apaga el login).
- `verify-app-pages-jsdom.cjs`: **10/10** (barra lateral ahora con
  8 secciones).
- `verify-auth-gate-jsdom.cjs`: **8/8** (sin cambios).
- `node --check assets/js/conditions.js`: OK.
- La página nueva está dentro de `.app-shell`, por lo que
  `goToPage` (alcance `.app-shell .page`, arreglo v4.1) la cubre y
  no toca `#page-auth`.

## Versión

v4.2 — `APP_VERSION = "4.0.0-prag-v4.2"`. ZIP
`ByteMedicals-PRAG-v4.2.zip` (98 entradas). Como en v4.1, trae solo
los `.env` de ejemplo: en una extracción nueva hay que copiar los
`.env`, `prag/.env` y `prag/gdrive_credentials.json` propios antes
de arrancar.

## v4.3 — Rediseño de la página (portada + detalle)

A petición de Mauricio, la página dejó de mostrar las 17 tarjetas
completas (demasiado texto): ahora es una portada con 17 opciones,
cada una con su pictograma SVG representativo + nombre en español +
nombre NASA en inglés. Al pulsar una, se abre su detalle: su gráfica
propia, las pestañas Continua / Periódica / Clínica (solo las que
tiene esa categoría) y las filas compactas de ese nivel (valor
simulado + referencia). El resumen largo y la tabla completa
desaparecieron; queda una nota corta solo donde es necesaria.

Se eliminó la redundancia: el panel "Telemetría por categoría" de
Signos vitales y la tarjeta de Condiciones en el Dashboard ya no
existen. La única entrada es el botón "Condiciones frecuentes" del
menú. `conditions.js` pasó a v1.1.0-original. Tests jsdom:
`verify-conditions-jsdom.cjs` 20/20.
