/**
 * SebasPresent — Auth flow (Slice 4b)
 *
 * Wires login / register / logout. On success, drops the user into the world
 * and initializes the inventory + bank.
 */
import * as api from './api.js';
import * as ui from './ui.js';
import * as world from './world.js';
import * as inventory from './inventory.js';
import * as bank from './bank.js';
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
function validateUsername(username) {
  if (!username) return 'Pon un nombre de usuario.';
  if (!USERNAME_REGEX.test(username)) {
    return 'Nombre: 3-16 caracteres, letras / números / guión bajo.';
  }
  return null;
}
function validatePassword(password) {
  if (!password) return 'Pon una contraseña.';
  if (password.length < 6) return 'Mínimo 6 caracteres.';
  return null;
}
// Sesión 51 — evita entrar dos veces (la tecla "Ir" del teclado del móvil
// también envía el formulario aunque la pantalla de carga tape el botón)
let authBusy = false;

export async function handleLogin(event) {
  event.preventDefault();
  if (authBusy) return;
  const username = ui.els.loginUsername.value.trim();
  const password = ui.els.loginPassword.value;
  const usernameErr = validateUsername(username);
  if (usernameErr) { ui.showError('login', usernameErr); return; }
  const passwordErr = validatePassword(password);
  if (passwordErr) { ui.showError('login', passwordErr); return; }
  ui.setLoading(true, 'Entrando a la isla…');
  authBusy = true;
  try {
    const data = await api.login(username, password);
    onAuthenticated(data.user);
  } catch (err) {
    ui.showError('login', err.message || 'Algo salió mal.');
    console.error('login failed:', err);
  } finally {
    authBusy = false;
    ui.setLoading(false);
  }
}
export async function handleRegister(event) {
  event.preventDefault();
  if (authBusy) return;
  const username = ui.els.regUsername.value.trim();
  const password = ui.els.regPassword.value;
  const confirm  = ui.els.regPasswordConfirm.value;
  const usernameErr = validateUsername(username);
  if (usernameErr) { ui.showError('register', usernameErr); return; }
  const passwordErr = validatePassword(password);
  if (passwordErr) { ui.showError('register', passwordErr); return; }
  if (password !== confirm) {
    ui.showError('register', 'Las contraseñas no coinciden.');
    return;
  }
  ui.setLoading(true, 'Creando tu cuenta…');
  authBusy = true;
  try {
    const data = await api.register(username, password);
    onAuthenticated(data.user);
  } catch (err) {
    ui.showError('register', err.message || 'No se pudo crear la cuenta.');
    console.error('register failed:', err);
  } finally {
    authBusy = false;
    ui.setLoading(false);
  }
}
export async function handleLogout() {
  ui.setLoading(true, 'Saliendo…');
  try {
    world.stopWorld();
  } catch (err) {
    console.warn('stopWorld error (non-fatal):', err);
  }
  try {
    await api.logout();
  } finally {
    // Sesión 51 — recargar la página: así no queda NADA de la sesión anterior
    // (mochila, equipo, misiones, temporizadores, conexiones…). Antes, al
    // entrar con otra cuenta sin recargar se veían cosas de la anterior.
    try { location.reload(); return; } catch {}
    ui.setLoading(false);
    ui.showScreen('loginScreen');
    if (ui.els.loginUsername) ui.els.loginUsername.value = '';
    if (ui.els.loginPassword) ui.els.loginPassword.value = '';
  }
}
function onAuthenticated(user) {
  ui.fadeOutLoginMusic();
  ui.showScreen('worldScreen');
  const token = api.getToken();
  world.startWorld(user, token).catch(err => {
    console.error('Failed to start world:', err);
  });
  // Slice 4a: inventory en paralelo con world
  inventory.init().catch(err => {
    console.error('Failed to init inventory:', err);
  });
  // Slice 4b: bank en paralelo tambien
  bank.init().catch(err => {
    console.error('Failed to init bank:', err);
  });
}
let resumeError = null;
/** Sesión 51 — mensaje del último intento fallido de recuperar la sesión (o null). */
export function lastResumeError() { return resumeError; }
export async function tryResumeSession() {
  resumeError = null;
  const token = api.getToken();
  if (!token) return false;
  ui.setLoading(true, 'Restaurando sesión…');
  try {
    const data = await api.me();
    onAuthenticated(data.user);
    return true;
  } catch (err) {
    // Sesión 51 — solo se olvida la sesión si el servidor dice que no vale.
    // Sin conexión o con el servidor descansando, se guarda (antes había que
    // volver a escribir la contraseña cada vez que fallaba la red).
    if (err?.status === 401 || err?.status === 404 || err?.code === 'unauthorized' || err?.code === 'user_not_found') {
      api.clearToken();
    } else {
      resumeError = err?.code === 'daily_cap'
        ? 'El servidor descansa hasta las 02:00. Vuelve más tarde.'
        : 'No se pudo conectar con el servidor. Toca "Entrar" para reintentar.';
    }
    return false;
  } finally {
    ui.setLoading(false);
  }
}
