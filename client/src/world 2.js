/**
 * SebasPresent — World module (Slice 2 chunked edition)
 *
 * Infinite procedural world. Terrain is split into 64×64m chunks, each
 * generated on demand from a deterministic biome function. Only chunks
 * within RENDER_RADIUS of the player are loaded; others are torn down
 * to keep memory bounded.
 *
 * Procedural pipeline:
 *   (worldX, worldZ) ──▶ biome function (noise-based)
 *                  ──▶ vertex color = biome.base + per-vertex jitter
 *                  ──▶ rendered as one mesh per chunk
 *
 * Landmarks (obelisks) are placed with a deterministic hash so the same
 * coordinates always produce the same world — like a Minecraft seed,
 * but the seed is baked in.
 */

// ============================================================
//                       Configuration
// ============================================================

const CHUNK_SIZE     = 64;       // metres per chunk side
const CHUNK_SEGS     = 32;       // grid cells per chunk side → 2m per cell
const RENDER_RADIUS  = 3;        // chunks. Renders (2R+1)² = 49 chunks
const BIOME_SCALE    = 0.0035;   // lower = bigger biome blobs
const PLAYER_SPEED   = 7.0;      // m/s
const FOG_NEAR       = CHUNK_SIZE * 2;
const FOG_FAR        = CHUNK_SIZE * (RENDER_RADIUS + 0.5);

// ============================================================
//                          Palette
// ============================================================

const PALETTE = {
  sky:         0x9ec0d6,
  fog:         0xa8c4d8,

  player:      0xc04a3a,
  marker:      0xfff04a,
};

// Each biome: { base, light, dark } RGB
const BIOMES = {
  plains:  { base: 0x6b9e3a, light: 0x88b850, dark: 0x4e7626 },
  forest:  { base: 0x4a6d2a, light: 0x6a8e44, dark: 0x2e451a },
  desert:  { base: 0xd9be7e, light: 0xebd498, dark: 0xb8965a },
  snow:    { base: 0xe4eaf0, light: 0xf4f8fc, dark: 0xa8b8c4 },
  jungle:  { base: 0x3d6a25, light: 0x5c8c38, dark: 0x254018 },
  beach:   { base: 0xe6d3a3, light: 0xf0e0bc, dark: 0xc4ad7e },
};

const BIOME_OBELISK_COLOR = {
  plains: 0xc8a043,
  forest: 0x8a6230,
  desert: 0xe8c560,
  snow:   0xc0d8e4,
  jungle: 0x4a8a2a,
  beach:  0xb89a6c,
};

// ============================================================
//                       Module state
// ============================================================

let THREE = null;
let scene, camera, renderer, clock, raycaster;
let player, marker;
let user = null;
let running = false;
let canvas = null;

// Camera
let cameraDist = 18;
let cameraYaw = Math.PI * 0.25;
let cameraPitch = Math.PI * 0.34;

// Movement / input
let playerTarget = null;
let joyState = { active: false, x: 0, y: 0 };

// Chunk system
const chunks = new Map();         // "cx,cz" → { mesh, landmarks: [] }
const chunkBuildQueue = [];       // pending chunks to materialize
const terrainMeshes = [];         // flat list for raycasting

// Listener cleanup
let listeners = [];
let resizeRaf = null;

// Pre-allocated colour buffers (avoid GC churn in hot loop)
let cTmp, cBase, cLight, cDark;
let biomeColorCache;              // hex → THREE.Color (lazy)

// ============================================================
//                       Public API
// ============================================================

export async function startWorld(loggedInUser) {
  if (running) return;
  user = loggedInUser;

  showWorldLoading('Cargando el reino…');

  try {
    if (!THREE) {
      const mod = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      THREE = mod;
    }

    initColorCache();
    setupScene();
    setupPlayer();
    setupMarker();
    setupInput();

    clock = new THREE.Clock();
    running = true;

    // Initial chunk load: synchronously build the 7×7 grid around spawn
    // so the player never sees an empty world.
    primeInitialChunks();

    hideWorldLoading();
    animate();
  } catch (err) {
    console.error('World init failed:', err);
    showWorldLoading('Error cargando el mundo: ' + (err.message || 'desconocido'));
  }
}

