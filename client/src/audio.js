/**
 * SebasPresent — Audio module (Sesión 13)
 *
 * Gestor centralizado de SFX y música ambient.
 *
 * Cómo se usa desde otros módulos:
 *   import * as audio from './audio.js';
 *   audio.init();                        // 1 vez al inicio
 *   audio.sfx('ui_click');               // dispara un SFX
 *   audio.sfx('step', { pitch: 0.95 }); // step alterna entre step_00..04
 *   audio.music('forest');               // arranca música forest (fade in)
 *   audio.music(null);                   // fade out + stop
 *   audio.setMasterVolume(0.5);
 *   audio.toggleMute();
 *
 * Tres categorías de volumen (todas multiplicadas por master):
 *   - sfxVolume   (default 0.6)
 *   - musicVolume (default 0.35)
 *   - uiVolume    (default 0.5)
 *
 * Persistencia: las preferencias (master/sfx/music/mute) se guardan en
 * localStorage con la key 'sp_audio_prefs'.
 *
 * Importante en iOS:
 *   - Safari NO permite reproducir audio hasta que haya UN gesto humano
 *     (click/touch). Por eso el primer audio se "encola" si la AudioContext
 *     está suspended, y se reproduce en cuanto el user toca algo.
 *   - Mantener tamaños de archivo razonables (ogg para SFX, mp3 para música).
 */

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

// ============================================================
// Catálogo de SFX disponibles en R2 (audio/sfx/*.ogg)
// ============================================================
// El cliente solo precarga las claves listadas aquí. Las claves con
// múltiples archivos ([['step_00','step_01',...]]) eligen uno al azar.
const SFX_DEFS = {
  // UI
  ui_click:     { url: 'ui_click.ogg',     category: 'ui'  },
  ui_tab:       { url: 'ui_tab.ogg',       category: 'ui'  },

  // Movement
  step:         { variants: ['step_00.ogg', 'step_01.ogg', 'step_02.ogg', 'step_03.ogg', 'step_04.ogg'], category: 'sfx' },

  // Doors / interiors
  door_open:    { url: 'door_open.ogg',    category: 'sfx' },
  door_close:   { url: 'door_close.ogg',   category: 'sfx' },
  door_creak:   { url: 'door_creak.ogg',   category: 'sfx' },

  // Banco
  coins:        { url: 'coins.ogg',        category: 'sfx' },
  pouch:        { url: 'pouch.ogg',        category: 'sfx' },

  // Inventory
  item_grab:    { url: 'item_grab.ogg',    category: 'ui'  },
  item_drop:    { url: 'item_drop.ogg',    category: 'sfx' },

  // Books / magic
  book_open:    { url: 'book_open.ogg',    category: 'sfx' },
  book_flip:    { url: 'book_flip.ogg',    category: 'ui'  },
  book_close:   { url: 'book_close.ogg',   category: 'sfx' },

  // Combat / skilling (preparados para sesiones futuras)
  hit_blade:    { url: 'hit_blade.ogg',    category: 'sfx' },
  equip_weapon: { url: 'equip_weapon.ogg', category: 'sfx' },
  wc_chop:      { url: 'wc_chop.ogg',      category: 'sfx' },
  cook_pot:     { url: 'cook_pot.ogg',     category: 'sfx' },
};

// ============================================================
// Catálogo de música (audio/music/*.mp3)
// ============================================================
const MUSIC_DEFS = {
  forest:   { url: 'music_forest.mp3', loop: true  },
  plaza:    { url: 'music_plaza.mp3',  loop: true  },
  level_up: { url: 'level_up.mp3',     loop: false },  // jingle one-shot
};

// ============================================================
// Mapping bioma → música ambient
// ============================================================
// Si añades más músicas en R2, simplemente añade aquí. Biomas no listados
// usan la música del bioma por defecto (plaza).
const BIOME_MUSIC = {
  plaza:      'plaza',
  forest:     'forest',
  plains:     'plaza',    // sin tema propio → plaza
  desert:     'plaza',    // sin tema propio → plaza
  snow:       'forest',   // reutilizamos forest como winter (suena bien)
  swamp:      'forest',
  jungle:     'forest',
  beach:      'plaza',
  wilderness: 'forest',   // sin tema propio
};

// ============================================================
// Estado del módulo
// ============================================================
const PREFS_KEY = 'sp_audio_prefs';
const DEFAULT_PREFS = {
  master: 0.7,
  sfx: 0.6,
  // Sesión 32 — bajado de 0.035 a 0.007 (80% menos) por feedback de Nico.
  // La música ambient debe sentirse "de fondo", no competir con SFX.
  music: 0.007,
  ui: 0.5,
  muted: false,
};

