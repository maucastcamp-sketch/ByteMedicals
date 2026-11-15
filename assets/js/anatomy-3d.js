/* ============================================================================
   ByteMedicals — Human Anatomy 3D viewer (original module, v1.0.0-original)
   ----------------------------------------------------------------------------
   The Human Anatomy page's main figure is a real interactive 3D anatomical
   model, replacing the schematic SVG drawing. Selecting a body system in the
   panel loads and projects that system in 3D; clicking a structure in the
   3D view selects its system in the panel (two-way linking).

   MODELS — the viewer loads open anatomical models (Z-Anatomy,
   Creative Commons Attribution-ShareAlike 4.0, CC BY-SA 4.0) from
   jsDelivr (Vanatome mirror, public repository, CORS *). Per-system
   GLB files, Z-Anatomy 1.4.0, except the cardiovascular file:
   jsDelivr returns 403 for the 1.4.0 cardiovascular file, so the
   byte-identical 1.3.0 file (same size, 7,994,524 bytes) is used
   instead. The page credits Z-Anatomy and links to the CC BY-SA 4.0
   licence. No model file is bundled in the project: the viewer needs an
   internet connection. Without it (or without WebGL) the original
   schematic SVG figure is shown instead — the page never breaks.

   STRUCTURE NAMES — each GLB mesh carries its anatomical name
   ("slug__Display name.l"). The Z-Anatomy registry (z-anatomy-1.4.0-
   registry.json, 807 structures) maps the slug to a clean name and to
   its system, so a click on a structure can select the right ByteMedicals
   system even when the mesh lives inside another system's file. If the
   registry cannot be fetched, names are parsed from the mesh name and
   the click selects the currently loaded system.

   The viewer only reads localStorage['bytemedicals_anatomy'] (to restore
   the last selected system) and never writes medical state.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0-original';
  var CDN = 'https://cdn.jsdelivr.net/gh/vixotic/Vanatome@main/public/models/';
  var REGISTRY_URL = CDN + 'z-anatomy-1.4.0-registry.json';
  var FIGURE_ID = 'anFigure';
  var SEL_KEY = 'bytemedicals_anatomy';
  var DEFAULT_SYSTEM = 'skeletal';

  /* ByteMedicals system -> GLB files (Z-Anatomy). */
  var FILES = {
    cardiovascular: ['z-anatomy-1.3.0-cardiovascular.glb'], /* 1.4.0 file 403s on jsDelivr; 1.3.0 is byte-identical in size */
    musculoskeletal: ['z-anatomy-1.4.0-skeletal.glb', 'z-anatomy-1.4.0-muscular.glb'],
    immune: ['z-anatomy-1.4.0-lymphatic.glb'],
    respiratory: ['z-anatomy-1.4.0-respiratory.glb'],
    nervous: ['z-anatomy-1.4.0-nervous.glb'],
    skeletal: ['z-anatomy-1.4.0-skeletal.glb']
  };

  /* Z-Anatomy registry system -> ByteMedicals system. */
  var REGISTRY_SYSTEM_MAP = {
    cardiovascular: 'cardiovascular',
    muscular: 'musculoskeletal',
    skeletal: 'skeletal',
    lymphatic: 'immune',
    respiratory: 'respiratory',
    nervous: 'nervous'
  };

  var THREE = null, OrbitControls = null, GLTFLoader = null;
  var box = null, canvasHost = null, overlay = null, overlayText = null;
  var barReset = null, barGhost = null, footHint = null, footPicked = null;
  var renderer = null, scene = null, camera = null, controls = null;
  var cache = {};            /* system id -> THREE.Group */
  var ghostGroup = null;     /* faint skeleton shown behind other systems */
  var ghostOn = true;
  var current = null;        /* system id currently shown */
  var currentGroup = null;
  var registryById = null;   /* slug -> { name, system } */
  var ready = false, failed = false, loading = false;
  var pendingSystem = null;
  var pickedName = null, pickedSystem = null;
  var downX = 0, downY = 0;
  var ro = null;

  function t(key) {
    return ({
      'an3d.loading': 'Cargando modelo 3D…',
      'an3d.reset': 'Restablecer vista',
      'an3d.ghost': 'Mostrar esqueleto',
      'an3d.structure': 'Estructura',
      'an3d.hint': 'Arrastra para girar · rueda para zoom · clic en una estructura',
      'an3d.error': 'No se pudo cargar el modelo 3D.',
      'an3d.offline': 'El modelo 3D necesita conexión a internet.'
    })[key] || key;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }

  /* ---- structure names -------------------------------------------------- */

  /* Parse a mesh/node name of the form "slug__Display name.l" (GLTFLoader
     sanitises spaces and dots to "_", so "Anterior axillary nodes.l"
     arrives as "Anterior_axillary_nodesl"). Returns { name, system } with
     system null when the registry is unavailable. */
  function parseStructureName(meshName) {
    var raw = String(meshName || '');
    var parts = raw.split('__');
    var slug = parts[0] || '';
    var disp = parts.length > 1 ? parts[1] : parts[0];
    disp = disp.replace(/_/g, ' ');
    var side = '';
    if (/-left$/.test(slug)) { disp = disp.replace(/l$/, ''); side = ' (L)'; }
    else if (/-right$/.test(slug)) { disp = disp.replace(/r$/, ''); side = ' (R)'; }
    var entry = registryById ? registryById[slug] : null;
    if (entry) {
      var nm = String(entry.name || disp).replace(/\.l$/, ' (L)').replace(/\.r$/, ' (R)');
      return { name: nm, system: REGISTRY_SYSTEM_MAP[entry.system] || null };
    }
    return { name: (disp + side).trim(), system: null };
  }

  function loadRegistry() {
    if (registryById) return Promise.resolve(registryById);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    try {
      return fetch(REGISTRY_URL).then(function (res) {
        if (!res.ok) throw new Error('registry ' + res.status);
        return res.json();
      }).then(function (d) {
        var map = {};
        (d.structures || []).forEach(function (s) { if (s && s.id) map[s.id] = { name: s.name, system: s.system }; });
        registryById = map;
        return map;
      }).catch(function () { registryById = null; return null; });
    } catch (e) { registryById = null; return Promise.resolve(null); }
  }

  /* ---- figure ownership / fallback --------------------------------------- */

  function claimFigure() {
    box = $(FIGURE_ID);
    if (!box) return false;
    box.setAttribute('data-an3d', 'loading');
    box.classList.add('an3d');
    box.innerHTML = '';
    canvasHost = document.createElement('div');
    canvasHost.className = 'an3d-canvas';
    box.appendChild(canvasHost);
    var bar = document.createElement('div');
    bar.className = 'an3d-bar';
    barReset = document.createElement('button');
    barReset.type = 'button';
    barReset.className = 'an3d-btn';
    barReset.addEventListener('click', function () { resetView(); });
    barGhost = document.createElement('button');
    barGhost.type = 'button';
    barGhost.className = 'an3d-btn an3d-btn-toggle';
    barGhost.addEventListener('click', function () { setGhost(!ghostOn); });
    bar.appendChild(barReset);
    bar.appendChild(barGhost);
    box.appendChild(bar);
    overlay = document.createElement('div');
    overlay.className = 'an3d-overlay';
    overlay.innerHTML = '<div class="an3d-spin" aria-hidden="true"></div><p class="an3d-overlay-text"></p>';
    overlayText = overlay.querySelector('.an3d-overlay-text');
    box.appendChild(overlay);
    var foot = document.createElement('div');
    foot.className = 'an3d-foot';
    footHint = document.createElement('div');
    footHint.className = 'an3d-hint';
    footPicked = document.createElement('div');
    footPicked.className = 'an3d-picked';
    footPicked.style.display = 'none';
    foot.appendChild(footPicked);
    foot.appendChild(footHint);
    box.appendChild(foot);
    refreshLabels();
    return true;
  }

  /* The 3D viewer cannot run (no internet, no WebGL, model unreachable):
     give the figure back to the schematic SVG so the page keeps working. */
  function fallback() {
    if (failed) return;
    failed = true;
    ready = false;
    try { if (renderer) renderer.dispose(); } catch (e) { /* ignore */ }
    if (box) {
      box.removeAttribute('data-an3d');
      box.classList.remove('an3d');
      box.innerHTML = '';
    }
    if (window.HumanAnatomy && typeof window.HumanAnatomy.showSchematic === 'function') {
      window.HumanAnatomy.showSchematic();
    }
  }

  function refreshLabels() {
    if (barReset) barReset.textContent = t('an3d.reset');
    if (barGhost) { barGhost.textContent = t('an3d.ghost'); barGhost.classList.toggle('an3d-on', ghostOn); }
    if (footHint) footHint.textContent = t('an3d.hint');
    renderPicked();
  }
  function renderPicked() {
    if (!footPicked) return;
    if (pickedName) {
      footPicked.textContent = t('an3d.structure') + ': ' + pickedName;
      footPicked.style.display = '';
    } else {
      footPicked.textContent = '';
      footPicked.style.display = 'none';
    }
  }
  function setOverlay(text, show) {
    if (!overlay) return;
    overlay.style.display = show ? '' : 'none';
    if (text != null && overlayText) overlayText.textContent = text;
  }

  /* ---- Three.js scene ----------------------------------------------------- */

  function buildScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute('aria-label', '3D anatomical model');
    canvasHost.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1218);
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(0, 1, 3.2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2733, 1.1));
    var key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 2.5);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xbfd9e8, 0.5);
    fill.position.set(-2, 1, -2);
    scene.add(fill);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.95, 0);
    renderer.domElement.addEventListener('pointerdown', function (e) { downX = e.clientX; downY = e.clientY; });
    renderer.domElement.addEventListener('click', onCanvasClick);
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () { resize(); });
      ro.observe(box);
    }
    window.addEventListener('resize', resize);
    resize();
    (function animate() {
      requestAnimationFrame(animate);
      if (!box || box.offsetParent === null) return; /* anatomy page hidden: skip rendering */
      if (controls) controls.update();
      if (renderer && scene && camera) renderer.render(scene, camera);
    })();
  }

  function resize() {
    if (!renderer || !box || !camera) return;
    var w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frameGroup(group) {
    if (!group || !camera || !controls) return;
    var b = new THREE.Box3().setFromObject(group);
    var size = new THREE.Vector3(); b.getSize(size);
    var center = new THREE.Vector3(); b.getCenter(center);
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var dist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(center.x + dist * 0.22, center.y + dist * 0.08, center.z + dist * 1.32);
    controls.target.copy(center);
    controls.minDistance = dist * 0.3;
    controls.maxDistance = dist * 3;
    controls.update();
  }

  function resetView() {
    if (currentGroup) frameGroup(currentGroup);
  }

  /* ---- model loading ------------------------------------------------------ */

  function loadSystemGroup(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    var loader = new GLTFLoader();
    var group = new THREE.Group();
    group.name = 'an3d-' + id;
    var chain = Promise.resolve();
    FILES[id].forEach(function (f) {
      chain = chain.then(function () { return loader.loadAsync(CDN + f); })
        .then(function (gltf) { group.add(gltf.scene); });
    });
    return chain.then(function () { cache[id] = group; return group; });
  }

  function ensureGhost() {
    if (ghostGroup || !ready) return Promise.resolve(ghostGroup);
    return loadSystemGroup('skeletal').then(function (skel) {
      var ghostMat = new THREE.MeshStandardMaterial({ color: 0x8b98a5, transparent: true, opacity: 0.13, depthWrite: false });
      ghostGroup = skel.clone();
      ghostGroup.name = 'an3d-ghost';
      ghostGroup.traverse(function (o) { if (o.isMesh) o.material = ghostMat; });
      ghostGroup.visible = false;
      scene.add(ghostGroup);
      return ghostGroup;
    }).catch(function () { return null; });
  }

  function applyGhost() {
    if (!scene) return;
    var show = ghostOn && current && current !== 'skeletal' && current !== 'musculoskeletal' && ghostGroup;
    if (ghostGroup) ghostGroup.visible = !!show;
    if (show) return;
    if (ghostOn && current && current !== 'skeletal' && current !== 'musculoskeletal') {
      ensureGhost().then(function () { if (ghostOn && current && current !== 'skeletal' && current !== 'musculoskeletal' && ghostGroup) ghostGroup.visible = true; });
    }
  }

  function setGhost(on) {
    ghostOn = !!on;
    applyGhost();
    refreshLabels();
  }

  function showSystem(id) {
    if (!FILES[id]) id = DEFAULT_SYSTEM;
    if (!ready) { pendingSystem = id; return Promise.resolve(false); }
    if (id === current && currentGroup) return Promise.resolve(true);
    var first = !currentGroup;
    if (first) setOverlay(t('an3d.loading'), true);
    else if (footHint) footHint.textContent = t('an3d.loading');
    loading = true;
    return loadSystemGroup(id).then(function (group) {
      loading = false;
      if (currentGroup) scene.remove(currentGroup);
      currentGroup = group;
      current = id;
      scene.add(group);
      frameGroup(group);
      applyGhost();
      setOverlay(null, false);
      refreshLabels();
      return true;
    }).catch(function (err) {
      loading = false;
      setOverlay(null, false);
      if (!currentGroup) { fallback(); return false; }
      if (footHint) footHint.textContent = t('an3d.error');
      return false;
    });
  }

  /* ---- picking -------------------------------------------------------------- */

  function onCanvasClick(e) {
    if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) return; /* it was a drag, not a click */
    if (!currentGroup || !renderer || !camera) return;
    var r = renderer.domElement.getBoundingClientRect();
    var ptr = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    var ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, camera);
    var hits = ray.intersectObjects(currentGroup.children, true);
    if (!hits.length) return;
    var info = parseStructureName(hits[0].object.name);
    pickedName = info.name;
    pickedSystem = info.system || current;
    renderPicked();
    if (pickedSystem && pickedSystem !== current &&
        window.HumanAnatomy && typeof window.HumanAnatomy.select === 'function') {
      window.HumanAnatomy.select(pickedSystem);
    }
  }

  /* ---- init ------------------------------------------------------------------ */

  function initialSystem() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SEL_KEY) || '{}');
      if (s && FILES[s.selected]) return s.selected;
    } catch (e) { /* ignore */ }
    return DEFAULT_SYSTEM;
  }

  function loadThree() {
    try {
      return Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/loaders/GLTFLoader.js')
      ]).then(function (mods) {
        THREE = mods[0];
        OrbitControls = mods[1].OrbitControls;
        GLTFLoader = mods[2].GLTFLoader;
        if (!THREE || !OrbitControls || !GLTFLoader) throw new Error('Three.js did not initialise.');
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function init() {
    if (!claimFigure()) return;
    setOverlay(t('an3d.loading'), true);
    loadRegistry();
    loadThree().then(function () {
      buildScene();
      ready = true;
      setOverlay(null, false);
      var first = pendingSystem || initialSystem();
      pendingSystem = null;
      return showSystem(first);
    }).catch(function () {
      fallback();
    });
  }

  window.Anatomy3D = {
    version: VERSION,
    showSystem: showSystem,
    getCurrent: function () { return current; },
    getSystems: function () { return Object.keys(FILES); },
    getFiles: function (id) { return FILES[id] ? FILES[id].slice() : []; },
    resetView: resetView,
    setGhost: setGhost,
    getGhost: function () { return ghostOn; },
    isReady: function () { return ready; },
    parseStructureName: parseStructureName,
    fallback: fallback,
    refresh: refreshLabels
  };

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('bytemedicals:language-changed', refreshLabels);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
