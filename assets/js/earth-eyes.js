/* ByteMedicals — NASA Eyes on the Earth, live view (Dashboard "Orbit View").
   ---------------------------------------------------------------------------
   Replaces the stylised CSS orbit animation inside #orbitScene with a live,
   interactive view of NASA Eyes on the Earth
   (https://eyes.nasa.gov/apps/earth/#/), embedded in an iframe. Inside the
   app the globe is draggable (rotate) and wheel-zoomable, and it shows
   real NASA data (satellites, Earth imagery) instead of the old simulated
   animation. The view needs an internet connection; if the frame cannot be
   loaded, a fallback panel offers to open NASA Eyes in a new tab.

   Source / licence note: NASA Eyes on the Earth is a NASA/JPL web app; it
   is embedded, not copied — no Eyes code, text or imagery is included in
   this project. Embedding is allowed: the page sends no X-Frame-Options
   or frame-ancestors header, its bundle contains no frame-buster, and it
   even notifies its parent window of state changes (updateParentUrl).

   Reads nothing, writes nothing to medical state. Own state: none.
   Public API: window.EarthEyes = { version, refresh, showFallback,
   hideFallback, getEyesUrl }. */

(function () {
  'use strict';

  var VERSION = '1.0.0-original';
  var EYES_URL = 'https://eyes.nasa.gov/apps/earth/#/';
  var LOAD_TIMEOUT_MS = 25000;

  var loadTimer = null;

  function $(id) { return document.getElementById(id); }

  function t(key, fallback) {
    return fallback;
  }

  function renderTexts() {
    var loading = $('eeLoadingText');
    if (loading) loading.textContent = t('ee.loading', 'Cargando NASA Eyes sobre la Tierra…');
    var live = $('eeLiveLabel');
    if (live) live.textContent = t('ee.live', 'NASA EYES · EN VIVO');
    var fs = $('eeFullscreen');
    if (fs) fs.textContent = t('ee.fullscreen', 'Pantalla completa');
    var open = $('eeOpen');
    if (open) open.textContent = t('ee.open', 'Abrir en NASA Eyes') + ' ↗';
    var openFb = $('eeOpenFallback');
    if (openFb) openFb.textContent = t('ee.open', 'Abrir en NASA Eyes') + ' ↗';
    var note = $('eeNote');
    if (note) note.textContent = t('ee.note', 'Vista interactiva de NASA Eyes — requiere internet. Arrastra para girar el globo y usa la rueda para acercar o alejar.');
    var failed = $('eeFailedText');
    if (failed) failed.textContent = t('ee.failed', 'No se pudo cargar NASA Eyes. Comprueba tu conexión e inténtalo de nuevo.');
    var retry = $('eeRetry');
    if (retry) retry.textContent = t('ee.retry', 'Reintentar');
    var frame = $('eeFrame');
    if (frame) frame.setAttribute('title', 'NASA Eyes on the Earth');
  }

  function showFallback() {
    var loading = $('eeLoading');
    if (loading) loading.hidden = true;
    var fb = $('eeFallback');
    if (fb) fb.hidden = false;
  }

  function hideFallback() {
    var fb = $('eeFallback');
    if (fb) fb.hidden = true;
  }

  function showLoading() {
    hideFallback();
    var loading = $('eeLoading');
    if (loading) loading.hidden = false;
  }

  function onFrameLoaded() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    var loading = $('eeLoading');
    if (loading) loading.hidden = true;
    hideFallback();
  }

  function startLoadTimer() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(showFallback, LOAD_TIMEOUT_MS);
  }

  function reloadFrame() {
    var frame = $('eeFrame');
    if (!frame) return;
    showLoading();
    frame.src = 'about:blank';
    setTimeout(function () {
      frame.src = EYES_URL;
      startLoadTimer();
    }, 60);
  }

  function toggleFullscreen() {
    var wrap = $('eeWrap');
    if (!wrap) return;
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else if (wrap.requestFullscreen) {
        wrap.requestFullscreen();
      } else if (wrap.webkitRequestFullscreen) {
        wrap.webkitRequestFullscreen();
      }
    } catch (e) { /* fullscreen unavailable; the embedded view still works */ }
  }

  function install() {
    var scene = $('orbitScene');
    if (!scene || scene.classList.contains('ee-active')) return;
    scene.classList.add('ee-active');
    scene.innerHTML =
      '<div class="ee-wrap" id="eeWrap">' +
        '<div class="ee-loading" id="eeLoading"><div class="ee-spinner"></div><p id="eeLoadingText"></p></div>' +
        '<iframe id="eeFrame" class="ee-frame" src="' + EYES_URL + '" title="NASA Eyes on the Earth" allow="fullscreen" referrerpolicy="no-referrer"></iframe>' +
        '<div class="ee-fallback" id="eeFallback" hidden><p id="eeFailedText"></p>' +
          '<p><a class="btn ee-btn" id="eeOpenFallback" href="' + EYES_URL + '" target="_blank" rel="noopener"></a> ' +
          '<button class="btn ee-btn" id="eeRetry" type="button"></button></p></div>' +
      '</div>';
    var panel = scene.closest ? scene.closest('.orbit-panel') : null;
    if (panel) {
      var bar = document.createElement('div');
      bar.className = 'ee-bar';
      bar.id = 'eeBar';
      bar.innerHTML =
        '<span class="ee-live"><span class="ee-live-dot"></span><span id="eeLiveLabel"></span></span>' +
        '<span class="ee-spacer"></span>' +
        '<button class="btn ee-btn" id="eeFullscreen" type="button"></button>' +
        '<a class="btn ee-btn" id="eeOpen" href="' + EYES_URL + '" target="_blank" rel="noopener"></a>';
      scene.insertAdjacentElement('afterend', bar);
      var note = document.createElement('p');
      note.className = 'ee-note';
      note.id = 'eeNote';
      bar.insertAdjacentElement('afterend', note);
    }
    var frame = $('eeFrame');
    if (frame) {
      frame.addEventListener('load', onFrameLoaded);
      frame.addEventListener('error', showFallback);
    }
    var retry = $('eeRetry');
    if (retry) retry.addEventListener('click', reloadFrame);
    var fsBtn = $('eeFullscreen');
    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    renderTexts();
    startLoadTimer();
  }

  function bindUI() {
    install();
    window.addEventListener('bytemedicals:language-changed', renderTexts);
  }

  window.EarthEyes = {
    version: VERSION,
    refresh: renderTexts,
    showFallback: showFallback,
    hideFallback: hideFallback,
    getEyesUrl: function () { return EYES_URL; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else { bindUI(); }
})();
