/**
 * SebasPresent — Build version (Sesión 31)
 *
 * Única fuente de verdad para la versión del cliente. Si se ve algo distinto
 * a esto en el HUD esquina sup-izq, es que la cache del navegador está sirviendo
 * código viejo (uno de los problemas crónicos de S30 — "asumí que se había
 * deployado" / "asumí que la cache estaba invalidada").
 *
 * Bump este número cada vez que cambien archivos del cliente. El servidor
 * eventualmente expondrá /api/_debug/version para poder comparar.
 *
 * Format: 'NN.M[-pre]'
 *   NN: número de sesión (S31 → 31)
 *   M:  iteración dentro de la sesión
 *   pre: 'dev' antes del cierre, vacío al cerrar la sesión
 */
export const BUILD = '33.4-dev';

/** Fecha del último cambio mayor — informativa, no se compara con server. */
export const BUILD_DATE = '2026-05-21';

/** Versión del schema mínimo del cliente. Si el server expone una más alta
 *  estamos sirviendo cliente viejo. Bump cuando cambien contratos. */
export const CLIENT_SCHEMA = 1;