let initialized = false;
let prefs = { ...DEFAULT_PREFS };
let audioContext = null;        // Web Audio API context (para SFX bajo latencia)
let sfxBuffers = new Map();     // name → AudioBuffer (decoded)
let musicAudio = null;          // <audio> element para música (streamable)
let musicCurrentName = null;
let musicFadeTimer = null;
let pendingFirstPlay = [];      // SFX que intentaron sonar antes del gesto humano
let unlockListenerAttached = false;
let lastStepTime = 0;

// ============================================================
// API pública: lifecycle
// ============================================================

/** Inicializa. Llamar 1 vez al cargar la app. Idempotente. */
export function init() {
  if (initialized) return;
  initialized = true;
  loadPrefs();
  // No creamos AudioContext aquí — Safari lo bloquea hasta gesto humano.
  // Se crea en el primer ensureAudioContext() tras el primer touch.
  attachUnlockListener();
  // Precargar SFX en background (no bloquea)
  preloadSfx().catch(err => console.warn('[audio] preload error:', err));
  console.log('[audio] init OK');
}

/** Reproduce un SFX por nombre. opts.pitch (0.8-1.2), opts.volume (0-1) */
export function sfx(name, opts = {}) {
  if (!initialized) init();
  // Sesión 13 v2 — Mute NO afecta a SFX (solo a música). Los pasos,
  // puertas, monedas, etc. siempre suenan.
  const def = SFX_DEFS[name];
  if (!def) {
    console.warn(`[audio] sfx '${name}' no definido`);
    return;
  }
  // Elegir variant al azar si es array
  const fileKey = def.variants
    ? def.variants[Math.floor(Math.random() * def.variants.length)]
    : def.url;
  const bufferKey = fileKey;
  const buffer = sfxBuffers.get(bufferKey);
  if (!buffer) {
    // Buffer aún no cargado o falló. Encolarlo para reintento.
    if (pendingFirstPlay.length < 10) pendingFirstPlay.push({ name, opts });
    return;
  }
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.pitch || 1.0;
    const gain = ctx.createGain();
    const catVol = def.category === 'ui' ? prefs.ui : prefs.sfx;
    gain.gain.value = (opts.volume ?? 1.0) * catVol * prefs.master;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  } catch (err) {
    console.warn(`[audio] sfx '${name}' play error:`, err);
  }
}

// Sesión 13 — Tracking de fades activos para poder cancelarlos.
// Cuando el user ajusta el slider de música, si hay un fade en curso
// (cambio de bioma) sobreescribiría el nuevo valor cada 30ms.
let activeMusicFade = null;

// Sesión 13 — iOS Safari rechaza permanentemente el audio si intentas
// reproducir ANTES del primer touch del usuario. Diferimos la primera
// música hasta que `unlock` se haya ejecutado.
let audioUnlocked = false;
let pendingMusicName = null;

/** Cambia la música ambient. Pasar null para parar. Hace fade entre temas. */
export function music(name) {
  if (!initialized) init();
  if (musicCurrentName === name) return;       // ya está sonando
  musicCurrentName = name;
  if (musicFadeTimer) { clearInterval(musicFadeTimer); musicFadeTimer = null; }

  // Si el audio context no está desbloqueado aún (no hubo touch humano),
  // guardar la música pendiente y arrancarla en cuanto haga unlock.
  if (!audioUnlocked) {
    pendingMusicName = name;
    return;
  }

  if (!name) {
    // Fade out + stop
    fadeAudioElement(musicAudio, 0, 800, () => {
      if (musicAudio) { musicAudio.pause(); musicAudio.src = ''; }
    });
    return;
  }
  const def = MUSIC_DEFS[name];
  if (!def) {
    console.warn(`[audio] music '${name}' no definido`);
    return;
  }
  // Sesión 13 v4 — Sin early-return por muted. Si user mutea, prefs.music
  // ya está en 0 y applyMusicVolume pone volumen 0. La música igualmente
  // se carga y reproduce silenciosa, lista para subir volumen luego.

  // Crear elemento nuevo (más simple que reusar el existente)
  const newAudio = new Audio(`${R2_BASE}/audio/music/${def.url}`);
  newAudio.loop = def.loop;
  newAudio.volume = 0;
  newAudio.preload = 'auto';

  // Fade out anterior + fade in nuevo
  const oldAudio = musicAudio;
  musicAudio = newAudio;
  newAudio.play().catch(err => {
    // Safari bloqueo improbable aquí porque ya tenemos unlock, pero por si acaso
    console.log('[audio] music play deferred:', err.message);
    pendingMusicName = name;
    musicCurrentName = null;
  });
  fadeAudioElement(newAudio, prefs.music * prefs.master, 1200);
  if (oldAudio) {
    fadeAudioElement(oldAudio, 0, 800, () => { oldAudio.pause(); oldAudio.src = ''; });
  }
}

