/* ByteMedicals — Condiciones frecuentes en astronautas (v4.2).
 * Las 17 categorías de condiciones descalificantes de la NASA
 * (OCHMO-STD-100.1A / OCHMO-MTB-002) como referencia de
 * monitorización: cada categoría reúne sus telemetrías particulares
 * (unidad, nivel de adquisición y gráfica propia), y compara los
 * valores de referencia generales con los valores simulados del
 * astronauta en el día actual de la misión.
 *
 * LÍMITES HONESTOS (no negociables):
 * - Todos los valores del astronauta son SIMULADOS (deterministas
 *   según el día de misión; los que existen en el estado de la app
 *   — FC, SpO2, temperatura, radiación — se reutilizan tal cual).
 * - Los rangos de "referencia" son rangos generales de formación,
 *   NO umbrales clínicos de la NASA ni criterios de aptitud.
 * - Este módulo NO diagnostica, NO evalúa la aptitud para el vuelo
 *   y NO sustituye una evaluación médica. Algunas variables (presión
 *   intracraneal, presión intraocular, hematología, imagen) requieren
 *   instrumentación o laboratorio y aquí solo se registran como
 *   telemetría clínica periódica, nunca como medición de wearable.
 * - Solo lee el estado de la app (bytemedicals_state); nunca lo
 *   escribe. Su estado propio es localStorage['bytemedicals_conditions']
 *   (solo la categoría seleccionada y el filtro de nivel).
 */
