/* ByteMedicals — Panel de administración (Paso 5, original).
 *
 * Visible solo para el rol admin. Esto solo decide qué mostrar:
 * los permisos se comprueban en el servidor en cada petición
 * (auth.require_admin), así que un usuario normal que adivinara
 * la URL seguiría recibiendo 403.
 *
 * VERSION 1.0.0-original
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function isAdmin() {
    const auth = window.ByteMedicalsAuth;
    const user = auth && typeof auth.getUser === 'function'
      ? auth.getUser() : null;
    return !!(user && user.role === 'admin');
  }

  function currentUserId() {
    const auth = window.ByteMedicalsAuth;
    const user = auth && typeof auth.getUser === 'function'
      ? auth.getUser() : null;
    return user ? user.id : null;
  }

  function showAdminUI() {
    const nav = $('navAdmin');
    const note = $('adminOnlyNote');
    const content = $('adminContent');
    if (isAdmin()) {
      if (nav) nav.style.display = '';
      if (note) note.hidden = true;
      if (content) content.hidden = false;
      loadAll();
    } else {
      if (nav) nav.style.display = 'none';
      if (note) note.hidden = false;
      if (content) content.hidden = true;
    }
  }

  function statusRow(label, value, ok) {
    const row = document.createElement('div');
    row.className = 'admin-status-row';
    const name = document.createElement('span');
    name.textContent = label;
    const state = document.createElement('strong');
    state.className = ok ? 'admin-status-ok' : 'admin-status-bad';
    state.textContent = value;
    row.appendChild(name);
    row.appendChild(state);
    return row;
  }

  async function loadStatus() {
    const box = $('adminStatus');
    if (!box) return;
    try {
      const data = await window.ByteMedicalsAuth.apiCall('/api/admin/status');
      box.innerHTML = '';
      box.appendChild(statusRow('PRAG (IA)',
        data.prag === 'ok' ? 'En línea' : 'No disponible',
        data.prag === 'ok'));
      if (data.prag_detail) {
        box.appendChild(statusRow('Qdrant', data.prag_detail.qdrant || '—', true));
        box.appendChild(statusRow('Ollama', data.prag_detail.ollama || '—', true));
      }
      if (data.prag_error) {
        const err = document.createElement('p');
        err.className = 'muted';
        err.textContent = data.prag_error;
        box.appendChild(err);
      }
      box.appendChild(statusRow('Base de datos (MySQL)',
        data.database === 'ok' ? 'En línea' : 'No disponible',
        data.database === 'ok'));
      box.appendChild(statusRow('Versión', data.version || '—', true));
      box.appendChild(statusRow('PRAG', data.prag_base_url || '—', true));
    } catch (err) {
      box.textContent = '⚠ ' + (err.message || 'No se pudo cargar el estado.');
    }
  }

  async function loadFiles() {
    const box = $('adminFiles');
    if (!box) return;
    try {
      const data = await window.ByteMedicalsAuth.apiCall('/api/admin/files');
      box.innerHTML = '';
      const count = document.createElement('p');
      count.className = 'muted';
      count.textContent = (data.total || 0) + ' documento(s) indexado(s).';
      box.appendChild(count);
      const list = document.createElement('ul');
      (data.files || []).forEach(file => {
        const item = document.createElement('li');
        if (file.file_url) {
          const link = document.createElement('a');
          link.href = file.file_url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = file.filename;
          item.appendChild(link);
        } else {
          item.textContent = file.filename;
        }
        list.appendChild(item);
      });
      box.appendChild(list);
    } catch (err) {
      box.textContent = '⚠ ' + (err.message || 'No se pudieron cargar los documentos.');
    }
  }

  async function loadUsers() {
    const box = $('adminUsers');
    if (!box) return;
    try {
      const users = await window.ByteMedicalsAuth.apiCall('/api/admin/users');
      box.innerHTML = '';
      const me = currentUserId();
      users.forEach(user => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';
        const email = document.createElement('span');
        email.className = 'admin-user-email';
        email.textContent = user.email + (user.id === me ? ' (tú)' : '');
        row.appendChild(email);
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Rol de ' + user.email);
        ['user', 'admin'].forEach(role => {
          const option = document.createElement('option');
          option.value = role;
          option.textContent = role === 'admin' ? 'Administrador' : 'Usuario';
          if (user.role === role) option.selected = true;
          select.appendChild(option);
        });
        select.disabled = user.id === me;
        select.addEventListener('change', async () => {
          const previous = user.role;
          try {
            await window.ByteMedicalsAuth.apiCall(
              '/api/admin/users/' + user.id + '/role',
              { method: 'PATCH', body: JSON.stringify({ role: select.value }) }
            );
            user.role = select.value;
          } catch (err) {
            select.value = previous;
            window.alert('No se pudo cambiar el rol: ' + (err.message || 'error'));
          }
        });
        row.appendChild(select);
        const remove = document.createElement('button');
        remove.className = 'text-btn';
        remove.type = 'button';
        remove.textContent = 'Borrar';
        remove.disabled = user.id === me;
        remove.addEventListener('click', async () => {
          if (!window.confirm('¿Borrar la cuenta ' + user.email + ' y todas sus conversaciones?')) return;
          try {
            await window.ByteMedicalsAuth.apiCall(
              '/api/admin/users/' + user.id, { method: 'DELETE' });
            loadUsers();
          } catch (err) {
            window.alert('No se pudo borrar: ' + (err.message || 'error'));
          }
        });
        row.appendChild(remove);
        box.appendChild(row);
      });
      if (!users.length) {
        box.textContent = 'No hay usuarios.';
      }
    } catch (err) {
      box.textContent = '⚠ ' + (err.message || 'No se pudieron cargar los usuarios.');
    }
  }

  async function runSync() {
    const button = $('adminSyncBtn');
    const result = $('adminSyncResult');
    if (!button || !result) return;
    button.disabled = true;
    result.textContent = 'Sincronizando con Google Drive…';
    try {
      const data = await window.ByteMedicalsAuth.apiCall('/api/admin/sync', { method: 'POST' });
      result.textContent = 'Sincronización terminada: '
        + data.discovered + ' descubierto(s), '
        + data.ingested + ' nuevo(s), '
        + data.unchanged + ' sin cambios, '
        + data.failed + ' con error, '
        + data.removed + ' eliminado(s).';
      loadFiles();
    } catch (err) {
      result.textContent = '⚠ ' + (err.message || 'La sincronización falló.');
    } finally {
      button.disabled = false;
    }
  }

  function loadAll() {
    loadStatus();
    loadFiles();
    loadUsers();
  }

  function bind() {
    const syncBtn = $('adminSyncBtn');
    if (syncBtn) syncBtn.addEventListener('click', runSync);
    window.addEventListener('bytemedicals:authed', showAdminUI);
    showAdminUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