/** Conveniencia: música según bioma actual.
 *
 * Sesión 36 — Guard de mute. Si el user muteó (botón 🔇 → prefs.muted=true)
 * O bajó manualmente el volumen a 0 (setMusicVolume(0) o setMasterVolume(0)),
 * NO arrancamos música nueva. Antes esta función cargaba el Audio element y
 * lo reproducía igual (a volumen 0 técnicamente silencioso), pero:
 *   1. En iOS, crear/play/destroy de Audio elements repetidos causa hiccups
 *      audibles aún a volumen 0 (lo que Nico reportó como "vuelve la música").
 *   2. Hay 3 call sites de esta función en world.js (init, region-change,
 *      exit-interior). Garantizar el guard acá los cubre todos sin
 *      duplicar la chequera de mute en cada call site.
 *
 * Caveat: si el user toggle-mutea OFF mientras NO hay música cargada
 * (porque se la skipeamos antes), la música no resume sola. El handler del
 * botón 🔇 en world.js llama musicForBiome explícitamente al desmutear para
 * cubrir ese caso.
 */
export function musicForBiome(biomeId) {
  if (prefs.muted) return;
  if ((prefs.music ?? 0) * (prefs.master ?? 0) === 0) return;
  const themeName = BIOME_MUSIC[biomeId];
  if (themeName) music(themeName);
}

/** SFX especial: jingle de level up (one-shot, no como música loop). */
export function playLevelUp() {
  if (!initialized) init();
  if (prefs.muted) return;
  const audio = new Audio(`${R2_BASE}/audio/music/level_up.mp3`);
  audio.volume = prefs.music * prefs.master * 0.9;
  audio.play().catch(err => console.log('[audio] levelup deferred:', err.message));
}

/** SFX de paso con throttle automático para que no se solapen. */
export function step() {
  const now = performance.now();
  if (now - lastStepTime < 220) return;   // mínimo 220ms entre pasos
  lastStepTime = now;
  sfx('step', { pitch: 0.92 + Math.random() * 0.16 });
}

// ============================================================
// API pública: settings
// ============================================================

export function setMasterVolume(v) {
  prefs.master = clamp01(v);
  // Si está muteado, mover el slider lo desmutea automáticamente.
  // Si no fuera así, el slider parecería que "no hace nada".
  if (prefs.muted && v > 0) prefs.muted = false;
  savePrefs();
  cancelMusicFade();
  applyMusicVolume();
  // Si la música estaba pausada por mute, reanudarla
  if (musicAudio && musicAudio.paused && musicAudio.src && !prefs.muted) {
    musicAudio.play().catch(() => {});
  }
}
export function setSfxVolume(v)   {
  prefs.sfx = clamp01(v);
  if (prefs.muted && v > 0) prefs.muted = false;
  savePrefs();
}
export function setMusicVolume(v) {
  prefs.music = clamp01(v);
  if (prefs.muted && v > 0) prefs.muted = false;
  savePrefs();
  cancelMusicFade();
  applyMusicVolume();
  if (musicAudio && musicAudio.paused && musicAudio.src && !prefs.muted) {
    musicAudio.play().catch(() => {});
  }
}
export function setUiVolume(v)    {
  prefs.ui = clamp01(v);
  if (prefs.muted && v > 0) prefs.muted = false;
  savePrefs();
}

export function toggleMute() {
  // Sesión 13 v5 — Mute hace dos cosas para garantizar silencio en iOS:
  //   1. prefs.music = 0 (para que applyMusicVolume baje volumen)
  //   2. musicAudio.pause() (para que iOS no siga reproduciendo)
  // Al desmutear: prefs.music vuelve a 0.15 y resume().
  cancelMusicFade();
  if (!prefs.muted) {
    // Mutear
    prefs.muted = true;
    prefs.music = 0;
    if (musicAudio) {
      musicAudio.volume = 0;
      try { musicAudio.pause(); } catch {}
    }
  } else {
    // Desmutear
    prefs.muted = false;
    prefs.music = 0.035;
    if (musicAudio) {
      musicAudio.volume = prefs.music * prefs.master;
      if (musicAudio.src && musicAudio.paused) {
        musicAudio.play().catch(err => console.log('[audio] resume failed:', err.message));
      }
    }
  }
  savePrefs();
  return prefs.muted;
}
export function isMuted() { return prefs.muted; }
export function getPrefs() { return { ...prefs }; }

