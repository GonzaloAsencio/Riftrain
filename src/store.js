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
import { startRecall, reduceRecall } from './engine/recall-progress.js';
import { normalizeDeck } from './engine/deck-combos.js';

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

function replay(deck, index, seed, level, identity, runes, found, status, maxLevel = 12) {
  const generated = createRecallScenario(deck, index, seed, level);
  if (!generated.ok || generated.scenario.identity !== identity ||
      JSON.stringify(generated.scenario.runes) !== JSON.stringify(runes)) return problem('Identidad o runas incompatibles');
  if (!Array.isArray(found) || found.some((cardId) => typeof cardId !== 'string')) return problem('Cartas guardadas inválidas');
  const started = startRecall(generated.scenario, index, { maxLevel });
  if (!started.ok) return problem(started.reason);
  let state = started.state;
  for (const cardId of found) {
    const result = reduceRecall(state, { type: 'name', cardId }, index);
    if (result.kind !== 'accepted') return problem('Carta guardada no pagable, duplicada o fuera del mazo');
    state = result.state;
  }
  if (['next', 'complete'].includes(state.status)) {
    // La ultima pagable ya cerro el nivel al repetirla, pero el snapshot manda: los falsos positivos
    // eran de la sesion y no se guardaron (revision). Un 'active' con todo hallado sólo lo guardaba la
    // version anterior (sin auto-cierre): se restaura abierto y Terminé lo completa.
    if (['review', 'active'].includes(status)) {
      const { nextLevel, ...open } = state;
      state = { ...open, status };
    }
  } else if (status === 'omitted' || (status === 'next' && state.payable.length === 0)) {
    const result = reduceRecall(state, { type: 'skip' }, index);
    if (result.kind !== 'skipped') return problem('Salto incompatible');
    state = result.state;
  } else if (['review', 'next', 'complete'].includes(status)) {
    const result = reduceRecall(state, { type: 'finish' }, index);
    if (!['review', 'finished'].includes(result.kind)) return problem('Cierre incompatible');
    // Los falsos positivos eran de la sesión y no se guardaron: con todas las pagables a la vista
    // el cierre se recalcula como completo, pero el snapshot dice que quedó en revisión.
    state = status === 'review' ? { ...result.state, status: 'review' } : result.state;
  }
  // El maximo se bajo despues de guardar: el nivel que quedo "con siguiente" ahora es el ultimo.
  if (status === 'next' && ['complete', 'omitted'].includes(state.status)) status = state.status;
  if (state.status !== status) return problem('Terminalidad del snapshot incompatible');
  return { ok: true, state };
}

/** Regenera el escenario y repite cada carta; nunca confía en totales ni en semillas ajenas. */
function restoreSnapshot(deck, index, saved, maxLevel) {
  if (!saved || saved.schema !== SCHEMA || !Number.isSafeInteger(saved.seed) ||
      !Number.isSafeInteger(saved.level) || !Array.isArray(saved.history) ||
      saved.history.length !== saved.level - 1) return problem('Snapshot ausente o versión incompatible');
  const result = replay(deck, index, saved.seed, saved.level, saved.identity,
    saved.runes, saved.found, saved.status, maxLevel);
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

export function loadRecallSnapshot(deck, index, { maxLevel = 12 } = {}) {
  return restoreSnapshot(deck, index, load({}).recall, maxLevel);
}

// ---- Ajustes: hasta que nivel se juega y el mazo importado (con sus cartas, para arrancar
// sin el catalogo). Viven en la misma raiz que el progreso y lo legacy, sin pisarlos.
const DEFAULT_SETTINGS = Object.freeze({ maxLevel: 12, deck: null });

function checkSettings(value) {
  if (!value || typeof value !== 'object') return problem('Ajustes inválidos');
  const { maxLevel, deck } = value;
  if (!Number.isSafeInteger(maxLevel) || maxLevel < 1 || maxLevel > 12) return problem('El nivel máximo tiene que ser de 1 a 12');
  if (deck !== null) {
    if (!deck || typeof deck !== 'object' || !Array.isArray(deck.cards) || !deck.deck) return problem('Mazo guardado inválido');
    const normalized = normalizeDeck(deck.deck, deck.cards, { policy: 'positive-energy' });
    if (!normalized.ok) return problem(`Mazo guardado inválido: ${normalized.reason}`);
  }
  return { ok: true, settings: { maxLevel, deck } };
}

export function loadSettings() {
  const root = load({});
  if (!Object.hasOwn(root, 'settings')) return { ok: true, settings: { ...DEFAULT_SETTINGS } };
  const checked = checkSettings(root.settings);
  if (checked.ok) return checked;
  return { ok: false, reason: `No pudimos leer la configuración guardada (${checked.reason}): se usa la de siempre`,
    settings: { ...DEFAULT_SETTINGS } };
}

/** Un mazo distinto empieza de nuevo: el progreso del anterior no se aplica a este. */
export function saveSettings(value) {
  const checked = checkSettings(value);
  if (!checked.ok) return checked;
  const { recall, ...current } = load({});
  const sameDeck = JSON.stringify(current.settings?.deck ?? null) === JSON.stringify(checked.settings.deck);
  const persisted = writeRoot({ ...current, ...(sameDeck && recall ? { recall } : {}), settings: checked.settings });
  return { ok: true, persisted };
}