export function stopWorld() {
  running = false;

  for (const { target, type, fn, opts } of listeners) {
    try { target.removeEventListener(type, fn, opts); } catch {}
  }
  listeners = [];

  // Unload all chunks
  for (const key of Array.from(chunks.keys())) {
    unloadChunk(key);
  }
  chunkBuildQueue.length = 0;
  terrainMeshes.length = 0;

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  if (scene) {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene = null;
  }

  player = marker = camera = clock = null;
  user = null;
  playerTarget = null;

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag) {
    nameTag.classList.add('hidden');
    nameTag.style.display = 'none';
  }
}

// ============================================================
//                  Deterministic noise + biomes
// ============================================================

/**
 * Integer hash → uniform [0, 1). Deterministic, cheap, decent
 * distribution. NOT cryptographic.
 */
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 2D smooth value noise via bilinear-interpolated lattice hash.
 * Range ≈ [0, 1]. Good enough for biome boundaries — we don't need
 * Perlin/Simplex quality here.
 */
function noise2d(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // Smoothstep eases the bilinear interp at lattice borders
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(x0,     y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0,     y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const top = v00 * (1 - sx) + v10 * sx;
  const bot = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bot * sy;
}

/**
 * Biome at world position (x, z). Uses temperature + humidity noise
 * fields offset by big arbitrary numbers so they're independent.
 * Returns one of the BIOMES entries.
 */
function biomeAt(x, z) {
  const t = noise2d(x * BIOME_SCALE + 100.5, z * BIOME_SCALE + 100.5);
  const h = noise2d(x * BIOME_SCALE + 500.5, z * BIOME_SCALE + 500.5);

  if (t < 0.25) return BIOMES.snow;
  if (t > 0.78) return h < 0.42 ? BIOMES.desert : BIOMES.jungle;
  if (h > 0.62) return BIOMES.forest;
  if (h < 0.22) return BIOMES.beach;
  return BIOMES.plains;
}

function biomeName(b) {
  for (const [k, v] of Object.entries(BIOMES)) if (v === b) return k;
  return 'plains';
}

// ============================================================
//                       Scene setup
// ============================================================

function setupScene() {
  canvas = document.getElementById('worldCanvas');
  if (!canvas) throw new Error('No #worldCanvas element in DOM');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    FOG_FAR + 50
  );

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  raycaster = new THREE.Raycaster();

  const sun = new THREE.DirectionalLight(0xffeecc, 1.0);
  sun.position.set(-30, 50, 20);
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0x6088a0, 0.55);
  scene.add(ambient);
}

function initColorCache() {
  cTmp   = new THREE.Color();
  cBase  = new THREE.Color();
  cLight = new THREE.Color();
  cDark  = new THREE.Color();
  biomeColorCache = new Map();
}

// ============================================================
//                       Player setup
// ============================================================

function setupPlayer() {
  const geom = new THREE.CapsuleGeometry(0.4, 0.9, 4, 12);
  const mat = new THREE.MeshLambertMaterial({
    color: PALETTE.player,
    flatShading: true,
  });
  player = new THREE.Mesh(geom, mat);
  player.position.set(0, 0.85, 0);
  scene.add(player);

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag && user) {
    nameTag.textContent = user.username;
    nameTag.classList.remove('hidden');
  }
}

function setupMarker() {
  const geom = new THREE.RingGeometry(0.35, 0.55, 24);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: PALETTE.marker,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  marker = new THREE.Mesh(geom, mat);
  marker.visible = false;
  scene.add(marker);
}

// ============================================================
//                       Chunk system
// ============================================================

function chunkKeyAt(x, z) {
  const cx = Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE);
  return { cx, cz, key: `${cx},${cz}` };
}

function chunkOrigin(cx, cz) {
  // Origin is the SW corner of the chunk; (0,0) chunk is centered on
  // world origin → spawn lands in middle of the central chunk.
  return {
    x: cx * CHUNK_SIZE - CHUNK_SIZE / 2,
    z: cz * CHUNK_SIZE - CHUNK_SIZE / 2,
  };
}

