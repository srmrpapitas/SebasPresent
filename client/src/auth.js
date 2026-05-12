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