(() => {
  'use strict';

  const VERSION = '1.1.0-original';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (v, dec) => Number(v).toFixed(dec);

  /* Variación determinista (misma entrada → mismo valor): el dato
   * simulado es reproducible y no pretende ser una medición real. */
  function vary(seed, day, amp) {
    return Math.sin((day + seed) * 0.7) * amp
      + Math.sin((day + seed * 3) * 0.23) * amp * 0.5;
  }

  /* Estado de la app, solo lectura. */
  function readState() {
    try {
      const s = JSON.parse(localStorage.getItem('bytemedicals_state') || 'null');
      return s && typeof s === 'object' ? s : {};
    } catch (e) { return {}; }
  }
  function liveValue(kind, state) {
    const frames = Array.isArray(state.telemetry) ? state.telemetry : [];
    const last = frames.length ? frames[frames.length - 1] : {};
    if (kind === 'hr') return Number.isFinite(last.hr) ? last.hr : null;
    if (kind === 'spo2') return Number.isFinite(last.spo2) ? last.spo2 : null;
    if (kind === 'temp') return Number.isFinite(last.temp) ? last.temp : null;
    if (kind === 'rad') {
      const c = state.current || {};
      return Number.isFinite(c.radiation) ? c.radiation : null;
    }
    return null;
  }
  function missionDay(state) {
    return Number.isInteger(state.day) ? state.day : 0;
  }

  function varValue(v, day, state) {
    const live = v.live ? liveValue(v.live, state) : null;
    if (live !== null) return live;
    return clamp(v.base + vary(v.seed, day, v.amp), v.min ?? -Infinity, v.max ?? Infinity);
  }
  function varSeries(v, day, state, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = day - i;
      if (d < 0) continue;
      out.push({ day: d, value: varValue(v, d, state) });
    }
    return out;
  }

  const LEVELS = {
    continua: 'Continua',
    periodica: 'Periódica',
    clinica: 'Clínica',
  };

  /* Las 17 categorías OCHMO. Cada variable: nombre, unidad, rango de
   * referencia general, valor base simulado, amplitud, semilla,
   * decimales y nivel de adquisición. `live` reutiliza el estado real
   * de la simulación cuando existe. */
  const CATEGORIES = [
    {
      id: 'general', name: 'Salud general', nasa: 'Health Disorder (General)',
      level: 'continua', chart: 'lanes',
      summary: 'Signos vitales básicos vigilados de forma continua durante toda la misión.',
      note: '',
      vars: [
        { name: 'Frecuencia cardíaca', unit: 'bpm', ref: '60–100', base: 72, amp: 6, seed: 1, dec: 0, level: 'continua', live: 'hr' },
        { name: 'Temperatura corporal', unit: '°C', ref: '36.5–37.5', base: 36.6, amp: 0.2, seed: 2, dec: 1, level: 'continua', live: 'temp' },
        { name: 'Saturación de oxígeno', unit: '%', ref: '≥ 95', base: 98.5, amp: 0.8, seed: 3, dec: 0, level: 'continua', live: 'spo2' },
        { name: 'Frecuencia respiratoria', unit: 'rpm', ref: '12–20', base: 15, amp: 2, seed: 4, dec: 0, level: 'continua' },
      ],
    },
    {
      id: 'head', name: 'Cabeza, cara y cuello', nasa: 'Head, Face & Neck Disorder',
      level: 'periodica', chart: 'radar',
      summary: 'Dolor, movilidad cervical, equilibrio y coordinación.',
      note: 'La presión intracraneal no es una medición rutinaria de wearable: requiere método clínico con indicación.',
      vars: [
        { name: 'Dolor de cabeza (EVA)', unit: '0–10', ref: '0', base: 1, amp: 1, seed: 5, dec: 0, min: 0, max: 10, level: 'periodica' },
        { name: 'Movilidad cervical', unit: '°', ref: '70–90', base: 82, amp: 5, seed: 6, dec: 0, level: 'periodica' },
        { name: 'Equilibrio', unit: '0–100', ref: '≥ 80', base: 88, amp: 5, seed: 7, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Coordinación', unit: '0–100', ref: '≥ 80', base: 90, amp: 4, seed: 8, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Evaluación neurológica', unit: '0–100', ref: '≥ 80', base: 92, amp: 3, seed: 9, dec: 0, min: 0, max: 100, level: 'clinica' },
      ],
    },
    {
      id: 'obgyn', name: 'Obstetricia y ginecología', nasa: 'Obstetrics and Gynecology Disorder',
      level: 'clinica', chart: 'cycle',
      summary: 'Registro del ciclo, síntomas y pruebas hormonales cuando están indicadas.',
      note: 'El registro del ciclo es un dato clínico declarado por la tripulante, no una señal de sensor.',
      vars: [
        { name: 'Día del ciclo', unit: 'día', ref: '1–28', base: 14, amp: 0, seed: 10, dec: 0, min: 1, max: 28, level: 'clinica' },
        { name: 'Frecuencia cardíaca', unit: 'bpm', ref: '60–100', base: 72, amp: 6, seed: 11, dec: 0, level: 'continua', live: 'hr' },
        { name: 'Presión arterial sistólica', unit: 'mmHg', ref: '90–120', base: 112, amp: 6, seed: 12, dec: 0, level: 'periodica' },
        { name: 'Temperatura corporal', unit: '°C', ref: '36.5–37.5', base: 36.6, amp: 0.2, seed: 13, dec: 1, level: 'continua', live: 'temp' },
      ],
    },
    {
      id: 'ear', name: 'Oído', nasa: 'Ear Disorder',
      level: 'periodica', chart: 'audiogram',
      summary: 'Audiometría, umbrales auditivos y función vestibular.',
      note: 'La audiometría y la timpanometría requieren equipo clínico; no las mide un wearable.',
      vars: [
        { name: 'Umbral auditivo · 1000 Hz', unit: 'dB HL', ref: '0–20', base: 8, amp: 3, seed: 14, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Umbral auditivo · 4000 Hz', unit: 'dB HL', ref: '0–25', base: 12, amp: 4, seed: 15, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Equilibrio vestibular', unit: '0–100', ref: '≥ 80', base: 87, amp: 5, seed: 16, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Vértigo (episodios/semana)', unit: 'n.º', ref: '0', base: 0, amp: 0.4, seed: 17, dec: 0, min: 0, max: 7, level: 'clinica' },
      ],
    },
    {
      id: 'eye', name: 'Ojo', nasa: 'Eye Disorder',
      level: 'periodica', chart: 'polar',
      summary: 'Agudeza visual, presión intraocular, campo visual y fondo de ojo.',
      note: 'La presión intraocular y el OCT requieren instrumentación oftalmológica; no son telemetría continua.',
      vars: [
        { name: 'Agudeza visual', unit: 'decimal', ref: '0.8–1.0', base: 1.0, amp: 0.05, seed: 18, dec: 2, min: 0.1, max: 1.2, level: 'periodica' },
        { name: 'Presión intraocular', unit: 'mmHg', ref: '10–21', base: 15, amp: 2, seed: 19, dec: 0, level: 'periodica' },
        { name: 'Campo visual', unit: '°', ref: '160–180', base: 172, amp: 4, seed: 20, dec: 0, level: 'periodica' },
        { name: 'Diámetro pupilar', unit: 'mm', ref: '2–6', base: 3.5, amp: 0.6, seed: 21, dec: 1, level: 'periodica' },
      ],
    },
    {
      id: 'lungs', name: 'Pulmones y pared torácica', nasa: 'Lungs and Chest Wall Disorder',
      level: 'periodica', chart: 'flowvolume',
      summary: 'Espirometría, saturación y CO₂ espirado.',
      note: 'La espirometría es una prueba funcional programada, no una señal continua.',
      vars: [
        { name: 'Frecuencia respiratoria', unit: 'rpm', ref: '12–20', base: 15, amp: 2, seed: 22, dec: 0, level: 'continua' },
        { name: 'Saturación de oxígeno', unit: '%', ref: '≥ 95', base: 98.5, amp: 0.8, seed: 23, dec: 0, level: 'continua', live: 'spo2' },
        { name: 'Capacidad vital forzada (FVC)', unit: 'L', ref: '3.5–5.5', base: 4.6, amp: 0.2, seed: 24, dec: 1, level: 'periodica' },
        { name: 'FEV1', unit: 'L', ref: '2.8–4.5', base: 3.8, amp: 0.15, seed: 25, dec: 1, level: 'periodica' },
        { name: 'CO₂ espirado (EtCO₂)', unit: 'mmHg', ref: '35–45', base: 39, amp: 2, seed: 26, dec: 0, level: 'periodica' },
      ],
    },
    {
      id: 'psych', name: 'Salud mental', nasa: 'Psychiatric Disorder',
      level: 'continua', chart: 'heatmap',
      summary: 'Sueño, HRV, estado de ánimo y rendimiento cognitivo.',
      note: 'HRV y sueño aportan información indirecta: no diagnostican trastornos psiquiátricos.',
      vars: [
        { name: 'Calidad del sueño', unit: '0–100', ref: '≥ 70', base: 78, amp: 9, seed: 27, dec: 0, min: 0, max: 100, level: 'continua' },
        { name: 'HRV (RMSSD)', unit: 'ms', ref: '20–100', base: 52, amp: 10, seed: 28, dec: 0, min: 5, max: 150, level: 'continua' },
        { name: 'Estado de ánimo', unit: '0–10', ref: '≥ 6', base: 7.5, amp: 1, seed: 29, dec: 1, min: 0, max: 10, level: 'periodica' },
        { name: 'Tiempo de reacción', unit: 'ms', ref: '200–300', base: 248, amp: 18, seed: 30, dec: 0, level: 'periodica' },
      ],
    },
    {
      id: 'abdomen', name: 'Abdomen y digestión', nasa: 'Abdomen and Digestive Disorder',
      level: 'periodica', chart: 'hbars',
      summary: 'Ingesta, hidratación, peso, glucosa y síntomas digestivos.',
      note: 'Las pruebas de función hepática y los marcadores digestivos requieren laboratorio.',
      vars: [
        { name: 'Glucosa', unit: 'mg/dL', ref: '70–100', base: 88, amp: 6, seed: 31, dec: 0, level: 'periodica' },
        { name: 'Peso corporal', unit: 'kg', ref: 'estable ± 2', base: 74, amp: 0.8, seed: 32, dec: 1, level: 'periodica' },
        { name: 'Ingesta energética', unit: 'kcal/día', ref: '2200–2800', base: 2500, amp: 150, seed: 33, dec: 0, level: 'periodica' },
        { name: 'Dolor abdominal (EVA)', unit: '0–10', ref: '0', base: 0, amp: 0.6, seed: 34, dec: 0, min: 0, max: 10, level: 'clinica' },
      ],
    },
    {
      id: 'radiation', name: 'Radiación', nasa: 'Radiation Disorder',
      level: 'continua', chart: 'area',
      summary: 'Dosis acumulada, tasa de dosis y marcadores de seguimiento.',
      note: 'El dosímetro mide exposición, no daño biológico directo. Límite de referencia de carrera: 600 mSv (NASA HRP).',
      vars: [
        { name: 'Dosis acumulada', unit: 'mSv', ref: '< 600', base: 0, amp: 0, seed: 35, dec: 0, level: 'continua', live: 'rad' },
        { name: 'Tasa de dosis', unit: 'µSv/h', ref: '10–25', base: 17, amp: 3, seed: 36, dec: 0, level: 'continua' },
        { name: 'Linfocitos', unit: '10³/µL', ref: '1.0–4.0', base: 2.1, amp: 0.3, seed: 37, dec: 1, level: 'clinica' },
        { name: 'Lesiones cutáneas', unit: 'n.º', ref: '0', base: 0, amp: 0.2, seed: 38, dec: 0, min: 0, max: 5, level: 'clinica' },
      ],
    },
    {
      id: 'cardio', name: 'Cardiovascular', nasa: 'Cardiovascular Disorder',
      level: 'continua', chart: 'ecg',
      summary: 'ECG, frecuencia cardíaca, HRV y presión arterial.',
      note: 'La ecocardiografía es un estudio de imagen clínico, no una señal de wearable.',
      vars: [
        { name: 'Frecuencia cardíaca', unit: 'bpm', ref: '60–100', base: 72, amp: 6, seed: 39, dec: 0, level: 'continua', live: 'hr' },
        { name: 'Presión arterial sistólica', unit: 'mmHg', ref: '90–120', base: 112, amp: 6, seed: 40, dec: 0, level: 'periodica' },
        { name: 'Presión arterial diastólica', unit: 'mmHg', ref: '60–80', base: 72, amp: 5, seed: 41, dec: 0, level: 'periodica' },
        { name: 'HRV (RMSSD)', unit: 'ms', ref: '20–100', base: 52, amp: 10, seed: 42, dec: 0, min: 5, max: 150, level: 'continua' },
      ],
    },
    {
      id: 'hematology', name: 'Hematología', nasa: 'Hematology Disorder',
      level: 'clinica', chart: 'dotrange',
      summary: 'Hemograma, hierro y coagulación.',
      note: 'Requiere muestras biológicas y análisis de laboratorio; no es telemetría continua.',
      vars: [
        { name: 'Hemoglobina', unit: 'g/dL', ref: '12–16', base: 14.2, amp: 0.5, seed: 43, dec: 1, level: 'clinica' },
        { name: 'Hematocrito', unit: '%', ref: '36–48', base: 42, amp: 1.5, seed: 44, dec: 0, level: 'clinica' },
        { name: 'Leucocitos', unit: '10³/µL', ref: '4.0–11.0', base: 6.8, amp: 0.8, seed: 45, dec: 1, level: 'clinica' },
        { name: 'Plaquetas', unit: '10³/µL', ref: '150–400', base: 250, amp: 25, seed: 46, dec: 0, level: 'clinica' },
      ],
    },
    {
      id: 'nose', name: 'Nariz, senos, boca y garganta', nasa: 'Nose, Sinus, Mouth/Throat Disorder',
      level: 'periodica', chart: 'gaugev',
      summary: 'Flujo nasal, obstrucción, voz y deglución.',
      note: '',
      vars: [
        { name: 'Flujo nasal inspiratorio', unit: 'L/min', ref: '100–180', base: 140, amp: 15, seed: 47, dec: 0, level: 'periodica' },
        { name: 'Obstrucción nasal', unit: '0–10', ref: '0', base: 1, amp: 1, seed: 48, dec: 0, min: 0, max: 10, level: 'periodica' },
        { name: 'Saturación de oxígeno', unit: '%', ref: '≥ 95', base: 98.5, amp: 0.8, seed: 49, dec: 0, level: 'continua', live: 'spo2' },
        { name: 'Dolor (EVA)', unit: '0–10', ref: '0', base: 0, amp: 0.6, seed: 50, dec: 0, min: 0, max: 10, level: 'clinica' },
      ],
    },
    {
      id: 'skin', name: 'Piel', nasa: 'Skin Disorder',
      level: 'periodica', chart: 'bodymap',
      summary: 'Temperatura cutánea, humedad, eritema y barrera cutánea.',
      note: 'Las lesiones se registran por zona corporal; la valoración definitiva es clínica.',
      vars: [
        { name: 'Temperatura cutánea', unit: '°C', ref: '32–35', base: 33.4, amp: 0.6, seed: 51, dec: 1, level: 'continua' },
        { name: 'Humedad cutánea', unit: '%', ref: '40–60', base: 48, amp: 5, seed: 52, dec: 0, min: 0, max: 100, level: 'periodica' },
        { name: 'Eritema', unit: '0–10', ref: '0', base: 0, amp: 0.5, seed: 53, dec: 0, min: 0, max: 10, level: 'clinica' },
        { name: 'TEWL', unit: 'g/m²/h', ref: '5–15', base: 9, amp: 2, seed: 54, dec: 0, level: 'periodica' },
      ],
    },
    {
      id: 'suitability', name: 'Aptitud para el vuelo espacial', nasa: 'Suitability for Spaceflight',
      level: 'periodica', chart: 'dials',
      summary: 'Capacidad aeróbica, fuerza, tolerancia ortostática y rendimiento cognitivo.',
      note: 'No es una enfermedad: son criterios de aptitud. Este panel no evalúa si alguien es apto para volar.',
      vars: [
        { name: 'VO₂ máx.', unit: 'mL/kg/min', ref: '35–50', base: 44, amp: 2, seed: 55, dec: 0, level: 'periodica' },
        { name: 'Fuerza de prensión', unit: 'kg', ref: '30–55', base: 42, amp: 3, seed: 56, dec: 0, level: 'periodica' },
        { name: 'Tolerancia ortostática', unit: 'min', ref: '≥ 10', base: 14, amp: 2, seed: 57, dec: 0, level: 'periodica' },
        { name: 'Tiempo de reacción', unit: 'ms', ref: '200–300', base: 248, amp: 18, seed: 58, dec: 0, level: 'periodica' },
      ],
    },
    {
      id: 'dental', name: 'Dental', nasa: 'Dental Disorder',
      level: 'clinica', chart: 'odontogram',
      summary: 'Dolor, encías, piezas dentales y radiografías.',
      note: 'La valoración y las radiografías dentales requieren revisión clínica.',
      vars: [
        { name: 'Dolor dental (EVA)', unit: '0–10', ref: '0', base: 0, amp: 0.5, seed: 59, dec: 0, min: 0, max: 10, level: 'clinica' },
        { name: 'Inflamación gingival', unit: '0–3', ref: '0', base: 0, amp: 0.3, seed: 60, dec: 0, min: 0, max: 3, level: 'clinica' },
        { name: 'Sangrado periodontal', unit: '0–3', ref: '0', base: 0, amp: 0.3, seed: 61, dec: 0, min: 0, max: 3, level: 'clinica' },
        { name: 'Movilidad dental', unit: '0–3', ref: '0', base: 0, amp: 0.2, seed: 62, dec: 0, min: 0, max: 3, level: 'clinica' },
      ],
    },
    {
      id: 'infectious', name: 'Enfermedades infecciosas', nasa: 'Infectious Disease',
      level: 'clinica', chart: 'scatterline',
      summary: 'Temperatura, leucocitos, CRP y cultivos.',
      note: 'Los cultivos y la PCR de patógenos requieren laboratorio; aquí solo se registra el resultado.',
      vars: [
        { name: 'Temperatura corporal', unit: '°C', ref: '36.5–37.5', base: 36.6, amp: 0.2, seed: 63, dec: 1, level: 'continua', live: 'temp' },
        { name: 'Leucocitos', unit: '10³/µL', ref: '4.0–11.0', base: 6.8, amp: 0.8, seed: 64, dec: 1, level: 'clinica' },
        { name: 'Proteína C reactiva (CRP)', unit: 'mg/L', ref: '< 5', base: 2.2, amp: 1.2, seed: 65, dec: 1, min: 0, level: 'clinica' },
        { name: 'Neutrófilos', unit: '10³/µL', ref: '1.8–7.0', base: 4.1, amp: 0.5, seed: 66, dec: 1, level: 'clinica' },
      ],
    },
    {
      id: 'anthropometry', name: 'Antropometría', nasa: 'Anthropometry Criteria',
      level: 'periodica', chart: 'propbars',
      summary: 'Estatura, masa, IMC y proporciones corporales.',
      note: 'Son mediciones geométricas, no señales fisiológicas continuas. No es una enfermedad: son criterios de selección.',
      vars: [
        { name: 'Estatura', unit: 'cm', ref: '150–190', base: 176, amp: 0, seed: 67, dec: 0, level: 'periodica' },
        { name: 'Masa corporal', unit: 'kg', ref: '50–95', base: 74, amp: 0.8, seed: 68, dec: 1, level: 'periodica' },
        { name: 'IMC', unit: 'kg/m²', ref: '18.5–24.9', base: 23.9, amp: 0.3, seed: 69, dec: 1, level: 'periodica' },
        { name: 'Envergadura', unit: 'cm', ref: '150–195', base: 178, amp: 0, seed: 70, dec: 0, level: 'periodica' },
      ],
    },
  ];

  /* ---------- Paleta (lee las variables CSS para respetar el tema) ---------- */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => (cs.getPropertyValue(n) || '').trim();
    return {
      accent: v('--accent') || '#55d5e8', ok: v('--ok') || '#54d7a0',
      watch: v('--watch') || '#f5c45e', crit: v('--crit') || '#ff6874',
      muted: v('--muted') || '#9aabba', line: v('--line') || '#25394b',
      text: v('--text') || '#e8f0f7',
    };
  }
  function ctx2d(canvas, w, h) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, w, h); }
    return ctx;
  }
  function text(ctx, s, x, y, color, size, align) {
    ctx.fillStyle = color;
    ctx.font = (size || 11) + 'px Space Grotesk, system-ui, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  function bandColor(v, min, max, pal) {
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    return t < 0.6 ? pal.ok : t < 0.85 ? pal.watch : pal.crit;
  }

  /* ---------- 17 gráficas distintas (una por categoría) ---------- */
  const CHARTS = {
    /* 1. General: carriles de tendencia (una serie por carril, escala propia). */
    lanes(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const lanes = cat.vars.slice(0, 3);
      const laneH = 190 / lanes.length;
      lanes.forEach((v, i) => {
        const y0 = i * laneH, yMid = y0 + laneH / 2;
        const pts = varSeries(v, day, state, 30);
        if (!pts.length) return;
        const vals = pts.map(p => p.value);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const span = (hi - lo) || 1;
        text(ctx, v.name + ' (' + v.unit + ')', 8, y0 + 11, pal.muted, 10);
        ctx.strokeStyle = pal.line;
        ctx.beginPath(); ctx.moveTo(8, y0 + laneH - 8); ctx.lineTo(512, y0 + laneH - 8); ctx.stroke();
        ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.6;
        ctx.beginPath();
        pts.forEach((p, j) => {
          const x = 8 + (j / Math.max(pts.length - 1, 1)) * 440;
          const y = y0 + laneH - 14 - ((p.value - lo) / span) * (laneH - 30);
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke(); ctx.lineWidth = 1;
        const cur = varValue(v, day, state);
        text(ctx, fmt(cur, v.dec) + ' ' + v.unit, 452, yMid, pal.text, 11, 'left');
      });
    },
    /* 2. Cabeza: radar de 5 ejes. */
    radar(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const cx = 130, cy = 95, R = 68;
      const axes = [
        { label: 'Cefalea (sin dolor)', score: (10 - varValue(cat.vars[0], day, state)) * 10 },
        { label: 'Mov. cervical', score: (varValue(cat.vars[1], day, state) / 90) * 100 },
        { label: 'Equilibrio', score: varValue(cat.vars[2], day, state) },
        { label: 'Coordinación', score: varValue(cat.vars[3], day, state) },
        { label: 'Neurológico', score: varValue(cat.vars[4], day, state) },
      ];
      const pt = (i, r) => {
        const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      };
      [0.33, 0.66, 1].forEach(f => {
        ctx.strokeStyle = pal.line;
        ctx.beginPath();
        axes.forEach((_, i) => { const [x, y] = pt(i, R * f); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath(); ctx.stroke();
      });
      ctx.strokeStyle = pal.accent; ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.25;
      ctx.beginPath();
      axes.forEach((ax, i) => { const [x, y] = pt(i, R * clamp(ax.score, 0, 100) / 100); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      axes.forEach((ax, i) => {
        const [x, y] = pt(i, R + 12);
        text(ctx, ax.label, x, y, pal.muted, 10, 'center');
      });
      ctx.fillStyle = pal.text;
      axes.forEach((ax, i) => {
        const [x, y] = pt(i, R * clamp(ax.score, 0, 100) / 100);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
      text(ctx, 'Puntuación 0–100 por eje', 260, 30, pal.muted, 11);
      text(ctx, 'Valores simulados del día ' + day, 260, 52, pal.text, 12);
      text(ctx, 'Un eje bajo no es un diagnóstico:', 260, 76, pal.muted, 11);
      text(ctx, 'solo indica qué variable revisar.', 260, 94, pal.muted, 11);
    },
    /* 3. Obstetricia: tira de ciclo de 28 días con fases. */
    cycle(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const phases = [
        { name: 'Menstrual', from: 1, to: 5, color: pal.crit },
        { name: 'Folicular', from: 6, to: 13, color: pal.accent },
        { name: 'Ovulación', from: 14, to: 14, color: pal.watch },
        { name: 'Lútea', from: 15, to: 28, color: pal.ok },
      ];
      const x0 = 30, w = 460, y0 = 60, h = 44;
      phases.forEach(ph => {
        const x = x0 + ((ph.from - 1) / 28) * w;
        const pw = ((ph.to - ph.from + 1) / 28) * w;
        ctx.globalAlpha = 0.35; ctx.fillStyle = ph.color;
        ctx.fillRect(x, y0, pw, h); ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.line; ctx.strokeRect(x, y0, pw, h);
        text(ctx, ph.name, x + pw / 2, y0 + h / 2, pal.text, 10, 'center');
      });
      const cycDay = ((day % 28) + 28) % 28 + 1;
      const mx = x0 + ((cycDay - 1) / 28) * w;
      ctx.strokeStyle = pal.text; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, y0 - 12); ctx.lineTo(mx, y0 + h + 12); ctx.stroke(); ctx.lineWidth = 1;
      text(ctx, 'Día de ciclo (simulado): ' + cycDay + ' / 28', x0, 30, pal.text, 12);
      text(ctx, '1', x0, y0 + h + 26, pal.muted, 10);
      text(ctx, '28', x0 + w, y0 + h + 26, pal.muted, 10, 'right');
      text(ctx, 'Registro declarado, no señal de sensor.', x0, 160, pal.muted, 11);
    },
    /* 4. Oído: audiograma clásico (frecuencia vs umbral dB HL). */
    audiogram(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const freqs = [250, 500, 1000, 2000, 4000, 8000];
      const x0 = 46, x1 = 500, y0 = 18, y1 = 160;
      const X = f => x0 + (Math.log(f / 250) / Math.log(8000 / 250)) * (x1 - x0);
      const Y = db => y0 + (db / 100) * (y1 - y0);
      ctx.fillStyle = pal.ok; ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, Y(0), x1 - x0, Y(20) - Y(0)); ctx.globalAlpha = 1;
      text(ctx, 'Normal 0–20 dB', x1 - 4, Y(10), pal.ok, 10, 'right');
      ctx.strokeStyle = pal.line;
      [0, 20, 40, 60, 80, 100].forEach(db => {
        ctx.beginPath(); ctx.moveTo(x0, Y(db)); ctx.lineTo(x1, Y(db)); ctx.stroke();
        text(ctx, String(db), 30, Y(db), pal.muted, 10, 'right');
      });
      freqs.forEach(f => text(ctx, f >= 1000 ? (f / 1000) + 'k' : String(f), X(f), y1 + 14, pal.muted, 10, 'center'));
      const th = f => {
        const seed = f === 1000 ? cat.vars[0].seed : cat.vars[1].seed;
        return clamp(cat.vars[0].base + vary(seed, day, 4) + (f >= 4000 ? 4 : 0), 0, 100);
      };
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.8;
      ctx.beginPath();
      freqs.forEach((f, i) => { const x = X(f), y = Y(th(f)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.lineWidth = 1;
      freqs.forEach(f => {
        ctx.fillStyle = pal.accent;
        ctx.beginPath(); ctx.arc(X(f), Y(th(f)), 3.5, 0, Math.PI * 2); ctx.fill();
      });
      text(ctx, 'Umbral auditivo (dB HL) · día ' + day, x0, 8, pal.text, 11);
    },
    /* 5. Ojo: campo visual polar. */
    polar(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const cx = 120, cy = 95;
      [30, 60, 90].forEach(r => {
        ctx.strokeStyle = pal.line;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        text(ctx, r + '°', cx + r - 4, cy - 6, pal.muted, 9, 'right');
      });
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        ctx.strokeStyle = pal.line;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * 90, cy + Math.sin(ang) * 90); ctx.stroke();
      }
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2 + 0.2;
        const r = 25 + ((i * 37) % 60);
        const dim = (i % 5 === 0);
        ctx.fillStyle = dim ? pal.watch : pal.accent;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, dim ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = pal.text;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      text(ctx, 'Campo visual (simulado)', 250, 40, pal.text, 12);
      text(ctx, 'Agudeza: ' + fmt(varValue(cat.vars[0], day, state), 2), 250, 64, pal.muted, 11);
      text(ctx, 'IOP: ' + fmt(varValue(cat.vars[1], day, state), 0) + ' mmHg', 250, 84, pal.muted, 11);
      text(ctx, 'Puntos ámbar: zonas con menor', 250, 108, pal.muted, 11);
      text(ctx, 'sensibilidad registrada.', 250, 126, pal.muted, 11);
    },
    /* 6. Pulmones: bucle flujo-volumen. */
    flowvolume(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const x0 = 50, x1 = 490, y0 = 20, y1 = 150;
      const X = v => x0 + (v / 6) * (x1 - x0);
      const Y = f => y1 - ((f + 6) / 14) * (y1 - y0);
      ctx.strokeStyle = pal.line;
      ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
      text(ctx, 'Flujo (L/s)', 8, y0 + 4, pal.muted, 10);
      text(ctx, 'Volumen (L)', x1 - 60, y1 + 16, pal.muted, 10);
      const fvc = varValue(cat.vars[2], day, state);
      const pef = 7 + vary(cat.vars[2].seed, day, 0.4);
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const v = (i / 40) * fvc;
        const f = pef * (1 - Math.pow(v / fvc, 2)) * (1 - 0.25 * (v / fvc));
        const x = X(v), y = Y(Math.max(f, 0.2));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = pal.watch;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const v = fvc - (i / 40) * fvc;
        const f = -4.5 * Math.sin((i / 40) * Math.PI) - 0.4;
        const x = X(Math.max(v, 0)), y = Y(f);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.lineWidth = 1;
      text(ctx, 'Espiración', X(fvc * 0.55), Y(pef * 0.55), pal.accent, 10);
      text(ctx, 'Inspiración', X(fvc * 0.55), Y(-3.4), pal.watch, 10);
      text(ctx, 'FVC: ' + fmt(fvc, 1) + ' L · FEV1: ' + fmt(varValue(cat.vars[3], day, state), 1) + ' L', x0, 8, pal.text, 11);
    },
    /* 7. Salud mental: mapa de calor de 4 semanas × 7 días (sueño + ánimo). */
    heatmap(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const x0 = 60, y0 = 30, cw = 58, ch = 30, gap = 6;
      text(ctx, 'Sueño (color) · ánimo (punto) · 28 días', x0, 12, pal.text, 11);
      for (let w = 0; w < 4; w++) {
        for (let d = 0; d < 7; d++) {
          const absDay = day - (27 - (w * 7 + d));
          const sleep = absDay < 0 ? null : clamp(cat.vars[0].base + vary(cat.vars[0].seed, absDay, 9), 0, 100);
          const mood = absDay < 0 ? null : clamp(cat.vars[2].base + vary(cat.vars[2].seed, absDay, 1), 0, 10);
          const x = x0 + d * (cw + gap), y = y0 + w * (ch + gap);
          ctx.fillStyle = sleep === null ? pal.line : bandColor(sleep, 40, 95, pal);
          ctx.globalAlpha = sleep === null ? 0.25 : 0.85;
          ctx.fillRect(x, y, cw, ch); ctx.globalAlpha = 1;
          if (mood !== null) {
            ctx.fillStyle = '#07101a';
            ctx.beginPath(); ctx.arc(x + cw / 2, y + ch / 2, 3 + mood * 0.8, 0, Math.PI * 2); ctx.fill();
          }
        }
        text(ctx, 'S' + (w + 1), 34, y0 + w * (ch + gap) + ch / 2, pal.muted, 10, 'right');
      }
      ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach((l, d) =>
        text(ctx, l, x0 + d * (cw + gap) + cw / 2, y0 + 4 * (ch + gap) + 8, pal.muted, 10, 'center'));
    },
    /* 8. Abdomen: barras horizontales con banda de referencia. */
    hbars(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const rows = [
        { v: cat.vars[0], min: 50, max: 130 },
        { v: cat.vars[1], min: 65, max: 85 },
        { v: cat.vars[2], min: 1800, max: 3200 },
        { v: cat.vars[3], min: 0, max: 10 },
      ];
      rows.forEach((row, i) => {
        const y = 28 + i * 40;
        const cur = varValue(row.v, day, state);
        const X = val => 170 + ((val - row.min) / (row.max - row.min)) * 300;
        text(ctx, row.v.name, 8, y + 8, pal.text, 11);
        ctx.fillStyle = pal.ok; ctx.globalAlpha = 0.16;
        const refParts = row.v.ref.split('–').map(s => parseFloat(s));
        if (refParts.length === 2 && refParts.every(Number.isFinite)) {
          ctx.fillRect(X(refParts[0]), y, X(refParts[1]) - X(refParts[0]), 16);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.accent;
        ctx.fillRect(170, y, Math.max(X(cur) - 170, 2), 16);
        ctx.strokeStyle = pal.line; ctx.strokeRect(170, y, 300, 16);
        text(ctx, fmt(cur, row.v.dec) + ' ' + row.v.unit, 478, y + 8, pal.text, 11);
      });
      text(ctx, 'Banda clara: rango de referencia general', 8, 178, pal.muted, 10);
    },
    /* 9. Radiación: área acumulada + límite de 600 mSv. */
    area(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const x0 = 46, x1 = 500, y0 = 16, y1 = 150;
      const dose = liveValue('rad', state) ?? 0;
      const rate = dose / Math.max(day, 1);
      const total = d => (d <= day ? rate * d : dose + rate * (d - day));
      const X = d => x0 + (d / 180) * (x1 - x0);
      const Y = m => y1 - (m / 700) * (y1 - y0);
      ctx.strokeStyle = pal.crit; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Y(600)); ctx.lineTo(x1, Y(600)); ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, '600 mSv', x1 - 4, Y(600) - 10, pal.crit, 10, 'right');
      ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.2;
      ctx.beginPath(); ctx.moveTo(X(0), Y(0));
      for (let d = 0; d <= 180; d += 6) ctx.lineTo(X(d), Y(total(d)));
      ctx.lineTo(X(180), Y(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let d = 0; d <= 180; d += 6) { const x = X(d), y = Y(total(d)); d ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.strokeStyle = pal.muted; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(X(day), y0); ctx.lineTo(X(day), y1); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'Dosis acumulada (mSv) · día ' + day + ': ' + fmt(dose, 0) + ' mSv', x0, 8, pal.text, 11);
      text(ctx, 'Proyección simulada a día 180', x0, y1 + 14, pal.muted, 10);
    },
    /* 10. Cardiovascular: tira de ECG simulado. */
    ecg(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const hr = varValue(cat.vars[0], day, state);
      const period = 60 / Math.max(hr, 30);
      const pxPerSec = 90;
      const w = 520, yBase = 110;
      ctx.strokeStyle = pal.line;
      for (let gx = 0; gx < w; gx += 18) { ctx.beginPath(); ctx.moveTo(gx, 10); ctx.lineTo(gx, 170); ctx.stroke(); }
      for (let gy = 10; gy <= 170; gy += 18) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
      const beat = t => {
        const p = (t % period) / period;
        if (p < 0.12) return 6 * Math.sin((p / 0.12) * Math.PI);
        if (p < 0.18) return 0;
        if (p < 0.22) return -8 * Math.sin(((p - 0.18) / 0.04) * Math.PI);
        if (p < 0.28) return 52 * Math.sin(((p - 0.22) / 0.06) * Math.PI);
        if (p < 0.34) return -14 * Math.sin(((p - 0.28) / 0.06) * Math.PI);
        if (p < 0.55) return 0;
        if (p < 0.75) return 16 * Math.sin(((p - 0.55) / 0.2) * Math.PI);
        return 0;
      };
      ctx.strokeStyle = pal.ok; ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = yBase - beat(x / pxPerSec);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.lineWidth = 1;
      text(ctx, 'ECG simulado · FC ' + fmt(hr, 0) + ' bpm · no es un trazado real', 10, 186, pal.muted, 10);
    },
    /* 11. Hematología: puntos sobre bandas de referencia. */
    dotrange(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const rows = [
        { v: cat.vars[0], min: 8, max: 20 },
        { v: cat.vars[1], min: 25, max: 60 },
        { v: cat.vars[2], min: 2, max: 14 },
        { v: cat.vars[3], min: 100, max: 500 },
      ];
      rows.forEach((row, i) => {
        const y = 30 + i * 40;
        const cur = varValue(row.v, day, state);
        const X = val => 170 + ((val - row.min) / (row.max - row.min)) * 300;
        text(ctx, row.v.name, 8, y + 4, pal.text, 11);
        const refParts = row.v.ref.split('–').map(s => parseFloat(s));
        if (refParts.length === 2 && refParts.every(Number.isFinite)) {
          ctx.fillStyle = pal.ok; ctx.globalAlpha = 0.18;
          ctx.fillRect(X(refParts[0]), y - 6, X(refParts[1]) - X(refParts[0]), 12);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = pal.line;
        ctx.beginPath(); ctx.moveTo(170, y); ctx.lineTo(470, y); ctx.stroke();
        ctx.fillStyle = pal.accent;
        ctx.beginPath(); ctx.arc(clamp(X(cur), 170, 470), y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pal.text; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(clamp(X(cur), 170, 470), y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        text(ctx, fmt(cur, row.v.dec) + ' ' + row.v.unit, 478, y + 4, pal.text, 11);
      });
      text(ctx, 'Banda clara: rango de referencia general · punto: valor simulado', 8, 180, pal.muted, 10);
    },
    /* 12. Nariz: medidor vertical de flujo nasal. */
    gaugev(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const x = 120, y0 = 20, y1 = 160, w = 54;
      const cur = varValue(cat.vars[0], day, state);
      const Y = f => y1 - (f / 200) * (y1 - y0);
      ctx.fillStyle = pal.ok; ctx.globalAlpha = 0.16;
      ctx.fillRect(x, Y(180), w, Y(100) - Y(180)); ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.line; ctx.strokeRect(x, y0, w, y1 - y0);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(x + 3, Y(cur), w - 6, y1 - Y(cur));
      [0, 50, 100, 150, 200].forEach(f => {
        ctx.strokeStyle = pal.line;
        ctx.beginPath(); ctx.moveTo(x + w, Y(f)); ctx.lineTo(x + w + 8, Y(f)); ctx.stroke();
        text(ctx, String(f), x + w + 12, Y(f), pal.muted, 10);
      });
      text(ctx, 'Flujo nasal: ' + fmt(cur, 0) + ' L/min', 220, 60, pal.text, 13);
      text(ctx, 'Referencia general: 100–180 L/min', 220, 84, pal.muted, 11);
      text(ctx, 'Obstrucción: ' + fmt(varValue(cat.vars[1], day, state), 0) + ' / 10', 220, 108, pal.muted, 11);
      text(ctx, 'SpO₂: ' + fmt(varValue(cat.vars[2], day, state), 0) + ' %', 220, 132, pal.muted, 11);
    },
    /* 13. Piel: mapa corporal por zonas (SVG). */
    bodymap(host, cat, day, state, pal) {
      const zones = [
        { id: 'cara', label: 'Cara', score: clamp(100 - varValue(cat.vars[2], day, state) * 8, 0, 100) },
        { id: 'torso', label: 'Torso', score: clamp(100 - varValue(cat.vars[2], day, state) * 5, 0, 100) },
        { id: 'brazos', label: 'Brazos', score: clamp(96 - varValue(cat.vars[2], day, state) * 4, 0, 100) },
        { id: 'piernas', label: 'Piernas', score: clamp(98 - varValue(cat.vars[2], day, state) * 3, 0, 100) },
      ];
      const col = s => s >= 85 ? pal.ok : s >= 60 ? pal.watch : pal.crit;
      host.innerHTML =
        '<svg viewBox="0 0 200 190" width="200" height="190" role="img" aria-label="Mapa corporal por zonas">' +
        '<circle cx="100" cy="22" r="16" fill="' + col(zones[0].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '<rect x="78" y="44" width="44" height="62" rx="14" fill="' + col(zones[1].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '<rect x="52" y="48" width="18" height="56" rx="9" fill="' + col(zones[2].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '<rect x="130" y="48" width="18" height="56" rx="9" fill="' + col(zones[2].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '<rect x="80" y="110" width="17" height="66" rx="8" fill="' + col(zones[3].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '<rect x="103" y="110" width="17" height="66" rx="8" fill="' + col(zones[3].score) + '" fill-opacity="0.75" stroke="' + pal.line + '"/>' +
        '</svg>' +
        '<div class="cond-bodymap-legend">' + zones.map(z =>
          '<span><i style="background:' + col(z.score) + '"></i>' + esc(z.label) + ' · ' + Math.round(z.score) + '</span>'
        ).join('') + '</div>' +
        '<p class="muted">Integridad cutánea por zona (0–100, simulado). Temp. cutánea: ' +
        fmt(varValue(cat.vars[0], day, state), 1) + ' °C · TEWL: ' +
        fmt(varValue(cat.vars[3], day, state), 0) + ' g/m²/h.</p>';
    },
    /* 14. Aptitud: cuatro diales de arco. */
    dials(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const dials = [
        { v: cat.vars[0], min: 20, max: 60, label: 'VO₂ máx.' },
        { v: cat.vars[1], min: 15, max: 70, label: 'Fuerza' },
        { v: cat.vars[2], min: 0, max: 20, label: 'Toler. ortostática' },
        { v: cat.vars[3], min: 150, max: 400, label: 'T. reacción', invert: true },
      ];
      dials.forEach((d, i) => {
        const cx = 70 + i * 125, cy = 105, R = 44;
        const cur = varValue(d.v, day, state);
        let t = clamp((cur - d.min) / (d.max - d.min), 0, 1);
        if (d.invert) t = 1 - t;
        ctx.strokeStyle = pal.line; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.stroke();
        ctx.strokeStyle = t >= 0.6 ? pal.ok : t >= 0.35 ? pal.watch : pal.crit;
        ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, Math.PI + t * Math.PI); ctx.stroke();
        ctx.lineWidth = 1;
        const a = Math.PI + t * Math.PI;
        ctx.strokeStyle = pal.text;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); ctx.stroke();
        text(ctx, fmt(cur, d.v.dec) + ' ' + d.v.unit, cx, cy + 22, pal.text, 11, 'center');
        text(ctx, d.label, cx, cy + 40, pal.muted, 10, 'center');
        text(ctx, 'Ref: ' + d.v.ref, cx, cy + 56, pal.muted, 9, 'center');
      });
    },
    /* 15. Dental: odontograma de 32 piezas (SVG). */
    odontogram(host, cat, day, state, pal) {
      const tooth = i => {
        const pain = varValue(cat.vars[0], day, state);
        const bad = ((i * 7 + day) % 32) < (pain >= 4 ? 3 : pain >= 1 ? 1 : 0);
        const warn = ((i * 13 + day) % 32) < 4;
        return bad ? pal.crit : warn ? pal.watch : pal.ok;
      };
      const row = (from, to) => {
        let s = '';
        for (let i = from; i <= to; i++) {
          s += '<span class="cond-tooth" style="background:' + tooth(i) + '" title="Pieza ' + i + '"></span>';
        }
        return s;
      };
      host.innerHTML =
        '<div class="cond-odonto"><div class="cond-odonto-row">' + row(1, 16) + '</div>' +
        '<div class="cond-odonto-row">' + row(17, 32) + '</div></div>' +
        '<p class="muted">Arcada superior (1–16) e inferior (17–32). Verde: sin hallazgos; ' +
        'ámbar: vigilar; rojo: revisar. Dolor dental simulado: ' +
        fmt(varValue(cat.vars[0], day, state), 0) + ' / 10.</p>';
    },
    /* 16. Infecciosas: temperatura (línea) + CRP (puntos, eje derecho). */
    scatterline(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const x0 = 46, x1 = 440, y0 = 18, y1 = 150;
      const X = d => x0 + (d / 13) * (x1 - x0);
      const YT = t => y1 - ((t - 35.5) / 3) * (y1 - y0);
      const YC = c => y1 - (Math.min(c, 20) / 20) * (y1 - y0);
      ctx.strokeStyle = pal.watch; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x0, YT(37.5)); ctx.lineTo(x1, YT(37.5)); ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, '37.5 °C', x1 + 4, YT(37.5), pal.watch, 10);
      const tempPts = varSeries(cat.vars[0], day, state, 14);
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.8;
      ctx.beginPath();
      tempPts.forEach((p, i) => { const x = X(i), y = YT(p.value); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.lineWidth = 1;
      const crpPts = varSeries(cat.vars[2], day, state, 14);
      ctx.fillStyle = pal.crit;
      crpPts.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(X(i), YC(p.value), 4, 0, Math.PI * 2); ctx.fill();
      });
      text(ctx, 'Temperatura (línea) · CRP mg/L (puntos) · 14 días', x0, 8, pal.text, 11);
      text(ctx, '35.5', 30, YT(35.5), pal.muted, 9, 'right');
      text(ctx, '38.5', 30, YT(38.5), pal.muted, 9, 'right');
      text(ctx, 'CRP hoy: ' + fmt(varValue(cat.vars[2], day, state), 1) + ' mg/L (ref. < 5)', x0, y1 + 14, pal.muted, 10);
    },
    /* 17. Antropometría: barras verticales con banda de referencia. */
    propbars(canvas, cat, day, state, pal) {
      const ctx = ctx2d(canvas, 520, 190);
      if (!ctx) return;
      const bars = [
        { v: cat.vars[0], max: 200 },
        { v: cat.vars[1], max: 110 },
        { v: cat.vars[2], max: 30 },
        { v: cat.vars[3], max: 210 },
      ];
      const bw = 56, gap = 62, x0 = 52, y0 = 24, y1 = 150;
      bars.forEach((b, i) => {
        const cur = varValue(b.v, day, state);
        const x = x0 + i * (bw + gap);
        const h = (cur / b.max) * (y1 - y0);
        const refParts = b.v.ref.split('–').map(s => parseFloat(s));
        if (refParts.length === 2 && refParts.every(Number.isFinite)) {
          const yTop = y1 - (refParts[1] / b.max) * (y1 - y0);
          const yBot = y1 - (refParts[0] / b.max) * (y1 - y0);
          ctx.fillStyle = pal.ok; ctx.globalAlpha = 0.16;
          ctx.fillRect(x - 8, yTop, bw + 16, yBot - yTop);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = pal.accent;
        ctx.fillRect(x, y1 - h, bw, h);
        ctx.strokeStyle = pal.line; ctx.strokeRect(x, y1 - h, bw, h);
        text(ctx, fmt(cur, b.v.dec), x + bw / 2, y1 - h - 10, pal.text, 11, 'center');
        text(ctx, b.v.name, x + bw / 2, y1 + 14, pal.muted, 10, 'center');
        text(ctx, b.v.unit, x + bw / 2, y1 + 28, pal.muted, 9, 'center');
      });
      text(ctx, 'Banda clara: rango de referencia general', x0, 10, pal.muted, 10);
    },
  };

  const SVG_CHARTS = new Set(['bodymap', 'odontogram']);

  /* ---------- Estado propio (solo la categoría seleccionada) ---------- */
  function loadOwn() {
    try {
      const o = JSON.parse(localStorage.getItem('bytemedicals_conditions') || 'null');
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function saveOwn(o) {
    try { localStorage.setItem('bytemedicals_conditions', JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ }
  }
  let own = loadOwn();

  /* ---------- Imágenes representativas (pictogramas SVG) ---------- */
  const PIC = inner => '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const PICS = {
    general: PIC('<path d="M24 40 C13 31 9 24 9 17 C9 12 13 9 17 9 C20 9 22 11 24 14 C26 11 28 9 31 9 C35 9 39 12 39 17 C39 24 35 31 24 40 Z"/><path d="M14 24 h5 l2-4 3 8 2-4 h7"/>'),
    head: PIC('<circle cx="24" cy="16" r="10"/><path d="M8 42 c2-8 8-12 16-12 s14 4 16 12"/>'),
    obgyn: PIC('<circle cx="24" cy="16" r="9"/><path d="M24 25 v14 M17 32 h14"/>'),
    ear: PIC('<path d="M28 8 c-7 0-12 5-12 12 c0 8 4 12 8 16 c3 3 3 6 0 7 c-2 1-5 0-6-2"/><path d="M28 14 c-3 0-5 2-5 5 c0 4 3 5 5 8 c1 2 1 4-1 5"/>'),
    eye: PIC('<path d="M4 24 c6-8 13-11 20-11 s14 3 20 11 c-6 8-13 11-20 11 s-14-3-20-11 Z"/><circle cx="24" cy="24" r="6"/><circle cx="24" cy="24" r="2"/>'),
    lungs: PIC('<path d="M24 10 v26"/><path d="M24 14 C18 12 12 16 12 24 c0 8 3 12 6 12 c3 0 4-2 4-6 v-12"/><path d="M24 14 C30 12 36 16 36 24 c0 8-3 12-6 12 c-3 0-4-2-4-6 v-12"/>'),
    psych: PIC('<path d="M18 8 a7 7 0 0 0-7 7 c-3 1-4 4-3 7 c-1 3 1 6 4 7 c1 3 4 5 7 4 c1 2 5 2 6 0 c3 1 6-1 7-4 c3-1 5-4 4-7 c1-3 0-6-3-7 a7 7 0 0 0-7-7 c-2 1-4 1-8 0 Z"/>'),
    abdomen: PIC('<circle cx="24" cy="24" r="16"/><path d="M12 24 h6 a6 6 0 0 1 12 0 h6"/>'),
    radiation: PIC('<circle cx="24" cy="24" r="2.5" fill="currentColor"/><path d="M24 10 a14 14 0 0 1 12 7 l-6 3 a7 7 0 0 0-6-3.5 Z"/><path d="M36 26 a14 14 0 0 1-5 13 l-3-6 a7 7 0 0 0 1-7 Z"/><path d="M12 26 a14 14 0 0 1 5 13 l3-6 a7 7 0 0 0-1-7 Z"/>'),
    cardio: PIC('<path d="M24 40 C13 31 9 24 9 17 C9 12 13 9 17 9 C20 9 22 11 24 14 C26 11 28 9 31 9 C35 9 39 12 39 17 C39 24 35 31 24 40 Z"/><path d="M14 24 h5 l2-3 3 6 2-3 h8"/>'),
    hematology: PIC('<path d="M24 6 C24 6 12 20 12 29 a12 12 0 0 0 24 0 C36 20 24 6 24 6 Z"/>'),
    nose: PIC('<path d="M30 8 C22 10 18 16 18 24 c0 6 2 10 6 10 c3 0 5-2 5-5 c0-2-1-3-3-3"/><path d="M26 28 c-2 2-4 4-6 4"/>'),
    skin: PIC('<path d="M8 14 q8-3 16 0 t16 0"/><path d="M8 24 q8-3 16 0 t16 0"/><path d="M8 34 q8-3 16 0 t16 0"/>'),
    suitability: PIC('<path d="M14 20 v8 M18 16 v16 M30 16 v16 M34 20 v8 M18 24 h12"/>'),
    dental: PIC('<path d="M18 8 a8 8 0 0 0-8 8 c0 7 2 10 3 16 c1 5 2 8 4 8 c3 0 2-6 3-8 c1-3 2-4 4-4 s3 1 4 4 c1 2 0 8 3 8 c2 0 3-3 4-8 c1-6 3-9 3-16 a8 8 0 0 0-8-8 c-3 0-4 2-6 4 c-2-2-3-4-6-4 Z"/>'),
    infectious: PIC('<circle cx="24" cy="24" r="9"/><path d="M24 8 v5 M24 35 v5 M8 24 h5 M35 24 h5 M13 13 l4 4 M31 31 l4 4 M35 13 l-4 4 M17 31 l-4 4"/>'),
    anthropometry: PIC('<circle cx="24" cy="9" r="4"/><path d="M24 14 v10 M24 18 l-7 4 M24 18 l7 4 M24 24 l-4 14 M24 24 l4 14"/><path d="M38 14 v24 M38 14 h-3 M38 38 h-3"/>'),
  };

  /* ---------- Portada: 17 opciones con imagen ---------- */
  function optionHtml(cat) {
    return '<button class="cond-option" type="button" data-cond-open="' + cat.id + '">' +
      '<span class="cond-option-pic">' + (PICS[cat.id] || '') + '</span>' +
      '<span class="cond-option-name">' + esc(cat.name) + '</span>' +
      '<span class="cond-option-en">' + esc(cat.nasa) + '</span>' +
      '</button>';
  }

  function renderConditions() {
    const host = $('conditionsList');
    if (!host) return;
    host.innerHTML = CATEGORIES.map(optionHtml).join('');
    host.hidden = false;
    const detail = $('conditionsDetail');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  }

  /* ---------- Detalle: parámetros divididos por nivel ---------- */
  function levelList(cat) {
    const order = ['continua', 'periodica', 'clinica'];
    return order.filter(l => cat.vars.some(v => v.level === l));
  }

  function levelRows(cat, level, day, state) {
    return cat.vars.filter(v => v.level === level).map(v => {
      const cur = varValue(v, day, state);
      return '<div class="cond-var-row"><div><span class="cond-var-name">' + esc(v.name) + '</span>' +
        '<span class="cond-var-ref">Referencia: ' + esc(v.ref) + '</span></div>' +
        '<div class="cond-var-val"><strong>' + fmt(cur, v.dec) + ' ' + esc(v.unit) + '</strong>' +
        '<span class="cond-sim">SIMULADO</span></div></div>';
    }).join('');
  }

  function renderDetail(cat, level) {
    const detail = $('conditionsDetail');
    if (!detail) return;
    const list = $('conditionsList');
    const state = readState();
    const day = missionDay(state);
    const levels = levelList(cat);
    const active = levels.includes(level) ? level : levels[0];
    const chartHost = SVG_CHARTS.has(cat.chart)
      ? '<div class="cond-chart-host" data-chart="' + cat.id + '"></div>'
      : '<canvas class="cond-chart" data-chart="' + cat.id + '" width="520" height="190" aria-label="Gráfica de ' + esc(cat.name) + '"></canvas>';
    detail.innerHTML =
      '<button class="text-btn cond-back" type="button" data-cond-back>← Todas las categorías</button>' +
      '<div class="section-heading"><div><p class="eyebrow">CATEGORÍA OCHMO · ' + esc(cat.nasa.toUpperCase()) + '</p>' +
      '<h3>' + esc(cat.name) + '</h3></div>' +
      '<span class="cond-option-pic cond-detail-pic">' + (PICS[cat.id] || '') + '</span></div>' +
      '<div class="cond-tabs">' + levels.map(l =>
        '<button class="text-btn' + (l === active ? ' active' : '') + '" type="button" data-cond-tab="' + l + '">' + esc(LEVELS[l]) + '</button>'
      ).join('') + '</div>' +
      chartHost +
      '<div class="cond-var-list">' + levelRows(cat, active, day, state) + '</div>' +
      (cat.note ? '<p class="muted cond-note">⚠ ' + esc(cat.note) + '</p>' : '');
    if (list) list.hidden = true;
    detail.hidden = false;
    drawDetailChart(cat, day, state);
    detail.scrollIntoView({ block: 'start' });
  }

  function drawDetailChart(cat, day, state) {
    const host = document.querySelector('#conditionsDetail [data-chart]');
    if (!host) return;
    const fn = CHARTS[cat.chart];
    if (!fn) return;
    try { fn(host, cat, day, state, palette()); } catch (e) { /* no romper el resto */ }
  }

  function refresh() {
    if (!own.selected) return;
    const cat = CATEGORIES.find(c => c.id === own.selected);
    if (!cat) return;
    const activeTab = document.querySelector('#conditionsDetail [data-cond-tab].active');
    renderDetail(cat, activeTab ? activeTab.dataset.condTab : undefined);
  }

  function showCategory(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    if (!cat) return;
    own.selected = id;
    saveOwn(own);
    if (window.goToPage) window.goToPage('conditions');
    window.setTimeout(() => renderDetail(cat), 60);
  }

  function backToList() {
    own.selected = null;
    saveOwn(own);
    const detail = $('conditionsDetail');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
    const list = $('conditionsList');
    if (list) list.hidden = false;
  }

  function bindUI() {
    const page = $('page-conditions');
    if (page) page.addEventListener('click', ev => {
      const open = ev.target.closest('[data-cond-open]');
      if (open) { showCategory(open.dataset.condOpen); return; }
      if (ev.target.closest('[data-cond-back]')) { backToList(); return; }
      const tab = ev.target.closest('[data-cond-tab]');
      if (tab) {
        const cat = CATEGORIES.find(c => c.id === own.selected);
        if (cat) renderDetail(cat, tab.dataset.condTab);
      }
    });
    const adv = $('advanceBtn');
    if (adv) adv.addEventListener('click', () => window.setTimeout(refresh, 80));
    if (window.MutationObserver && page) {
      new MutationObserver(() => {
        if (page.classList.contains('active')) refresh();
      }).observe(page, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.Conditions = {
    VERSION, categories: CATEGORIES, refresh, showCategory,
    levels: LEVELS,
  };

  renderConditions();
  refresh();
  bindUI();
})();