function primeInitialChunks() {
  const { cx, cz } = chunkKeyAt(player.position.x, player.position.z);
  // Synchronously build everything in radius — gets us going with no pop-in
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      loadChunk(cx + dx, cz + dz);
    }
  }
}

function updateChunkLoading(playerX, playerZ) {
  const { cx, cz } = chunkKeyAt(playerX, playerZ);

  // Queue any in-radius chunks that aren't loaded yet (closest first)
  const wants = [];
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      const key = `${ncx},${ncz}`;
      if (!chunks.has(key)) {
        wants.push({ key, cx: ncx, cz: ncz, d: dx * dx + dz * dz });
      }
    }
  }
  wants.sort((a, b) => a.d - b.d);
  for (const w of wants) {
    if (!chunkBuildQueue.find(c => c.key === w.key)) {
      chunkBuildQueue.push(w);
    }
  }

  // Unload chunks outside (radius + 1) to give a small hysteresis buffer
  const limit = RENDER_RADIUS + 1;
  for (const key of Array.from(chunks.keys())) {
    const [kx, kz] = key.split(',').map(Number);
    if (Math.abs(kx - cx) > limit || Math.abs(kz - cz) > limit) {
      unloadChunk(key);
    }
  }
}

/** Build one queued chunk per call. Called from animate(). */
function processChunkQueue() {
  if (chunkBuildQueue.length === 0) return;
  const next = chunkBuildQueue.shift();
  if (chunks.has(next.key)) return;
  loadChunk(next.cx, next.cz);
}

function loadChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunks.has(key)) return;

  const origin = chunkOrigin(cx, cz);

  // ---- Terrain mesh ----
  const geom = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGS, CHUNK_SEGS);
  geom.rotateX(-Math.PI / 2);
  // PlaneGeometry is centered on origin → translate to chunk center
  geom.translate(
    origin.x + CHUNK_SIZE / 2,
    0,
    origin.z + CHUNK_SIZE / 2
  );

  paintChunkVertices(geom);
  geom.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.kind = 'terrain';
  scene.add(mesh);
  terrainMeshes.push(mesh);

  // ---- Landmarks ----
  const landmarks = buildLandmarksForChunk(cx, cz);
  for (const lm of landmarks) scene.add(lm);

  chunks.set(key, { mesh, landmarks });
}

function unloadChunk(key) {
  const chunk = chunks.get(key);
  if (!chunk) return;

  if (chunk.mesh) {
    scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
    const idx = terrainMeshes.indexOf(chunk.mesh);
    if (idx >= 0) terrainMeshes.splice(idx, 1);
  }
  for (const lm of chunk.landmarks || []) {
    scene.remove(lm);
    lm.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  chunks.delete(key);
}

function paintChunkVertices(geom) {
  const vc = geom.attributes.position.count;
  const colors = new Float32Array(vc * 3);

  for (let i = 0; i < vc; i++) {
    const wx = geom.attributes.position.getX(i);
    const wz = geom.attributes.position.getZ(i);

    const biome = biomeAt(wx, wz);
    cBase.setHex(biome.base);
    cLight.setHex(biome.light);
    cDark.setHex(biome.dark);

    // Deterministic per-vertex jitter (so the chunk looks the same
    // every time it's loaded — no flicker on revisit)
    const rng = hash2((wx * 100) | 0, (wz * 100) | 0);
    const v = rng - 0.5;

    cTmp.copy(cBase);
    if (v > 0) cTmp.lerp(cLight, v * 0.85);
    else       cTmp.lerp(cDark,  -v * 0.85);

    colors[i * 3]     = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ============================================================
//                       Landmarks
// ============================================================

function buildLandmarksForChunk(cx, cz) {
  const out = [];

  // ~1 in 9 chunks gets a small obelisk
  const lmRoll = hash2(cx * 7 + 1, cz * 11 + 3);
  if (lmRoll < 0.11) {
    const offX = hash2(cx * 13 + 5, cz * 17 + 9) * (CHUNK_SIZE - 8) + 4;
    const offZ = hash2(cx * 19 + 7, cz * 23 + 11) * (CHUNK_SIZE - 8) + 4;
    const origin = chunkOrigin(cx, cz);
    const wx = origin.x + offX;
    const wz = origin.z + offZ;
    const biome = biomeAt(wx, wz);
    out.push(makeObelisk(wx, wz, BIOME_OBELISK_COLOR[biomeName(biome)]));
  }

  return out;
}

function makeObelisk(x, z, color) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const stoneMat = new THREE.MeshLambertMaterial({
    color: 0x666666,
    flatShading: true,
  });
  const pillarMat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
  });

  // Step base
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), stoneMat);
  base.position.y = 0.2;
  group.add(base);

  const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 2.0), stoneMat);
  step.position.y = 0.6;
  group.add(step);

  // Pillar
  const pillarH = 5.5;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.7, pillarH, 8),
    pillarMat
  );
  pillar.position.y = 0.8 + pillarH / 2;
  group.add(pillar);

  // Crystal top
  const top = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    pillarMat
  );
  top.position.y = 0.8 + pillarH + 0.5;
  top.userData.spin = true;
  group.add(top);

  group.userData.obelisk = true;
  return group;
}

