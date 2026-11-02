/**
 * Persistencia. localStorage con try/catch y fallback en memoria.
 *
 * localStorage tira excepcion en ventana privada, con las cookies bloqueadas, o
 * en un iframe con storage particionado. Si eso rompe la app entera, pierdo el
 * entrenamiento por una configuracion del navegador. Asi que: se intenta, y si
 * no se puede, se sigue en memoria y la sesion funciona igual.
 */

const KEY = 'riftrain.v1';
import { createRecallScenario } from './engine/recall-scenario.js';
import { startRecallV2, reduceRecallV2 } from './engine/recall-progress.js';

let memory = null;          // fallback
let usingMemory = false;

function safeGet() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    usingMemory = true;
    return memory;
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

function writeRoot(state) {
  try {
    const raw = JSON.stringify(state);
    if (typeof raw !== 'string') return false;
    memory = raw;
    // A failed read means the persisted root is unknown. Never overwrite its legacy fields.
    if (usingMemory) return false;
    return safeSet(raw);
  } catch {
    usingMemory = true;
    return false;
  }
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

export function save(state) {
  const current = load({});
  const { recall: _ignored, ...legacy } = state;
  if (Object.hasOwn(current, 'recall')) legacy.recall = current.recall;
  return writeRoot(legacy);
}

const snapshotHistory = (history) => history.map(({ level, identity, found, omitted }) => ({
  level, identity, found: [...found], omitted,
}));
const problem = (reason) => ({ ok: false, reason });
const SCHEMA = 2;

/**
 * Guarda sólo referencias validables (cardId[]), nunca imágenes ni el objetivo.
 * Los falsos positivos pertenecen al intento en curso: NO se persisten.
 */
export function saveRecallSnapshot(state) {
  if (!state?.scenario?.identity || !Array.isArray(state.found) || !Array.isArray(state.history)) {
    return problem('Snapshot de recall inválido');
  }
  let recall;
  try {
    const { seed, level, identity, runes } = state.scenario;
    recall = { schema: SCHEMA, seed, level, identity, runes, status: state.status,
      found: [...state.found], history: snapshotHistory(state.history) };
    JSON.stringify(recall);
  } catch {
    return problem('No se pudo serializar el snapshot de recall');
  }
  const persisted = writeRoot({ ...load({}), recall });
  return { ok: true, persisted, ...(persisted ? {} : { warning: 'Sólo en memoria: no se garantiza continuidad' }) };
}

function replay(deck, index, seed, level, identity, runes, found, status) {
  const generated = createRecallScenario(deck, index, seed, level);
  if (!generated.ok || generated.scenario.identity !== identity ||
      JSON.stringify(generated.scenario.runes) !== JSON.stringify(runes)) return problem('Identidad o runas incompatibles');
  if (!Array.isArray(found) || found.some((cardId) => typeof cardId !== 'string')) return problem('Cartas guardadas inválidas');
  const started = startRecallV2(generated.scenario, index);
  if (!started.ok) return problem(started.reason);
  let state = started.state;
  for (const cardId of found) {
    const result = reduceRecallV2(state, { type: 'name', cardId }, index);
    if (result.kind !== 'accepted') return problem('Carta guardada no pagable, duplicada o fuera del mazo');
    state = result.state;
  }
  if (status === 'omitted' || (status === 'next' && state.payable.length === 0)) {
    const result = reduceRecallV2(state, { type: 'skip' }, index);
    if (result.kind !== 'skipped') return problem('Salto incompatible');
    state = result.state;
  } else if (['review', 'next', 'complete'].includes(status)) {
    const result = reduceRecallV2(state, { type: 'finish' }, index);
    if (!['review', 'finished'].includes(result.kind)) return problem('Cierre incompatible');
    // Los falsos positivos eran de la sesión y no se guardaron: con todas las pagables a la vista
    // el cierre se recalcula como completo, pero el snapshot dice que quedó en revisión.
    state = status === 'review' ? { ...result.state, status: 'review' } : result.state;
  }
  if (state.status !== status) return problem('Terminalidad del snapshot incompatible');
  return { ok: true, state };
}

/** Regenera el escenario y repite cada carta; nunca confía en totales ni en semillas ajenas. */
function restoreSnapshot(deck, index, saved) {
  if (!saved || saved.schema !== SCHEMA || !Number.isSafeInteger(saved.seed) ||
      !Number.isSafeInteger(saved.level) || !Array.isArray(saved.history) ||
      saved.history.length !== saved.level - 1) return problem('Snapshot ausente o versión incompatible');
  const result = replay(deck, index, saved.seed, saved.level, saved.identity,
    saved.runes, saved.found, saved.status);
  if (!result.ok) return result;
  const history = [];
  for (const item of saved.history) {
    if (!item || !Number.isSafeInteger(item.level) || item.level >= saved.level ||
        item.level !== history.length + 1 || typeof item.omitted !== 'boolean') return problem('Historial incompatible');
    const earlier = createRecallScenario(deck, index, saved.seed, item.level);
    if (!earlier.ok) return problem('Escenario anterior inválido');
    const check = replay(deck, index, saved.seed, item.level, item.identity,
      earlier.scenario.runes, item.found, 'next');
    if (!check.ok || item.omitted !== (check.state.payable.length === 0)) return problem('Historial incompatible');
    history.push({ level: item.level, identity: item.identity, found: check.state.found, omitted: item.omitted });
  }
  result.state.history = history;
  return result;
}

export function loadRecallSnapshot(deck, index) {
  return restoreSnapshot(deck, index, load({}).recall);
}
