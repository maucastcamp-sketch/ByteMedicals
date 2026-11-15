// Signos vitales — 7 signos, cada uno con su propia gráfica.
// Módulo original de ByteMedicals (v1.0.0-original).
//
// Los 7 signos vitales: presión arterial, frecuencia cardíaca,
// frecuencia respiratoria, temperatura corporal, saturación de
// oxígeno (SpO2), nivel de dolor y peso corporal. Cada tarjeta
// tiene su valor actual, su referencia y UNA gráfica distinta
// (ninguna repite el estilo de otra).
//
// La frecuencia cardíaca usa el canvas #waveCanvas, que sigue
// animando assets/js/bytemedicals.js (drawWave). Este módulo
// dibuja las otras 6 gráficas y actualiza los 4 valores nuevos
// (PA, FR, dolor, peso). Los valores de FC, SpO2 y temperatura
// los sigue escribiendo bytemedicals.js (renderSignos).
//
// Datos: telemetría simulada determinista (día de misión como
// semilla) + valores en vivo del estado de la app cuando existen.
// La presión arterial, la frecuencia respiratoria, el dolor y el
// peso son valores simulados; se etiquetan como tales en la página
// (TELEMETRÍA SIMULADA). No son mediciones clínicas ni umbrales
// diagnósticos: las referencias son rangos generales de formación.