// ============================================================
//                       Input handling
// ============================================================

function addL(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push({ target, type, fn, opts });
}

function setupInput() {
  addL(canvas, 'pointerdown', onCanvasPointerDown);
  addL(canvas, 'contextmenu', e => e.preventDefault());
  addL(window, 'keydown', onKeyDown);

  setupJoystick();
  setupTouchCamera();

  addL(window, 'resize', onResize);
}

function onCanvasPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target !== canvas) return;

  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  // Raycast against ALL loaded chunk meshes
  const hits = raycaster.intersectObjects(terrainMeshes);
  if (hits.length > 0) {
    const p = hits[0].point;
    setPlayerTarget(p.x, p.z);
  }
}

function setPlayerTarget(x, z) {
  playerTarget = { x, z };
  marker.position.set(x, 0.05, z);
  marker.scale.set(1, 1, 1);
  marker.material.opacity = 0.9;
  marker.visible = true;
  marker.userData.spawnTime = clock.getElapsedTime();
}

function onKeyDown(e) {
  if (e.key === 'q' || e.key === 'Q') cameraYaw += 0.15;
  if (e.key === 'e' || e.key === 'E') cameraYaw -= 0.15;
}

function setupJoystick() {
  const joyEl   = document.getElementById('joystick');
  const joyKnob = document.getElementById('joystickKnob');
  if (!joyEl || !joyKnob) return;

  let centerX = 0, centerY = 0;
  const MAX_R = 42;

  function setKnob(dx, dy) {
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function onStart(ev) {
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    const rect = joyEl.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    joyState.active = true;
    update(t.clientX, t.clientY);
  }

  function update(cx, cy) {
    let dx = cx - centerX;
    let dy = cy - centerY;
    const len = Math.hypot(dx, dy);
    if (len > MAX_R) { dx = dx / len * MAX_R; dy = dy / len * MAX_R; }
    setKnob(dx, dy);
    joyState.x = dx / MAX_R;
    joyState.y = dy / MAX_R;
  }

  function onMove(ev) {
    if (!joyState.active) return;
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    update(t.clientX, t.clientY);
  }

  function onEnd() {
    joyState.active = false;
    joyState.x = 0;
    joyState.y = 0;
    setKnob(0, 0);
  }

  addL(joyEl,  'touchstart', onStart, { passive: false });
  addL(joyEl,  'touchmove',  onMove,  { passive: false });
  addL(joyEl,  'touchend',   onEnd);
  addL(joyEl,  'touchcancel', onEnd);
  addL(joyEl,  'mousedown',  onStart);
  addL(window, 'mousemove',  onMove);
  addL(window, 'mouseup',    onEnd);
}

function setupTouchCamera() {
  let active = false;
  let lastMidX = 0, lastMidY = 0;

  addL(canvas, 'touchstart', e => {
    if (e.touches.length === 2) {
      active = true;
      lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  });

  addL(canvas, 'touchmove', e => {
    if (active && e.touches.length === 2) {
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      cameraYaw   += (mx - lastMidX) * 0.005;
      cameraPitch -= (my - lastMidY) * 0.005;
      cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
      lastMidX = mx;
      lastMidY = my;
    }
  }, { passive: false });

  addL(canvas, 'touchend', e => {
    if (e.touches.length < 2) active = false;
  });
}

// ============================================================
//                       Animation loop
// ============================================================

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);

  updatePlayer(dt);
  updateChunkLoading(player.position.x, player.position.z);
  processChunkQueue();          // build at most 1 chunk per frame
  updateCamera();
  updateMarker();
  updateObelisks(dt);
  updateNameTag();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  // Joystick takes priority
  if (joyState.active && (Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15)) {
    const len = Math.hypot(joyState.x, joyState.y);
    const speedScale = Math.min(1, len);

    const cosY = Math.cos(cameraYaw);
    const sinY = Math.sin(cameraYaw);
    const wx = joyState.x * cosY - joyState.y * sinY;
    const wz = joyState.x * sinY + joyState.y * cosY;

    player.position.x += wx * PLAYER_SPEED * speedScale * dt;
    player.position.z += wz * PLAYER_SPEED * speedScale * dt;

    if (wx !== 0 || wz !== 0) {
      player.rotation.y = Math.atan2(wx, wz);
    }

    playerTarget = null;
    marker.visible = false;
  } else if (playerTarget) {
    const dx = playerTarget.x - player.position.x;
    const dz = playerTarget.z - player.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.1) {
      playerTarget = null;
      marker.visible = false;
    } else {
      const step = PLAYER_SPEED * dt;
      if (step >= dist) {
        player.position.x = playerTarget.x;
        player.position.z = playerTarget.z;
        playerTarget = null;
        marker.visible = false;
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        player.position.x += nx * step;
        player.position.z += nz * step;
        player.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
  // No bounds — world is infinite.
}

function updateCamera() {
  const r = cameraDist;
  const desiredX = player.position.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * r;
  const desiredY = player.position.y + Math.sin(cameraPitch) * r;
  const desiredZ = player.position.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * r;

  camera.position.set(desiredX, desiredY, desiredZ);
  camera.lookAt(player.position.x, player.position.y + 0.5, player.position.z);
}

function updateMarker() {
  if (!marker.visible) return;
  const t = clock.getElapsedTime() - marker.userData.spawnTime;
  const pulse = 1 + Math.sin(t * 7) * 0.18;
  marker.scale.set(pulse, 1, pulse);
  if (t > 2.0) {
    marker.material.opacity = Math.max(0, 0.9 - (t - 2.0) * 1.8);
    if (marker.material.opacity <= 0) marker.visible = false;
  }
}

function updateObelisks(dt) {
  // Slow spin on every obelisk's crystal top
  for (const { landmarks } of chunks.values()) {
    for (const lm of landmarks || []) {
      lm.traverse(o => {
        if (o.userData.spin) o.rotation.y += dt * 0.5;
      });
    }
  }
}

function updateNameTag() {
  const tag = document.getElementById('playerNameTag');
  if (!tag || tag.classList.contains('hidden')) return;

  const v = new THREE.Vector3(
    player.position.x,
    player.position.y + 1.5,
    player.position.z
  );
  v.project(camera);

  if (v.z > 1 || v.z < -1) {
    tag.style.display = 'none';
    return;
  }

  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;

  tag.style.display = 'block';
  tag.style.left = sx + 'px';
  tag.style.top  = sy + 'px';
}

function onResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

// ============================================================
//                       Loading UI helpers
// ============================================================

function showWorldLoading(text) {
  const el = document.getElementById('worldLoading');
  if (!el) return;
  const t = el.querySelector('.loading-text');
  if (t) t.textContent = text;
  el.classList.remove('hidden');
}

function hideWorldLoading() {
  const el = document.getElementById('worldLoading');
  if (el) el.classList.add('hidden');
}
