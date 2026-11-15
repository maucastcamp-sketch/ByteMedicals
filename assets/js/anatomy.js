(() => {
  'use strict';

  const systems = [
    { id: 'cardiovascular', name: 'Cardiovascular', short: 'CV', color: '#f37b82', title: 'Sistema cardiovascular', description: 'El corazón y los vasos sanguíneos transportan oxígeno y nutrientes. En microgravedad, los fluidos corporales se redistribuyen y el sistema se adapta.', signals: ['cardio', 'heart'] },
    { id: 'musculoskeletal', name: 'Musculoesquelético', short: 'ME', color: '#62c7e4', title: 'Sistema musculoesquelético', description: 'Músculos, huesos y articulaciones proporcionan soporte y permiten el movimiento. La menor carga mecánica puede afectar la fuerza y la densidad ósea.', signals: ['bone'] },
    { id: 'immune', name: 'Inmunitario', short: 'IN', color: '#9b8cff', title: 'Sistema inmunitario', description: 'Una red de células y órganos protege al organismo y coordina las respuestas inmunitarias. El entorno de misión puede modificar algunos aspectos de su actividad.', signals: ['immune', 'temperature'] },
    { id: 'respiratory', name: 'Respiratorio', short: 'RE', color: '#4ad99b', title: 'Sistema respiratorio', description: 'Las vías respiratorias y los pulmones realizan el intercambio de oxígeno y dióxido de carbono.', signals: ['oxygen'] },
    { id: 'nervous', name: 'Nervioso', short: 'NE', color: '#f2c14e', title: 'Sistema nervioso', description: 'El cerebro, la médula espinal y los nervios procesan información y coordinan funciones corporales. El sueño, el equilibrio y el bienestar forman parte de la adaptación.', signals: ['behavioral'] },
    { id: 'skeletal', name: 'Óseo', short: 'OS', color: '#edaa6a', title: 'Sistema óseo', description: 'El esqueleto protege órganos, da soporte y almacena minerales. La carga reducida puede influir en el remodelado óseo en vuelos prolongados.', signals: ['bone'] }
  ];
  const validIds = new Set(systems.map(system => system.id));
  const figurePoints = { cardiovascular: [50, 37], musculoskeletal: [50, 55], immune: [50, 46], respiratory: [50, 35], nervous: [50, 19], skeletal: [50, 67] };
  let selected = readSelected();

  function readSelected() {
    try {
      const saved = JSON.parse(localStorage.getItem('bytemedicals_anatomy') || '{}');
      return saved && validIds.has(saved.selected) ? saved.selected : 'skeletal';
    } catch (error) {
      return 'skeletal';
    }
  }
  function readMissionState() {
    try { return JSON.parse(localStorage.getItem('bytemedicals_state') || '{}') || {}; }
    catch (error) { return {}; }
  }
  function signalsFor(system) {
    const state = readMissionState();
    const current = state.current || {};
    const frame = Array.isArray(state.telemetry) ? state.telemetry[state.telemetry.length - 1] || {} : {};
    const data = {
      cardio: ['Estado cardiovascular', `${Math.round(current.cardio ?? 100)} / 100`],
      bone: ['Densidad ósea simulada', `${Math.round(current.bone ?? 100)}%`],
      immune: ['Estado inmunitario', `${Math.round(current.immune ?? 100)} / 100`],
      behavioral: ['Bienestar conductual', `${Math.round(current.behavioral ?? 100)} / 100`],
      heart: ['Frecuencia cardíaca simulada', `${frame.hr ?? 60} bpm`],
      oxygen: ['Saturación de oxígeno simulada', `${frame.spo2 ?? 99}%`],
      temperature: ['Temperatura simulada', `${frame.temp ?? 36.5} °C`]
    };
    return system.signals.map(key => data[key]);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function renderFigure(figure) {
    figure.innerHTML = `<svg class="body-diagram" viewBox="0 0 100 100" role="img" aria-label="Diagrama esquemático del cuerpo humano">
      <circle class="body-head" cx="50" cy="15" r="8"></circle>
      <path class="body-shape" d="M43 25 Q50 22 57 25 L63 48 L58 52 L60 72 L54 72 L50 54 L46 72 L40 72 L42 52 L37 48 Z"></path>
      <path class="body-limb" d="M39 29 L27 48 L31 51 L43 38 M61 29 L73 48 L69 51 L57 38 M43 70 L36 91 L41 93 L50 75 M57 70 L64 91 L59 93 L50 75"></path>
      ${systems.map(system => {
        const [x, y] = figurePoints[system.id];
        return `<g class="an-marker ${system.id} ${system.id === selected ? 'selected' : ''}" transform="translate(${x} ${y})" data-system="${system.id}" tabindex="0" role="button" aria-label="${system.title}"><circle r="5"></circle><text y=".3">${system.short}</text></g>`;
      }).join('')}
    </svg>`;
    figure.querySelectorAll('.an-marker').forEach(marker => {
      marker.addEventListener('click', () => select(marker.dataset.system));
      marker.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(marker.dataset.system); }
      });
    });
  }
  function render() {
    const figure = document.getElementById('anFigure');
    const host = document.getElementById('anSystems');
    const detail = document.getElementById('anDetail');
    if (!figure || !host || !detail) return;
    if (!figure.hasAttribute('data-an3d')) renderFigure(figure);
    host.innerHTML = systems.map(system =>
      `<button type="button" class="an-sys-btn ${system.id === selected ? 'an-active' : ''}" data-system="${system.id}"><span class="system-dot" style="--system-color:${system.color}">${system.short}</span>${system.name}</button>`
    ).join('');
    host.querySelectorAll('.an-sys-btn').forEach(button => button.addEventListener('click', () => select(button.dataset.system)));
    const system = systems.find(item => item.id === selected) || systems[0];
    detail.innerHTML = `<p class="eyebrow">SISTEMA HUMANO</p><h3>${system.title}</h3><p>${system.description}</p><h4>Indicadores de la simulación</h4>
      <dl class="an-indicators">${signalsFor(system).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      <p class="muted">Valores de entrenamiento únicamente; no son mediciones clínicas ni diagnósticos.</p>`;
  }
  function select(id) {
    if (!validIds.has(id)) return;
    selected = id;
    try { localStorage.setItem('bytemedicals_anatomy', JSON.stringify({ selected })); }
    catch (error) { console.warn('Could not save the selected anatomy system.', error); }
    render();
    window.Anatomy3D?.showSystem(id);
  }
  function showSchematic() {
    const figure = document.getElementById('anFigure');
    if (!figure) return;
    figure.removeAttribute('data-an3d');
    figure.classList.remove('an3d');
    renderFigure(figure);
  }
  window.HumanAnatomy = { refresh: render, select, showSchematic, getSelected: () => selected };
  render();
})();
