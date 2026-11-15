# Signos vitales — 7 signos, cada uno con su propia gráfica (v4.3)

## Qué cambió

El apartado de Signos vitales mostraba una única gráfica continua
(la onda de FC) y tres tarjetas. Ahora muestra los **7 signos
vitales**, cada uno en su tarjeta con su valor actual, su referencia
general y **una gráfica distinta** (ninguna repite el estilo de otra):

| # | Signo vital | Valor | Gráfica propia |
|---|-------------|-------|----------------|
| 1 | Presión arterial | 118/76 mmHg | Dos líneas (sistólica / diastólica) con banda 90–120 |
| 2 | Frecuencia cardíaca | 67 bpm | Onda ECG continua (la de siempre, animada) |
| 3 | Frecuencia respiratoria | 15 rpm | Onda respiratoria suave |
| 4 | Temperatura corporal | 36.9 °C | Termómetro horizontal con banda 36.5–37.3 °C |
| 5 | Saturación de oxígeno | 98 % | Anillo (donut) con el % en el centro |
| 6 | Nivel de dolor | 0 / 10 | Escala segmentada de 0 a 10 |
| 7 | Peso corporal | 74.0 kg | Área de tendencia con línea del peso inicial |

Referencias generales usadas (formación, no umbrales clínicos):
PA ~120/80 mmHg · FC 60–100 lpm en reposo · FR 12–20 resp/min ·
temperatura 36.5–37.3 °C · SpO₂ por encima de 94–95 % · dolor 0–10 ·
peso estable ± 2 kg.

## Archivos

- `assets/js/signos.js` (v1.0.0-original): dibuja las 6 gráficas
  nuevas y actualiza los 4 valores nuevos (PA, FR, dolor, peso).
  La FC, la SpO₂ y la temperatura las sigue escribiendo
  `assets/js/bytemedicals.js` (`renderSignos`, que deriva sus valores
  de los compuestos del estado) y la onda ECG la sigue animando
  `drawWave`. No se tocó `bytemedicals.js` para esto.
- `assets/css/signos.css`: rejilla de tarjetas.
- `bytemedicals.html`: la página de Signos ahora es la rejilla de
  7 tarjetas; el medidor de radiación acumulada se mantiene aparte
  (es exposición, no un signo vital) y la tabla de telemetría queda
  como estaba.

## Datos

Telemetría simulada determinista (el día de misión es la semilla;
el mismo día siempre da el mismo valor). PA, FR, dolor y peso son
simulados; FC, SpO₂ y temperatura reutilizan el estado real de la
app cuando existe. El peso pierde ~1,5 kg en 180 días (deriva
lenta, como en microgravedad). Todo está etiquetado como simulado
en la página. No son mediciones clínicas ni umbrales diagnósticos.

## Redundancia eliminada (v4.3)

El panel "Telemetría por categoría" que estaba en Signos vitales y
la tarjeta de Condiciones en el Dashboard se eliminaron: la única
entrada a las condiciones es el botón "Condiciones frecuentes" del
menú.

## Verificación

- `verify-signos-jsdom.cjs` 16/16 (7 tarjetas, 7 canvas distintos,
  formatos de valor, referencias, compatibilidad con `renderSignos`,
  medidor de radiación).
- Regresión jsdom: conditions 20/20, chat 14/14, admin 16/16,
  auth-gate 8/8, pages 10/10.
