(() => {
  'use strict';

  const STORAGE_KEY = 'bytemedicals_medications';
  const $ = id => document.getElementById(id);
  let data = loadData();

  function parseJson(raw) {
    try { return JSON.parse(raw); } catch (error) { return null; }
  }
  function normalize(value) {
    return {
      medications: value.medications.filter(med => med && typeof med.name === 'string').map((med, index) => ({
        id: String(med.id || `med-${index}`), name: med.name, dose: String(med.dose || ''),
        notes: String(med.notes || ''), times: Array.isArray(med.times) ? med.times.map(String) : [],
        active: med.active !== false
      })),
      intakes: Array.isArray(value.intakes) ? value.intakes.filter(item => item && typeof item.medId === 'string' &&
        Number.isFinite(item.day) && (item.status === 'taken' || item.status === 'missed')).map(item => ({
        medId: item.medId, day: item.day, scheduledTime: String(item.scheduledTime || ''), status: item.status
      })) : []
    };
  }
  function loadData() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.medications)) return normalize(stored);
    const old = parseJson(localStorage.getItem('bytemedicals_healthlog'));
    if (old && Array.isArray(old.medications)) return normalize(old);
    return { medications: [], intakes: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (error) { showMessage('No se pudieron guardar los medicamentos en este navegador.'); }
  }
  function showMessage(message) {
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.textContent = message;
    $('toastStack').appendChild(toast); setTimeout(() => toast.remove(), 3500);
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function currentDay() {
    const mission = parseJson(localStorage.getItem('bytemedicals_state'));
    return mission && Number.isInteger(mission.day) ? mission.day : 0;
  }
  const DATABASE_CATALOG = [
    { name: 'Ibuprofeno 200 mg', dose: '200 mg', times: ['08:00', '20:00'], category: 'Analgesicos y antipireticos', notes: 'Blister sellado, sin polvo libre en microgravedad.' },
    { name: 'Paracetamol 500 mg', dose: '500 mg', times: ['07:00', '19:00'], category: 'Analgesicos y antipireticos', notes: 'Antipirético de uso general con empaque en blister.' },
    { name: 'Amoxicilina 500 mg', dose: '500 mg', times: ['08:00', '20:00'], category: 'Antibioticos', notes: 'Antibiótico de amplio espectro del botiquín; requiere protocolo.' },
    { name: 'Ondansetron 4 mg', dose: '4 mg', times: ['09:00'], category: 'Antiemeticos y mareo espacial', notes: 'Empaque sellado para náuseas y adaptación espacial.' },
    { name: 'Meclizina 25 mg', dose: '25 mg', times: ['08:30'], category: 'Antiemeticos y mareo espacial', notes: 'Mareo espacial y vértigo con pauta controlada.' },
    { name: 'Epinefrina autoinyector 0.3 mg', dose: '0.3 mg / dosis', times: ['00:00'], category: 'Emergencia', notes: 'Emergencia por anafilaxia; revisión previa de caducidad.' },
    { name: 'Solución salina 0.9% 250 ml', dose: '250 ml', times: ['12:00'], category: 'Hidratacion y electrolitos', notes: 'Bolsa presurizada para uso en 0 g y superficie con protocolo.' },
    { name: 'Sales de rehidratación oral', dose: '1 sobre / 200 ml', times: ['06:30', '18:30'], category: 'Hidratacion y electrolitos', notes: 'Sobres sellados para rehidratación sin derrames.' },
    { name: 'Melatonina 3 mg', dose: '3 mg', times: ['22:00'], category: 'Sueno y salud mental', notes: 'Apoyo al sueño en misión; registro y seguimiento.' },
    { name: 'Loratadina 10 mg', dose: '10 mg', times: ['08:00'], category: 'Antibioticos', notes: 'Antihistamínico no sedante para uso general.' },
    { name: 'Oxímetro de pulso compacto', dose: 'equipo', times: ['00:00'], category: 'Diagnostico', notes: 'Mide SpO₂, batería recargable y sin partes sueltas.' },
    { name: 'Tensiometro automático de muñeca', dose: 'equipo', times: ['08:00'], category: 'Diagnostico', notes: 'Monitor clínico para presión arterial con validación espacial.' },
    { name: 'Vendaje compresivo esteril', dose: 'vendaje', times: ['00:00'], category: 'Curacion y trauma', notes: 'Embalaje al vacío, apertura controlada en microgravedad.' },
    { name: 'Guantes de nitrilo (par)', dose: 'par', times: ['00:00'], category: 'Curacion y trauma', notes: 'Higiene y curación sin látex.' },
    { name: 'Kit de sutura menor esteril', dose: 'kit', times: ['00:00'], category: 'Curacion y trauma', notes: 'Solo bajo protocolo; uso con supervisión médica.' },
    { name: 'Termómetro infrarrojo sin contacto', dose: 'equipo', times: ['08:00'], category: 'Diagnostico', notes: 'Temperatura corporal sin vidrio ni mercurio.' }
  ];
  function renderDatabaseCatalog() {
    const dbList = $('medicationDatabase');
    if (!dbList) return;
    dbList.innerHTML = DATABASE_CATALOG.map(item => `
      <article class="med-card db-card">
        <div class="med-heading">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="muted">${escapeHtml(item.category)} · ${escapeHtml(item.dose)}</p>
          </div>
          <button type="button" class="text-btn db-fill" data-name="${escapeHtml(item.name)}" data-dose="${escapeHtml(item.dose)}" data-times="${escapeHtml(item.times.join(', '))}">Usar</button>
        </div>
        <p class="muted">${escapeHtml(item.notes)}</p>
      </article>
    `).join('');
    dbList.querySelectorAll('.db-fill').forEach(button => button.addEventListener('click', () => {
      const name = button.dataset.name;
      const dose = button.dataset.dose;
      const times = button.dataset.times;
      $('medName').value = name;
      $('medDose').value = dose;
      $('medTimes').value = times;
      $('medName').focus();
      showMessage(`Se cargó ${name} desde la base de datos.`);
    }));
  }
  function render() {
    renderDatabaseCatalog();
    const list = $('medicationList');
    if (!list) return;
    if (!data.medications.length) {
      list.innerHTML = '<p class="empty-state">Aún no hay medicamentos registrados.</p>';
      return;
    }
    const day = currentDay();
    list.innerHTML = data.medications.map(med => {
      const doses = med.times.length ? med.times.map(time => {
        const intake = data.intakes.find(item => item.medId === med.id && item.scheduledTime === time && item.day === day);
        const status = intake ? intake.status : '';
        const label = status === 'taken' ? 'Tomado' : status === 'missed' ? 'Omitido' : 'Pendiente';
        return `<div class="med-dose"><span><strong>${escapeHtml(time)}</strong><small class="dose-status ${status}">${label}</small></span><span class="dose-actions">
          <button type="button" class="text-btn med-status-btn" data-med="${escapeHtml(med.id)}" data-time="${escapeHtml(time)}" data-status="taken" ${status === 'taken' ? 'disabled' : ''}>Marcar tomado</button>
          <button type="button" class="text-btn med-status-btn" data-med="${escapeHtml(med.id)}" data-time="${escapeHtml(time)}" data-status="missed" ${status === 'missed' ? 'disabled' : ''}>Marcar omitido</button></span></div>`;
      }).join('') : '<p class="muted">No hay horarios.</p>';
      return `<article class="med-card"><div class="med-heading"><div><h3>${escapeHtml(med.name)}</h3><p class="muted">${escapeHtml(med.dose || 'Dosis no especificada')}</p>${med.notes ? `<p class="muted">${escapeHtml(med.notes)}</p>` : ''}</div>
        <button type="button" class="text-btn med-delete" data-med="${escapeHtml(med.id)}" aria-label="Eliminar ${escapeHtml(med.name)}">Eliminar</button></div>
        <p class="eyebrow">DÍA ${day} · ${med.active ? 'ACTIVO' : 'INACTIVO'}</p>${doses}</article>`;
    }).join('');
    list.querySelectorAll('.med-status-btn').forEach(button => button.addEventListener('click', () => {
      const dayNow = currentDay();
      data.intakes = data.intakes.filter(item => !(item.medId === button.dataset.med && item.scheduledTime === button.dataset.time && item.day === dayNow));
      data.intakes.push({ medId: button.dataset.med, scheduledTime: button.dataset.time, day: dayNow, status: button.dataset.status });
      save(); render();
    }));
    list.querySelectorAll('.med-delete').forEach(button => button.addEventListener('click', () => {
      const med = data.medications.find(item => item.id === button.dataset.med);
      if (!med || !window.confirm(`¿Eliminar el registro de ${med.name}?`)) return;
      data.medications = data.medications.filter(item => item.id !== med.id);
      data.intakes = data.intakes.filter(item => item.medId !== med.id);
      save(); render();
    }));
  }
  $('medicationForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('medName').value.trim();
    const dose = $('medDose').value.trim();
    const times = $('medTimes').value.split(',').map(value => value.trim()).filter(Boolean);
    if (!name || !times.length || times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      showMessage('Indica el nombre y horarios válidos con formato HH:MM.');
      return;
    }
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `med-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    data.medications.push({ id, name, dose, notes: '', times: [...new Set(times)].sort(), active: true });
    save(); event.target.reset(); render();
  });
  window.MedicationsView = { refresh: render };
  save(); render();
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === 'bytemedicals_state') render(); });
})();
