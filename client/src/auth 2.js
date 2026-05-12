/**
 * SebasPresent — Auth flow (Slice 3)
 *
 * Wires login / register / logout. On success, drops the user into the world.
 * Slice 3: passes the auth token to world.startWorld so the world module
 * can save/restore the player's position via the /api/position endpoint.
 */
import * as api from './api.js';
import * as ui from './ui.js';
import * as world from './world.js';
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
// ---------- Login flow ----------
export async function handleLogin(event) {
  event.preventDefault();
  const username = ui.els.loginUsername.value.trim();
  const password = ui.els.loginPassword.value;
  const usernameErr = validateUsername(username);
  if (usernameErr) { ui.showError('login', usernameErr); return; }
  const passwordErr = validatePassword(password);
  if (passwordErr) { ui.showError('login', passwordErr); return; }
  ui.setLoading(true, 'Entrando al reino…');
  try {
    const data = await api.login(username, password);
    onAuthenticated(data.user);
  } catch (err) {
    ui.showError('login', err.message || 'Algo salió mal.');
    console.error('login failed:', err);
  } finally {
    ui.setLoading(false);
  }
}
// ---------- Register flow ----------
export async function handleRegister(event) {
  event.preventDefault();
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
  try {
    const data = await api.register(username, password);
    onAuthenticated(data.user);
  } catch (err) {
    ui.showError('register', err.message || 'No se pudo crear la cuenta.');
    console.error('register failed:', err);
  } finally {
    ui.setLoading(false);
  }
}
// ---------- Logout ----------
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
    ui.setLoading(false);
    ui.showScreen('loginScreen');
    if (ui.els.loginUsername) ui.els.loginUsername.value = '';
    if (ui.els.loginPassword) ui.els.loginPassword.value = '';
  }
}
// ---------- On successful auth ----------
function onAuthenticated(user) {
  ui.fadeOutLoginMusic();
  ui.showScreen('worldScreen');
  // Start the world AFTER the screen is visible so the loading veil shows
  // immediately. world.startWorld is async and resolves when the 3D world
  // is fully initialized.
  // Slice 3: pass the auth token so world.js can use it for /api/position.
  const token = api.getToken();
  world.startWorld(user, token).catch(err => {
    console.error('Failed to start world:', err);
  });
}
// ---------- Resume session on app load ----------
export async function tryResumeSession() {
  const token = api.getToken();
  if (!token) return false;
  ui.setLoading(true, 'Restaurando sesión…');
  try {
    const data = await api.me();
    onAuthenticated(data.user);
    return true;
  } catch (err) {
    api.clearToken();
    return false;
  } finally {
    ui.setLoading(false);
  }
}
