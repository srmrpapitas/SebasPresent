/**
 * SebasPresent — World module (Slice 2)
 *
 * Everything that makes the 3D world in one file:
 *  - Scene, camera, renderer, lighting
 *  - Terrain mesh with vertex colors (OSRS technique — no textures)
 *  - Player capsule (placeholder until Slice 3 brings the real character)
 *  - Click-to-move with raycasting + visual marker
 *  - Virtual joystick for mobile touch
 *  - Camera rotation (Q/E on desktop, swipe on mobile)
 *  - Animation loop, resize handling, cleanup
 *
 * Imports Three.js dynamically from jsDelivr so login stays fast.
 */

// ---------- Palette ----------
// One source of truth for the colors. Matches the OSRS aesthetic we
// chose earlier: saturated greens, dirt browns, pale sky.
const PALETTE = {
  sky:        0x9ec0d6,
  fog:        0xa8c4d8,
  grass:      0x6b9e3a,
  grassDark:  0x4e7626,
  grassLight: 0x88b850,
  path:       0xa08055,
  pathDark:   0x7a5d3a,
  water:      0x4a7896,
  player:     0xc04a3a,
  marker:     0xfff04a,
};

const WORLD_SIZE = 80;       // 80m × 80m playable area
const WORLD_SEGS = 80;       // 1m per terrain cell
const PLAYER_SPEED = 5.0;    // m/s

// ---------- Module state ----------
let THREE = null;            // lazily imported
let scene, camera, renderer, clock, raycaster;
let terrain, player, marker;
let user = null;
let running = false;
let canvas = null;
let cameraDist = 13;
let cameraYaw = Math.PI * 0.25;
let cameraPitch = Math.PI * 0.32;
let playerTarget = null;
let joyState = { active: false, x: 0, y: 0 };
let listeners = [];          // collected so we can clean up
let resizeRaf = null;

// ---------- Public API ----------

/**
 * Initialize and start the 3D world. Called after successful login.
 * @param {{id:number, username:string, created_at:number}} loggedInUser
 */
export async function startWorld(loggedInUser) {
  if (running) return;
  user = loggedInUser;

  showWorldLoading('Cargando el reino…');

  try {
    // Lazy-load Three.js so login is fast for users who never enter the world
    if (!THREE) {
      const mod = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      THREE = mod;
    }

    setupScene();
    setupTerrain();
    setupPlayer();
    setupMarker();
    setupInput();

    clock = new THREE.Clock();
    running = true;

    hideWorldLoading();
    animate();
  } catch (err) {
    console.error('World init failed:', err);
    showWorldLoading('Error cargando el mundo: ' + (err.message || 'desconocido'));
  }
}

/**
 * Tear down the world. Called on logout.
 */
export function stopWorld() {
  running = false;

  // Remove all listeners we registered
  for (const { target, type, fn, opts } of listeners) {
    try { target.removeEventListener(type, fn, opts); } catch {}
  }
  listeners = [];

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  if (scene) {
    // Dispose geometries and materials we created
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene = null;
  }

  terrain = player = marker = camera = clock = null;
  user = null;
  playerTarget = null;

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag) {
    nameTag.classList.add('hidden');
    nameTag.style.display = 'none';
  }
}

// ---------- Scene setup ----------

function setupScene() {
  canvas = document.getElementById('worldCanvas');
  if (!canvas) throw new Error('No #worldCanvas element in DOM');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 35, 75);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  raycaster = new THREE.Raycaster();

  // Lighting: warm sun + cool ambient → that classic OSRS feel
  const sun = new THREE.DirectionalLight(0xffeecc, 1.0);
  sun.position.set(-14, 22, 10);
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0x6088a0, 0.55);
  scene.add(ambient);
}

// ---------- Terrain ----------

function setupTerrain() {
  // Plane with many segments → many vertices to paint
  const geom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, WORLD_SEGS, WORLD_SEGS);
  geom.rotateX(-Math.PI / 2); // lay it flat

  const vertexCount = geom.attributes.position.count;
  const colors = new Float32Array(vertexCount * 3);

  const cGrass     = new THREE.Color(PALETTE.grass);
  const cGrassDark = new THREE.Color(PALETTE.grassDark);
  const cGrassLite = new THREE.Color(PALETTE.grassLight);
  const cPath      = new THREE.Color(PALETTE.path);
  const cPathDark  = new THREE.Color(PALETTE.pathDark);
  const tmp        = new THREE.Color();

  for (let i = 0; i < vertexCount; i++) {
    const x = geom.attributes.position.getX(i);
    const z = geom.attributes.position.getZ(i);

    // Base: grass with random variation. This per-vertex jitter is THE
    // trick that gives OSRS terrain its hand-painted look — neighbouring
    // vertices vary slightly, so the GPU interpolates a soft patchwork.
    const v = (Math.random() - 0.5);
    tmp.copy(cGrass);
    if (v > 0) tmp.lerp(cGrassLite, v * 0.7);
    else       tmp.lerp(cGrassDark, -v * 0.7);

    // A wavy dirt path snaking across the world (centered on z=0)
    const pathCenter = Math.sin(x * 0.12) * 4 + Math.cos(x * 0.07) * 2;
    const pathDist   = Math.abs(z - pathCenter);
    if (pathDist < 2.2) {
      // Smooth falloff — interpolation handles the soft edges for free
      const t = 1 - pathDist / 2.2;
      const pathColor = (Math.random() < 0.5) ? cPath : cPathDark;
      tmp.lerp(pathColor, t * 0.85);
    }

    colors[i * 3]     = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  terrain = new THREE.Mesh(geom, mat);
  terrain.userData.kind = 'terrain';
  scene.add(terrain);
}

