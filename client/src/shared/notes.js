/**
 * SebasPresent — Notas de banco (Sesión 50)
 *
 * Como en OSRS: los objetos que no se apilan (minerales, troncos, pescado,
 * armaduras...) se pueden sacar del banco como NOTAS, que sí se apilan en
 * un solo hueco de la mochila. Sirven para llevar muchos al GE o
 * cambiarlos; en cualquier cofre/banco se vuelven a convertir en objetos.
 *
 * id de la nota = `${item_id}_note` (fila en items con stackable = 1).
 */
export const NOTE_SUFFIX = '_note';
export const isNote = (id) => typeof id === 'string' && id.endsWith(NOTE_SUFFIX);
export const baseOfNote = (id) => (isNote(id) ? id.slice(0, -NOTE_SUFFIX.length) : id);
export const noteOf = (id) => `${id}${NOTE_SUFFIX}`;