function cancelMusicFade() {
  if (activeMusicFade) {
    clearInterval(activeMusicFade);
    activeMusicFade = null;
  }
}

// ============================================================
// Internals
// ============================================================

function clamp01(v) { return Math.max(0, Math.min(1, v || 0)); }

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  // Sesión 32 — cap defensivo del volumen de música. Si el user tenía un
  // valor guardado en localStorage de antes (cuando el default era más
  // alto), recapear al nuevo máximo. Sin esto, el cambio de DEFAULT_PREFS
  // no surte efecto para users existentes.
  const MUSIC_CAP = 0.01;  // 1% del max — ambient muy de fondo
  if (prefs.music > MUSIC_CAP) {
    prefs.music = MUSIC_CAP;
    savePrefs();
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function ensureAudioContext() {
  if (audioContext) return audioContext;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
    return audioContext;
  } catch (err) {
    console.warn('[audio] No se pudo crear AudioContext:', err);
    return null;
  }
}

async function preloadSfx() {
  // Listar todos los archivos físicos a precargar (resolviendo variants)
  const files = new Set();
  for (const def of Object.values(SFX_DEFS)) {
    if (def.variants) def.variants.forEach(v => files.add(v));
    else files.add(def.url);
  }
  // Cargar y decodificar (lazy: el AudioContext se crea sólo cuando hay
  // gesto humano; pero podemos descargar los buffers binarios YA).
  await Promise.all([...files].map(async file => {
    try {
      const url = `${R2_BASE}/audio/sfx/${file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      // Decode necesita AudioContext. Si no existe aún, lo creamos temporal
      // (algunos browsers permiten OfflineAudioContext sin gesto). Si falla,
      // guardamos el arrayBuffer y se decodifica en el primer gesto.
      const ctx = ensureAudioContext();
      if (ctx) {
        try {
          const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
          sfxBuffers.set(file, buffer);
        } catch (err) {
          // Decode falló — guardar raw para retry en unlock
          sfxBuffers.set(file, { _raw: arrayBuf });
        }
      } else {
        sfxBuffers.set(file, { _raw: arrayBuf });
      }
    } catch (err) {
      console.warn(`[audio] preload '${file}' falló:`, err.message);
    }
  }));
  console.log(`[audio] precargados ${sfxBuffers.size}/${files.size} SFX`);
}

function attachUnlockListener() {
  if (unlockListenerAttached) return;
  unlockListenerAttached = true;
  // Cualquier interacción humana → desbloquear AudioContext y decodificar
  // los SFX que llegaron como raw.
  const unlock = async () => {
    const ctx = ensureAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }
      // Decodificar pendientes
      for (const [file, val] of sfxBuffers.entries()) {
        if (val && val._raw) {
          try {
            const buf = await ctx.decodeAudioData(val._raw);
            sfxBuffers.set(file, buf);
          } catch (err) {
            console.warn(`[audio] decode '${file}' falló:`, err.message);
          }
        }
      }
      // Re-disparar SFX que se intentaron antes del unlock
      const queued = pendingFirstPlay.splice(0);
      for (const q of queued) sfx(q.name, q.opts);
    }

    // Sesión 13 v4 — Marcar audio desbloqueado y arrancar música pendiente.
    // Sin chequear muted: si user muteó, prefs.music=0 y la música arranca
    // silenciosa pero arranca (puede subir volumen luego).
    audioUnlocked = true;
    if (pendingMusicName) {
      const toPlay = pendingMusicName;
      pendingMusicName = null;
      musicCurrentName = null;
      music(toPlay);
    }

    // Una sola vez es suficiente
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
    console.log('[audio] unlock done — audioUnlocked=true');
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function fadeAudioElement(audioEl, targetVol, durationMs, onDone) {
  if (!audioEl) { if (onDone) onDone(); return; }
  const startVol = audioEl.volume;
  const t0 = performance.now();
  const tick = () => {
    const elapsed = performance.now() - t0;
    const t = Math.min(1, elapsed / durationMs);
    audioEl.volume = startVol + (targetVol - startVol) * t;
    if (t >= 1) {
      clearInterval(timer);
      if (audioEl === musicAudio && activeMusicFade === timer) {
        activeMusicFade = null;
      }
      if (onDone) onDone();
    }
  };
  const timer = setInterval(tick, 30);
  // Registrar el fade activo solo si afecta al musicAudio actual.
  // Esto permite al user cancelarlo arrastrando el slider de música/master.
  if (audioEl === musicAudio) {
    activeMusicFade = timer;
  }
}

function applyMusicVolume() {
  if (!musicAudio) return;
  const newVol = prefs.music * prefs.master;
  musicAudio.volume = newVol;
}