(function () {
  'use strict';

  var VERSION = '1.0.0-original';

  var DAY_SPAN = 30;

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  // Valor determinista a partir del día de misión (sin aleatoriedad:
  // el mismo día siempre da el mismo valor).
  function vary(seed, day, amp) {
    var s = Math.sin(seed * 12.9898 + day * 78.233) * 43758.5453;
    return (s - Math.floor(s) - 0.5) * 2 * amp;
  }

  function readState() {
    try {
      var raw = localStorage.getItem('bytemedicals_state');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function missionDay() {
    var st = readState();
    return st && typeof st.day === 'number' ? st.day : 1;
  }

  function lastFrame() {
    var st = readState();
    if (!st) return null;
    if (st.current) return st.current;
    if (st.telemetry && st.telemetry.length) return st.telemetry[st.telemetry.length - 1];
    return null;
  }

  // ---- Valores de los 4 signos nuevos (simulados) ----

  function bpValues(day) {
    return {
      sys: Math.round(118 + vary(101, day, 6)),
      dia: Math.round(76 + vary(102, day, 4)),
    };
  }

  function rrValue(day) {
    return Math.round(15 + vary(103, day, 2));
  }

  function painValue(day) {
    return clamp(Math.round(vary(104, day, 0.8)), 0, 10);
  }

  function weightValue(day) {
    // Pérdida lenta y leve en microgravedad (~1,5 kg en 180 días).
    return 74 - day * 0.008 + vary(105, day, 0.3);
  }

  function series(fn, day) {
    var out = [];
    var start = Math.max(1, day - DAY_SPAN + 1);
    for (var d = start; d <= day; d++) out.push({ day: d, value: fn(d) });
    return out;
  }

  // ---- Dibujo común ----

  function setup(canvas) {
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  function axes(ctx, w, h, pad) {
    ctx.strokeStyle = cssVar('--grid', 'rgba(130,160,180,.14)');
    ctx.lineWidth = 1;
    for (var i = 1; i < 5; i++) {
      var y = pad + (h - 2 * pad) * i / 5;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
  }

  function line(ctx, pts, w, h, pad, min, max, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = pad + (w - 2 * pad) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
      var y = h - pad - ((p - min) / (max - min)) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ---- Las 6 gráficas nuevas (cada una con su estilo) ----

  // 1. Presión arterial: dos líneas (sistólica / diastólica) con
  // banda de referencia de la sistólica (90–120 mmHg).
  function drawBp(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height, pad = 12;
    axes(ctx, w, h, pad);
    var sys = series(function (d) { return bpValues(d).sys; }, day);
    var dia = series(function (d) { return bpValues(d).dia; }, day);
    var min = 60, max = 140;
    ctx.fillStyle = cssVar('--accent', '#54d7a0');
    ctx.globalAlpha = 0.08;
    var yTop = h - pad - ((120 - min) / (max - min)) * (h - 2 * pad);
    var yBot = h - pad - ((90 - min) / (max - min)) * (h - 2 * pad);
    ctx.fillRect(pad, yTop, w - 2 * pad, yBot - yTop);
    ctx.globalAlpha = 1;
    line(ctx, dia.map(function (p) { return p.value; }), w, h, pad, min, max, cssVar('--amber', '#f5c45e'), 2);
    line(ctx, sys.map(function (p) { return p.value; }), w, h, pad, min, max, cssVar('--accent', '#54d7a0'), 2.5);
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('— sistólica', pad, 16);
    ctx.fillStyle = cssVar('--amber', '#f5c45e');
    ctx.fillText('— diastólica', pad + 80, 16);
  }

  // 2. Frecuencia respiratoria: onda respiratoria suave (una
  // respiración por ciclo; la frecuencia es la del valor actual).
  function drawRr(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var rr = rrValue(day);
    var breaths = Math.max(2, Math.round(rr * 10 / 60));
    ctx.strokeStyle = cssVar('--accent-2', '#7fb3ff');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (var x = 0; x <= w; x += 2) {
      var t = (x / w) * breaths * Math.PI * 2;
      var y = h / 2 - Math.sin(t) * (h / 2 - 22);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(rr + ' respiraciones en 10 s (simulado)', 12, 16);
  }

  // 3. Temperatura corporal: termómetro horizontal con bulbo,
  // banda normal 36.5–37.3 °C y marcador del valor actual.
  function drawTemp(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var frame = lastFrame();
    var temp = frame && typeof frame.temp === 'number'
      ? frame.temp : 36.5 + vary(106, day, 0.3);
    var min = 35, max = 39;
    var x0 = 46, x1 = w - 20;
    var y = h / 2;
    var toX = function (t) { return x0 + ((t - min) / (max - min)) * (x1 - x0); };
    ctx.fillStyle = cssVar('--accent', '#54d7a0');
    ctx.globalAlpha = 0.15;
    ctx.fillRect(toX(36.5), y - 9, toX(37.3) - toX(36.5), 18);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--muted', '#8fa3b3');
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x0 - 12, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = cssVar('--danger', '#ff6874');
    ctx.beginPath(); ctx.arc(x0 - 12, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x0, y - 4, Math.max(2, toX(temp) - x0), 8);
    ctx.beginPath(); ctx.arc(toX(temp), y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('35 °C', x0, y + 30);
    ctx.fillText('36.5–37.3 °C normal', toX(36.5) - 20, y - 22);
    ctx.fillText('39 °C', x1 - 30, y + 30);
  }

  // 4. SpO2: anillo (donut) con el porcentaje en el centro.
  function drawSpo2(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var frame = lastFrame();
    var spo2 = frame && typeof frame.spo2 === 'number'
      ? frame.spo2 : 99 + Math.round(vary(107, day, 1));
    var cx = 90, cy = h / 2, r = 52;
    var color = spo2 >= 95 ? cssVar('--accent', '#54d7a0')
      : spo2 >= 90 ? cssVar('--amber', '#f5c45e') : cssVar('--danger', '#ff6874');
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.strokeStyle = cssVar('--grid', 'rgba(130,160,180,.18)');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (spo2 / 100)); ctx.stroke();
    ctx.fillStyle = cssVar('--text', '#e8f0f5');
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spo2 + '%', cx, cy + 9);
    ctx.textAlign = 'left';
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Oxígeno transportado', 170, cy - 14);
    ctx.fillText('en sangre (simulado)', 170, cy + 6);
    ctx.fillText('Referencia: > 94–95 %', 170, cy + 26);
  }

  // 5. Nivel de dolor: escala segmentada de 0 a 10.
  function drawPain(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height;
    var pain = painValue(day);
    var pad = 12, gap = 6;
    var segW = (w - 2 * pad - 9 * gap) / 10;
    var y = h / 2 - 14, segH = 28;
    for (var i = 0; i < 10; i++) {
      var filled = i < pain;
      var color = i < 4 ? cssVar('--accent', '#54d7a0')
        : i < 7 ? cssVar('--amber', '#f5c45e') : cssVar('--danger', '#ff6874');
      ctx.fillStyle = filled ? color : cssVar('--grid', 'rgba(130,160,180,.18)');
      var x = pad + i * (segW + gap);
      ctx.beginPath();
      ctx.roundRect(x, y, segW, segH, 4);
      ctx.fill();
    }
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('0', pad, y + segH + 18);
    ctx.fillText('10', w - pad - 14, y + segH + 18);
    ctx.fillText(pain === 0 ? 'sin dolor' : pain <= 3 ? 'leve' : pain <= 6 ? 'moderado' : 'intenso', pad, y - 10);
  }

  // 6. Peso corporal: área de tendencia con línea de referencia
  // del peso inicial (74 kg).
  function drawWeight(canvas, day) {
    var ctx = setup(canvas); if (!ctx) return;
    var w = canvas.width, h = canvas.height, pad = 12;
    var pts = series(weightValue, day);
    var vals = pts.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals.concat([74])) - 0.4;
    var max = Math.max.apply(null, vals.concat([74])) + 0.4;
    axes(ctx, w, h, pad);
    var color = cssVar('--accent-2', '#7fb3ff');
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = pad + (w - 2 * pad) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
      var y = h - pad - ((p.value - min) / (max - min)) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, h - pad); else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + (w - 2 * pad), h - pad);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    line(ctx, vals, w, h, pad, min, max, color, 2.5);
    var yRef = h - pad - ((74 - min) / (max - min)) * (h - 2 * pad);
    ctx.strokeStyle = cssVar('--muted', '#8fa3b3');
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(pad, yRef); ctx.lineTo(w - pad, yRef); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssVar('--muted', '#8fa3b3');
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('— peso inicial 74 kg', pad, 16);
  }

  // ---- Actualización de valores y estados ----

  function setState(id, text, kind) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = kind === 'watch' ? 'watch' : kind === 'crit' ? 'crit' : '';
  }

  function refresh() {
    var day = missionDay();

    var bp = bpValues(day);
    var el = $('liveBp');
    if (el) el.textContent = bp.sys + '/' + bp.dia + ' mmHg';
    setState('liveBpState',
      (bp.sys >= 140 || bp.dia >= 90 || bp.sys < 90 || bp.dia < 60) ? 'VIGILAR' : 'NOMINAL',
      (bp.sys >= 140 || bp.dia >= 90 || bp.sys < 90 || bp.dia < 60) ? 'watch' : '');
    drawBp($('bpChart'), day);

    var rr = rrValue(day);
    el = $('liveRr');
    if (el) el.textContent = rr + ' rpm';
    setState('liveRrState', (rr < 10 || rr > 24) ? 'VIGILAR' : 'NOMINAL',
      (rr < 10 || rr > 24) ? 'watch' : '');
    drawRr($('rrChart'), day);

    drawTemp($('tempChart'), day);
    drawSpo2($('spo2Chart'), day);

    var pain = painValue(day);
    el = $('livePain');
    if (el) el.textContent = pain + ' / 10';
    setState('livePainState',
      pain === 0 ? 'SIN DOLOR' : pain <= 3 ? 'LEVE' : pain <= 6 ? 'MODERADO' : 'INTENSO',
      pain <= 3 ? '' : pain <= 6 ? 'watch' : 'crit');
    drawPain($('painChart'), day);

    var weight = weightValue(day);
    el = $('liveWeight');
    if (el) el.textContent = weight.toFixed(1) + ' kg';
    setState('liveWeightState',
      Math.abs(weight - 74) > 2 ? 'VIGILAR' : 'ESTABLE',
      Math.abs(weight - 74) > 2 ? 'watch' : '');
    drawWeight($('weightChart'), day);
  }

  function init() {
    refresh();
    var adv = $('advanceBtn');
    if (adv) adv.addEventListener('click', function () {
      setTimeout(refresh, 80);
    });
    var page = $('page-signos');
    if (page && 'MutationObserver' in window) {
      new MutationObserver(function () {
        if (page.classList.contains('active')) refresh();
      }).observe(page, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SignosVitales = {
    VERSION: VERSION,
    refresh: refresh,
    values: function (day) {
      return {
        bp: bpValues(day),
        rr: rrValue(day),
        pain: painValue(day),
        weight: weightValue(day),
      };
    },
  };
})();