// ---------- Player ----------

function setupPlayer() {
  // Capsule placeholder. Slice 3 will replace this with the real Remy model
  // skinned to the FBX animations.
  const geom = new THREE.CapsuleGeometry(0.4, 0.9, 4, 12);
  const mat = new THREE.MeshLambertMaterial({
    color: PALETTE.player,
    flatShading: true,
  });
  player = new THREE.Mesh(geom, mat);
  player.position.set(0, 0.85, 0);
  scene.add(player);

  // Floating name tag (DOM overlay — easier to style than Three.Sprite)
  const nameTag = document.getElementById('playerNameTag');
  if (nameTag && user) {
    nameTag.textContent = user.username;
    nameTag.classList.remove('hidden');
  }
}

// ---------- Click marker ----------

function setupMarker() {
  // Yellow pulsing ring on click, RuneScape style
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

// ---------- Input handling ----------

function addL(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push({ target, type, fn, opts });
}

function setupInput() {
  // ----- Click / tap to move -----
  addL(canvas, 'pointerdown', onCanvasPointerDown);

  // ----- Prevent right-click context menu over the canvas -----
  addL(canvas, 'contextmenu', e => e.preventDefault());

  // ----- Keyboard camera rotation (desktop) -----
  addL(window, 'keydown', onKeyDown);

  // ----- Joystick -----
  setupJoystick();

  // ----- Two-finger swipe to rotate camera (mobile) -----
  setupTouchCamera();

  // ----- Window resize -----
  addL(window, 'resize', onResize);
}

function onCanvasPointerDown(e) {
  // Left button only (touches always report 0)
  if (e.button !== undefined && e.button !== 0) return;
  // Ignore if the touch started on a UI element (joystick etc.)
  if (e.target !== canvas) return;

  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const hits = raycaster.intersectObject(terrain);
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

// ----- Virtual joystick (mobile) -----

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

// ----- Two-finger touch to rotate camera -----

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
      // Clamp pitch so we don't flip upside-down or go underground
      cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
      lastMidX = mx;
      lastMidY = my;
    }
  }, { passive: false });

  addL(canvas, 'touchend', e => {
    if (e.touches.length < 2) active = false;
  });
}

// ---------- Animation loop ----------

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // clamp huge jumps after tab-switch

  updatePlayer(dt);
  updateCamera();
  updateMarker();
  updateNameTag();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  // Joystick movement takes priority over click-to-move
  if (joyState.active && (Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15)) {
    const len = Math.hypot(joyState.x, joyState.y);
    const speedScale = Math.min(1, len);

    // Joystick X = screen right, Y = screen down.
    // Convert to world coords relative to camera yaw so "up" on the joystick
    // means "away from camera" in the world.
    const cosY = Math.cos(cameraYaw);
    const sinY = Math.sin(cameraYaw);
    const inputX = joyState.x;
    const inputZ = joyState.y;
    const wx = inputX * cosY - inputZ * sinY;
    const wz = inputX * sinY + inputZ * cosY;

    player.position.x += wx * PLAYER_SPEED * speedScale * dt;
    player.position.z += wz * PLAYER_SPEED * speedScale * dt;

    if (wx !== 0 || wz !== 0) {
      player.rotation.y = Math.atan2(wx, wz);
    }

    // Joystick cancels click target
    playerTarget = null;
    marker.visible = false;
  } else if (playerTarget) {
    // Click-to-move
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

  // Keep inside world bounds (small inset so capsule doesn't poke past edge)
  const half = WORLD_SIZE / 2 - 1;
  player.position.x = Math.max(-half, Math.min(half, player.position.x));
  player.position.z = Math.max(-half, Math.min(half, player.position.z));
}

function updateCamera() {
  // Spherical-coordinate follow camera. Smoothly tracks the player.
  const r = cameraDist;
  const yaw = cameraYaw;
  const pitch = cameraPitch;

  const desiredX = player.position.x + Math.sin(yaw) * Math.cos(pitch) * r;
  const desiredY = player.position.y + Math.sin(pitch) * r;
  const desiredZ = player.position.z + Math.cos(yaw) * Math.cos(pitch) * r;

  // Snap (no lerp) for now — feels more responsive. Add smoothing in polish.
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

function updateNameTag() {
  const tag = document.getElementById('playerNameTag');
  if (!tag || tag.classList.contains('hidden')) return;

  // Project player head position into screen space
  const v = new THREE.Vector3(
    player.position.x,
    player.position.y + 1.5,
    player.position.z
  );
  v.project(camera);

  // Behind camera or out of frustum → hide
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
  // Debounce via rAF — Safari fires resize many times during rotation
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

// ---------- Loading UI helpers ----------

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
