(() => {
  'use strict';

  const TOTAL_DAYS = 180;
  const SIGNALS = [
    { key: 'bone', label: 'Densidad ósea', unit: '%', start: 100 },
    { key: 'cardio', label: 'Estado cardiovascular', unit: '%', start: 100 },
    { key: 'immune', label: 'Estado inmunitario', unit: '%', start: 100 },
    { key: 'behavioral', label: 'Bienestar conductual', unit: '%', start: 100 },
    { key: 'radiation', label: 'Radiación acumulada', unit: ' mSv', start: 0 }
  ];
  const PAGE_IDS = ['dashboard', 'overview', 'signos', 'anatomy', 'assistant', 'medications', 'conditions', 'admin'];
  const DEFAULT_CURRENT = Object.fromEntries(SIGNALS.map(item => [item.key, item.start]));
  const $ = id => document.getElementById(id);
  let savedPayload = {};
  let state = loadState();
  let waveStart = null;
  let waveFrame = null;

  function parseStored(raw) {
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function loadState() {
    const stored = parseStored(localStorage.getItem('bytemedicals_state'));
    savedPayload = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const current = { ...DEFAULT_CURRENT, ...(savedPayload.current || {}) };
    const history = {};
    SIGNALS.forEach(({ key, start }) => {
      const entries = savedPayload.history && savedPayload.history[key];
      history[key] = Array.isArray(entries) ? entries.filter(Number.isFinite) : [];
      if (!history[key].length) history[key] = [start];
      if (!Number.isFinite(current[key])) current[key] = history[key][history[key].length - 1];
    });
    return {
      day: Number.isInteger(savedPayload.day) ? Math.min(TOTAL_DAYS, Math.max(0, savedPayload.day)) : 0,
      current, history,
      telemetry: Array.isArray(savedPayload.telemetry) ? savedPayload.telemetry.slice(-24) : [],
      alerts: Array.isArray(savedPayload.alertsHistory) ? savedPayload.alertsHistory.slice(0, 20) : [],
      crewName: typeof savedPayload.crewName === 'string' ? savedPayload.crewName : 'Comandante'
    };
  }

  const statusFor = (key, value) => key === 'radiation'
    ? value >= 500 ? 'crit' : value >= 300 ? 'watch' : 'ok'
    : value < 55 ? 'crit' : value < 78 ? 'watch' : 'ok';
  const severityRank = status => ({ crit: 0, watch: 1, ok: 2 })[status];
  const scoreOf = () => Math.round((state.current.bone + state.current.cardio + state.current.immune + state.current.behavioral) / 4);
  const weakestSignal = () => SIGNALS.map(signal => ({
    ...signal, value: state.current[signal.key], status: statusFor(signal.key, state.current[signal.key])
  })).sort((a, b) => severityRank(a.status) - severityRank(b.status) ||
    (a.key === 'radiation' ? b.value - a.value : a.value - b.value))[0];

  function saveState() {
    savedPayload = {
      ...savedPayload, day: state.day, current: state.current, history: state.history,
      telemetry: state.telemetry, alertsHistory: state.alerts, crewName: state.crewName
    };
    try { localStorage.setItem('bytemedicals_state', JSON.stringify(savedPayload)); }
    catch (error) { showToast('No se pudo guardar la misión en este navegador.'); }
  }

  function goToPage(id) {
    if (!PAGE_IDS.includes(id)) return;
    document.querySelectorAll('.app-shell .page').forEach(page => page.classList.toggle('active', page.id === `page-${id}`));
    document.querySelectorAll('.navbtn').forEach(button => button.classList.toggle('active', button.dataset.page === id));
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    if (id === 'anatomy') {
      window.HumanAnatomy?.refresh();
      window.Anatomy3D?.showSystem(window.HumanAnatomy?.getSelected?.() || 'skeletal');
    }
    if (id === 'medications') window.MedicationsView?.refresh();
  }
  window.goToPage = goToPage;

  function showToast(message) {
    const host = $('toastStack');
    if (!host) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function liveSignos() {
    const c = state.current;
    return {
      hr: Math.round(Math.max(50, Math.min(140, 60 + (100 - c.cardio) * .5 + c.radiation / 60))),
      spo2: Math.round(Math.max(90, Math.min(100, 94 + c.immune / 20))),
      temp: Math.round(Math.max(35.5, Math.min(38.5, 36.5 + (100 - c.behavioral) * .02 + (c.immune < 60 ? .3 : 0))) * 10) / 10
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  const statusLabel = status => status === 'crit' ? 'Crítico' : status === 'watch' ? 'Vigilancia' : 'Nominal';

  function renderMissionStrip() {
    const cells = [
      ['TRIPULANTE', state.crewName], ['ESTADO', state.day ? `Día ${state.day} de ${TOTAL_DAYS}` : 'Sin iniciar'],
      ['SALUD GENERAL', `${scoreOf()} / 100`], ['RADIACIÓN', `${Math.round(state.current.radiation)} mSv`]
    ];
    $('missionStrip').innerHTML = cells.map(([label, value]) =>
      `<div class="strip-cell"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }

  function renderSignals() {
    $('dashboardSignos').innerHTML = SIGNALS.map(signal => {
      const value = state.current[signal.key];
      const status = statusFor(signal.key, value);
      return `<article class="signal-card ${status}"><span>${signal.label}</span><strong>${Math.round(value)}${signal.unit}</strong><small>${statusLabel(status)}</small></article>`;
    }).join('');
    const weakest = weakestSignal();
    $('focusText').textContent = weakest.status === 'ok'
      ? 'Los indicadores de la simulación están dentro de los rangos de referencia.'
      : `${weakest.label} requiere atención en esta simulación (${statusLabel(weakest.status).toLowerCase()}).`;
  }

  function renderAlerts() {
    $('alertsFeed').innerHTML = state.alerts.length
      ? state.alerts.slice(0, 8).map(alert => `<li class="alert-item ${escapeHtml(alert.sev || 'watch')}"><span>DÍA ${alert.day}</span>${escapeHtml(alert.text)}</li>`).join('')
      : '<li class="empty-state">Todavía no hay alertas.</li>';
  }

  function renderOverview() {
    const score = scoreOf();
    $('overviewScore').textContent = score;
    $('overviewDay').textContent = `${state.day} / ${TOTAL_DAYS}`;
    $('overviewRad').textContent = `${Math.max(0, Math.round(600 - state.current.radiation))} mSv`;
    const systems = SIGNALS.filter(item => item.key !== 'radiation').sort((a, b) => state.current[a.key] - state.current[b.key]);
    $('overviewLowest').textContent = `${systems[0].label} ${Math.round(state.current[systems[0].key])}%`;
    $('overviewPhase').textContent = state.day >= 150 ? 'PREPARACIÓN DE REGRESO' : state.day >= 90 ? 'MISIÓN AVANZADA' : state.day >= 30 ? 'CRUCERO' : state.day ? 'ADAPTACIÓN' : 'FASE DE LANZAMIENTO';
    const progress = Math.round(state.day / TOTAL_DAYS * 100);
    $('progressPct').textContent = `${progress}%`;
    $('progressBar').style.width = `${progress}%`;
    $('progressLabel').textContent = `Día ${state.day} de ${TOTAL_DAYS}`;
    $('missionTimeline').innerHTML = [15, 30, 60, 90, 120, 150, 180].map(day =>
      `<div class="timeline-item ${state.day >= day ? 'complete' : ''}"><span>DÍA ${day}</span><strong>${day === 90 ? 'Punto medio' : day === 180 ? 'Fin de misión' : state.day >= day ? 'Hito completado' : 'Hito de misión'}</strong></div>`).join('');
    drawOverviewRing();
  }

  function drawOverviewRing() {
    const canvas = $('overviewRing');
    const ctx = canvas.getContext('2d');
    const score = scoreOf();
    ctx.clearRect(0, 0, 160, 160);
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(130,160,180,.2)';
    ctx.beginPath(); ctx.arc(80, 80, 62, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = score < 55 ? '#ff6874' : score < 78 ? '#f5c45e' : '#54d7a0';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(80, 80, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); ctx.stroke();
  }

  function renderSignos() {
    const v = liveSignos();
    $('liveHr').textContent = `${v.hr} bpm`;
    $('liveSpo2').textContent = `${v.spo2}%`;
    $('liveTemp').textContent = `${v.temp.toFixed(1)} °C`;
    [['liveHrState', v.hr >= 105], ['liveSpo2State', v.spo2 < 94], ['liveTempState', v.temp >= 37.6]].forEach(([id, warn]) => {
      $(id).textContent = warn ? 'VIGILAR' : 'NOMINAL';
      $(id).className = warn ? 'watch' : '';
    });
    const warning = v.hr >= 105 || v.spo2 < 94 || v.temp >= 37.6;
    $('liveSignal').textContent = warning ? 'REVISAR SEÑAL' : 'SEÑAL NOMINAL';
    $('liveSignal').className = `status-pill ${warning ? 'watch' : ''}`;
    $('profileO2').textContent = `${v.spo2}%`;
    $('profileTemp').textContent = `${v.temp.toFixed(1)} °C`;
    $('gaugeVal').textContent = `${Math.round(state.current.radiation)} mSv`;
    $('doseState').textContent = `${Math.max(0, Math.round(600 - state.current.radiation))} mSv de margen al límite de referencia`;
    drawGauge();
    $('telemetryBody').innerHTML = state.telemetry.slice().reverse().map(frame =>
      `<tr><td>${frame.day}</td><td>${frame.hr}</td><td>${frame.spo2}</td><td>${frame.temp.toFixed(1)}</td><td>${frame.rad}</td></tr>`
    ).join('') || '<tr><td colspan="5" class="empty-state">Avanza un día para generar telemetría simulada.</td></tr>';
  }

  function drawGauge() {
    const canvas = $('gaugeCanvas');
    const ctx = canvas.getContext('2d');
    const progress = Math.min(1, state.current.radiation / 600);
    ctx.clearRect(0, 0, 160, 100);
    ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(130,160,180,.2)';
    ctx.beginPath(); ctx.arc(80, 82, 56, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = progress >= .83 ? '#ff6874' : progress >= .5 ? '#f5c45e' : '#54d7a0';
    ctx.beginPath(); ctx.arc(80, 82, 56, Math.PI, Math.PI * (1 - progress)); ctx.stroke();
  }

  function renderStatus() {
    const worst = weakestSignal();
    $('statusPill').textContent = statusLabel(worst.status).toUpperCase();
    $('statusPill').className = `status-pill ${worst.status}`;
    $('headerDay').textContent = state.day;
    $('metClock').textContent = `${String(state.day).padStart(3, '0')}:00:00:00`;
    $('utcClock').textContent = `UTC ${new Date().toISOString().slice(11, 19)}`;
    $('profileName').textContent = state.crewName;
    $('aiDayStat').textContent = `${state.day} / ${TOTAL_DAYS}`;
    $('aiPriorityStat').textContent = worst.status === 'ok' ? 'Nominal' : worst.label;
    $('aiRadStat').textContent = `${Math.round(state.current.radiation)} mSv`;
  }

  function render() {
    renderMissionStrip(); renderSignals(); renderAlerts(); renderOverview(); renderSignos(); renderStatus();
    $('advanceBtn').disabled = state.day >= TOTAL_DAYS;
    $('crewName').value = state.crewName;
  }

  function advanceDay() {
    if (state.day >= TOTAL_DAYS) return;
    const before = { ...state.current };
    state.day += 1;
    state.current.bone = Math.max(40, state.current.bone - .12 - state.day / 4000);
    state.current.cardio = Math.max(40, state.current.cardio - .07);
    state.current.immune = Math.max(30, state.current.immune - (state.day % 17 === 0 ? .35 : .03));
    state.current.behavioral = Math.max(30, state.current.behavioral - (state.day % 24 === 0 ? .25 : .02));
    state.current.radiation = Math.min(650, state.current.radiation + .55 * (1 + state.day / 720));
    SIGNALS.forEach(({ key }) => state.history[key].push(state.current[key]));
    const v = liveSignos();
    state.telemetry.push({ day: state.day, hr: v.hr, spo2: v.spo2, temp: v.temp, rad: Math.round(state.current.radiation) });
    state.telemetry = state.telemetry.slice(-24);
    SIGNALS.forEach(({ key, label }) => {
      const prev = statusFor(key, before[key]);
      const next = statusFor(key, state.current[key]);
      if (next !== 'ok' && next !== prev) state.alerts.unshift({ day: state.day, sev: next, text: `${label}: el indicador pasó a estado ${statusLabel(next).toLowerCase()}.` });
    });
    state.alerts = state.alerts.slice(0, 20);
    saveState(); render();
    if (state.day === TOTAL_DAYS) showToast('La simulación llegó al final de la misión.');
  }

  // Señal ECG sintética a 60 bpm: cada latido es la suma de gaussianas P, Q, R, S y T
  const ECG_BPM = 60;
  const ECG_PX_PER_SEC = 150;
  const ECG_WAVES = [
    { mu: 0.20, sigma: 0.025, amp: 0.15 },   // P
    { mu: 0.37, sigma: 0.010, amp: -0.15 },  // Q
    { mu: 0.40, sigma: 0.012, amp: 1.00 },   // R
    { mu: 0.43, sigma: 0.010, amp: -0.25 },  // S
    { mu: 0.65, sigma: 0.045, amp: 0.30 }    // T
  ];

  function ecgSample(t) {
    const phase = t % (60 / ECG_BPM);
    return ECG_WAVES.reduce((sum, w) => sum + w.amp * Math.exp(-((phase - w.mu) ** 2) / (2 * w.sigma ** 2)), 0);
  }

  // Ruido determinista (no parpadea al desplazarse la señal)
  function ecgNoise(i) {
    const r = Math.sin(i * 12.9898) * 43758.5453;
    return (r - Math.floor(r) - .5) * .03;
  }

  function drawWave() {
    const canvas = $('waveCanvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(6,17,28,.8)'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(79,211,232,.12)'; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const now = performance.now();
    if (waveStart === null) waveStart = now;
    const scroll = (now - waveStart) / 1000 * ECG_PX_PER_SEC;
    const baseline = height * .68, pxPerMv = height * .5;
    ctx.beginPath(); ctx.strokeStyle = '#54d7a0'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let x = 0; x <= width; x += .5) {
      const px = x + scroll;
      const mv = ecgSample(px / ECG_PX_PER_SEC) + ecgNoise(Math.floor(px));
      const y = baseline - mv * pxPerMv;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); waveFrame = requestAnimationFrame(drawWave);
  }

  /* Chat con PRAG (Paso 3): la respuesta ya no es local por reglas;
   * viene del backend (/api/prag/query), que llama a PRAG con la
   * clave del servidor y devuelve la respuesta con sus fuentes. */
  function setChatBusy(busy) {
    $('chatInput').disabled = busy;
    $('chatSendBtn').disabled = busy;
  }

  function appendSources(sources) {
    if (!Array.isArray(sources) || !sources.length) return;
    const list = document.createElement('p');
    list.className = 'assistant-message chat-sources';
    list.textContent = 'Fuentes: ';
    sources.forEach((source, index) => {
      if (index) list.appendChild(document.createTextNode(', '));
      const link = document.createElement('a');
      link.href = source.file_url || '#';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = source.filename || 'Documento';
      list.appendChild(link);
    });
    $('chatLog').appendChild(list);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }

  /* Conversaciones (Paso 4): cada usuario tiene las suyas, guardadas
   * en MySQL y aisladas por usuario. PRAG recibe los últimos turnos
   * como contexto de la respuesta, nunca para la búsqueda. */
  let currentConversationId = null;

  function renderChatMessage(role, text, sources) {
    appendChat(role, text);
    if (role === 'assistant') appendSources(sources);
  }

  function newConversation() {
    currentConversationId = null;
    $('chatLog').innerHTML = '<p class="assistant-message">Hola. Pregúntame sobre tus documentos y te responderé citando las fuentes.</p>';
    document.querySelectorAll('.chat-conv-item').forEach(item => item.classList.remove('active'));
  }

  async function loadConversations() {
    const list = $('chatConvList');
    if (!list) return;
    let conversations = [];
    try {
      conversations = await window.ByteMedicalsAuth.apiCall('/api/conversations');
    } catch (err) { return; }
    list.innerHTML = '';
    conversations.forEach(conversation => {
      const item = document.createElement('span');
      item.className = 'chat-conv-item' + (conversation.id === currentConversationId ? ' active' : '');
      const open = document.createElement('button');
      open.className = 'text-btn'; open.type = 'button';
      open.textContent = conversation.title || 'Conversación';
      open.addEventListener('click', () => loadConversation(conversation.id));
      const remove = document.createElement('button');
      remove.className = 'text-btn'; remove.type = 'button';
      remove.textContent = '×'; remove.setAttribute('aria-label', 'Borrar conversación');
      remove.addEventListener('click', async event => {
        event.stopPropagation();
        try { await window.ByteMedicalsAuth.apiCall('/api/conversations/' + conversation.id, { method: 'DELETE' }); } catch (err) { return; }
        if (conversation.id === currentConversationId) newConversation();
        loadConversations();
      });
      item.appendChild(open); item.appendChild(remove);
      list.appendChild(item);
    });
  }

  async function loadConversation(id) {
    let data;
    try {
      data = await window.ByteMedicalsAuth.apiCall('/api/conversations/' + id);
    } catch (err) { return; }
    currentConversationId = id;
    $('chatLog').innerHTML = '';
    (data.messages || []).forEach(message => renderChatMessage(message.role, message.content, message.sources));
    if (!(data.messages || []).length) {
      $('chatLog').innerHTML = '<p class="assistant-message">Hola. Pregúntame sobre tus documentos y te responderé citando las fuentes.</p>';
    }
    loadConversations();
  }

  async function askPrag(question) {
    const thinking = appendChat('assistant', 'PRAG está pensando…');
    setChatBusy(true);
    try {
      if (currentConversationId === null) {
        const created = await window.ByteMedicalsAuth.apiCall('/api/conversations', {
          method: 'POST',
          body: JSON.stringify({ title: question.slice(0, 40) }),
        });
        currentConversationId = created.id;
      }
      const frame = state.telemetry && state.telemetry.length
        ? state.telemetry[state.telemetry.length - 1] : null;
      const missionContext = {
        day: state.day,
        hr: frame ? frame.hr : null,
        spo2: frame ? frame.spo2 : null,
        temp: frame ? frame.temp : null,
        rad: state.current ? state.current.radiation : null,
      };
      const data = await window.ByteMedicalsAuth.apiCall('/api/prag/query', {
        method: 'POST',
        body: JSON.stringify({ query: question, conversation_id: currentConversationId, context: missionContext }),
      });
      thinking.textContent = data.answer || 'PRAG no devolvió respuesta.';
      appendSources(data.sources);
      loadConversations();
    } catch (err) {
      thinking.textContent = '⚠ ' + (err.message || 'No pude contactar con PRAG.');
    } finally {
      setChatBusy(false);
    }
  }

  async function updateFilesLine() {
    const line = $('pragFilesLine');
    if (!line) return;
    try {
      const data = await window.ByteMedicalsAuth.apiCall('/api/prag/files');
      line.textContent = data.total === 0
        ? 'PRAG no tiene documentos indexados todavía.'
        : 'PRAG puede consultar ' + data.total + ' documento(s) de tu Drive.';
    } catch (err) {
      line.textContent = 'No se pudo consultar los documentos de PRAG.';
    }
  }

  function appendChat(role, text) {
    const message = document.createElement('p');
    message.className = `${role}-message`;
    message.textContent = text;
    $('chatLog').appendChild(message);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return message;
  }

  function exportTelemetry() {
    const rows = [['Día', 'FC', 'SpO2', 'Temperatura', 'Radiación_mSv']].concat(
      state.telemetry.map(frame => [frame.day, frame.hr, frame.spo2, frame.temp, frame.rad]));
    const url = URL.createObjectURL(new Blob([rows.map(row => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'bytemedicals-telemetria.csv'; link.click(); URL.revokeObjectURL(url);
  }

  document.querySelectorAll('.navbtn').forEach(button => button.addEventListener('click', () => goToPage(button.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => goToPage(button.dataset.goto)));
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); goToPage('dashboard'); });
  $('advanceBtn').addEventListener('click', advanceDay);
  $('crewName').addEventListener('input', event => {
    state.crewName = event.target.value.trim() || 'Comandante';
    $('profileName').textContent = state.crewName; renderMissionStrip(); saveState();
  });
  $('exportBtn').addEventListener('click', exportTelemetry);
  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('¿Reiniciar los datos simulados de la misión?')) return;
    state = { day: 0, current: { ...DEFAULT_CURRENT }, history: Object.fromEntries(SIGNALS.map(({ key, start }) => [key, [start]])), telemetry: [], alerts: [], crewName: 'Comandante' };
    saveState(); render(); showToast('Misión reiniciada.');
  });
  $('themeBtn').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('bytemedicals_theme', theme); } catch (error) { showToast('No se pudo guardar el tema.'); }
  });
  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('chatInput');
    const question = input.value.trim();
    if (!question) return;
    appendChat('user', question);
    input.value = '';
    askPrag(question);
  });
  $('clearChatBtn').addEventListener('click', newConversation);
  $('newChatBtn').addEventListener('click', newConversation);
  document.querySelectorAll('[data-q]').forEach(button => button.addEventListener('click', () => {
    $('chatInput').value = button.dataset.q; $('chatForm').requestSubmit();
  }));
  window.addEventListener('beforeunload', () => { if (waveFrame !== null) cancelAnimationFrame(waveFrame); });
  const savedTheme = localStorage.getItem('bytemedicals_theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
  window.addEventListener('bytemedicals:authed', () => { updateFilesLine(); loadConversations(); });
  updateFilesLine();
  loadConversations();
  render();
  const requested = location.hash.slice(1);
  goToPage(PAGE_IDS.includes(requested) ? requested : 'dashboard');
  drawWave();
  setInterval(() => { $('utcClock').textContent = `UTC ${new Date().toISOString().slice(11, 19)}`; }, 1000);
})();
