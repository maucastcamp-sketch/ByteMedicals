/* ByteMedicals — autenticación (Paso 2).
 * Gestiona la sesión (token JWT en localStorage), la página de
 * login/registro y las llamadas a /api/* con el token.
 * El resto de la app usa window.ByteMedicalsAuth.apiCall().
 */
(() => {
  'use strict';

  const TOKEN_KEY = 'bytemedicals_token';
  const USER_KEY = 'bytemedicals_user';
  const $ = id => document.getElementById(id);

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function saveSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* nada que limpiar */ }
  }

  async function apiCall(path, options = {}) {
    const token = getToken();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {}
    );
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) { /* respuesta sin JSON */ }
    if (res.status === 401 && token) {
      // Sesión inválida o expirada con token guardado: salir.
      logout();
      throw new Error('Sesión expirada. Inicia sesión de nuevo.');
    }
    if (!res.ok) throw new Error(data.detail || ('Error ' + res.status));
    return data;
  }

  function showAuth() {
    document.body.classList.remove('authed');
    $('page-auth').classList.add('active');
    $('userChip').hidden = true;
    $('logoutBtn').hidden = true;
  }

  function showApp(user) {
    document.body.classList.add('authed');
    $('page-auth').classList.remove('active');
    if (user) {
      $('userChip').textContent = user.email +
        (user.role === 'admin' ? ' · admin' : '');
      $('userChip').hidden = false;
      $('logoutBtn').hidden = false;
    }
    window.dispatchEvent(new Event('bytemedicals:authed'));
  }

  function logout() {
    clearSession();
    showAuth();
  }

  window.ByteMedicalsAuth = { getToken, getUser, apiCall, logout, showApp, showAuth };

  function setError(message) {
    $('authError').textContent = message || '';
  }

  function switchTab(mode) {
    const login = mode === 'login';
    $('authTabLogin').classList.toggle('active', login);
    $('authTabRegister').classList.toggle('active', !login);
    $('loginForm').hidden = !login;
    $('registerForm').hidden = login;
    $('authTitle').textContent = login ? 'Inicia sesión' : 'Crea tu cuenta';
    setError('');
  }

  async function submitAuth(path, email, password) {
    const data = await apiCall(path, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(data.access_token, data.user);
    showApp(data.user);
  }

  function bind() {
    $('authTabLogin').addEventListener('click', () => switchTab('login'));
    $('authTabRegister').addEventListener('click', () => switchTab('register'));
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      setError('');
      try {
        await submitAuth('/api/auth/login',
          $('loginEmail').value.trim(), $('loginPassword').value);
      } catch (err) { setError(err.message); }
    });
    $('registerForm').addEventListener('submit', async event => {
      event.preventDefault();
      setError('');
      try {
        await submitAuth('/api/auth/register',
          $('registerEmail').value.trim(), $('registerPassword').value);
      } catch (err) { setError(err.message); }
    });
    $('logoutBtn').addEventListener('click', logout);
  }

  async function init() {
    bind();
    const token = getToken();
    if (!token) { showAuth(); return; }
    try {
      const user = await apiCall('/api/auth/me');
      saveSession(token, user);
      showApp(user);
    } catch (err) {
      // Token guardado inválido: se muestra el login (logout ya limpió).
      showAuth();
    }
  }

  init();
})();
