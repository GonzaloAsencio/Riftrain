/**
 * Persistencia. localStorage con try/catch y fallback en memoria.
 *
 * localStorage tira excepcion en ventana privada, con las cookies bloqueadas, o
 * en un iframe con storage particionado. Si eso rompe la app entera, pierdo el
 * entrenamiento por una configuracion del navegador. Asi que: se intenta, y si
 * no se puede, se sigue en memoria y la sesion funciona igual.
 */

const KEY = 'riftrain.v1';

let memory = null;          // fallback
let usingMemory = false;

function safeGet() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    usingMemory = true;
    return null;
  }
}

function safeSet(value) {
  try {
    window.localStorage.setItem(KEY, value);
    return true;
  } catch {
    usingMemory = true;
    memory = value;
    return false;
  }
}

export function load(fallback) {
  const raw = usingMemory ? memory : safeGet();
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    // Estado corrupto: mejor arrancar limpio que morir en el arranque.
    return fallback;
  }
}

export function save(state) {
  const raw = JSON.stringify(state);
  memory = raw;
  return safeSet(raw);
}

export function clear() {
  memory = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* nada que hacer */ }
}

export function isMemoryOnly() {
  return usingMemory;
}
