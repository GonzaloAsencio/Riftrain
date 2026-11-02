/**
 * Persistencia. localStorage con try/catch y fallback en memoria.
 *
 * localStorage tira excepcion en ventana privada, con las cookies bloqueadas, o
 * en un iframe con storage particionado. Si eso rompe la app entera, pierdo el
 * entrenamiento por una configuracion del navegador. Asi que: se intenta, y si
 * no se puede, se sigue en memoria y la sesion funciona igual.
 */

const KEY = 'riftrain.v1';
import { countGroups, validateGroup } from './engine/deck-combos.js';
import { createRecallScenario } from './engine/recall-scenario.js';
import { startRecall, reduceRecall } from './engine/recall-progress.js';

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

const pairs = (found) => found.map(({ group }) => group.map(({ cardId, qty }) => [cardId, qty]));
const snapshotHistory = (history) => history.map(({ level, identity, found, omitted }) => ({
  level, identity, found: pairs(found), omitted,
}));
const problem = (reason) => ({ ok: false, reason });

/** Keep legacy root untouched; persist only validated references, never images or targets. */
export function saveRecallSnapshot(state) {
  if (!state?.scenario?.identity || !Array.isArray(state.found) || !Array.isArray(state.history)) {
    return problem('Snapshot de recall inválido');
  }
  let recall;
  try {
    const { seed, level, identity, runes } = state.scenario;
    recall = { schema: 1, seed, level, identity, runes, status: state.status,
      found: pairs(state.found), history: snapshotHistory(state.history) };
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
  const target = countGroups(index, generated.scenario.runes);
  if (target.status !== 'exact' || !Array.isArray(found)) return problem('Objetivo o grupos inválidos');
  let state = startRecall(generated.scenario, index, target).state;
  for (const group of found) {
    if (!Array.isArray(group) || !group.length || group.some((pair) => !Array.isArray(pair) || pair.length !== 2)) {
      return problem('Grupo guardado inválido');
    }
    const entries = group.map(([cardId, qty]) => ({ cardId, qty }));
    const check = validateGroup(entries, generated.scenario, index);
    if (!check.ok) return problem('Grupo guardado no pagable o fuera del mazo');
    const result = reduceRecall(state, { type: 'confirm', entries }, index);
    if (result.kind !== 'accepted') return problem('Grupo guardado duplicado o incompatible');
    state = result.state;
  }
  if (status === 'omitted' || (status === 'next' && target.count === 0n)) {
    const result = reduceRecall(state, { type: 'skip' }, index);
    if (result.kind !== 'skipped') return problem('Salto incompatible');
    state = result.state;
  } else if (['review', 'next', 'complete'].includes(status)) {
    const result = reduceRecall(state, { type: 'finish' }, index);
    if (!['review', 'finished'].includes(result.kind)) return problem('Cierre incompatible');
    state = result.state;
  }
  if (state.status !== status) return problem('Terminalidad del snapshot incompatible');
  return { ok: true, state };
}

/** Recompute count and replay each group; never trust persisted totals or foreign seeds. */
function restoreSnapshot(deck, index, saved) {
  if (!saved || saved.schema !== 1 || !Number.isSafeInteger(saved.seed) ||
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
    if (!check.ok || item.omitted !== (check.state.target.count === 0n)) return problem('Historial incompatible');
    history.push({ level: item.level, identity: item.identity, found: check.state.found, omitted: item.omitted });
  }
  result.state.history = history;
  return result;
}

function migrateFullSnapshot(deck, index, old) {
  const seed = old.scenario.seed;
  const prior = old.history;
  const history = [];
  let current;
  for (let level = 1; level <= old.scenario.level; level++) {
    const generated = createRecallScenario(deck, index, seed, level);
    if (!generated.ok) return problem('Escenario positivo incompatible');
    const target = countGroups(index, generated.scenario.runes);
    if (target.status !== 'exact') return problem('Objetivo positivo incompatible');
    current = startRecall(generated.scenario, index, target).state;
    const previous = prior[level - 1];
    const originalFound = previous?.found ?? (level === old.scenario.level ? old.found : null);
    if (!Array.isArray(originalFound)) return problem('Historial anterior incompatible');
    for (const found of originalFound) {
      // Never strip a zero-energy ID from a mixed group: that would invent a different answer.
      if (!found.group.every(({ cardId }) => index.byId.has(cardId))) continue;
      const applied = reduceRecall(current, { type: 'confirm', entries: found.group }, index);
      if (applied.kind !== 'accepted') return problem('Grupo anterior incompatible');
      current = applied.state;
    }
    if (previous) {
      if (target.count === 0n) {
        if (!previous.omitted) return problem('No se puede migrar nivel anterior sólo de Energía 0');
        current = reduceRecall(current, { type: 'skip' }, index).state;
      } else {
        if (previous.omitted || BigInt(current.found.length) !== target.count) {
          return problem('Historial positivo incompleto; revisar progreso anterior');
        }
        current = reduceRecall(current, { type: 'finish' }, index).state;
      }
      if (current.status !== 'next') return problem('Historial anterior incompatible');
      history.push({ identity: current.scenario.identity, level, found: current.found, omitted: target.count === 0n });
    }
  }
  current.history = history;
  if (current.target.count === 0n) {
    if (old.status === 'next' || old.status === 'complete') {
      return problem('No se puede migrar un nivel terminado sólo con Energía 0');
    }
    if (old.status === 'omitted') current = reduceRecall(current, { type: 'skip' }, index).state;
    else if (!['active', 'review', 'empty', 'next'].includes(old.status)) return problem('Cierre anterior incompatible');
  } else if (old.status === 'review' || old.status === 'next' || old.status === 'complete') {
    const finished = reduceRecall(current, { type: 'finish' }, index);
    if (!['review', 'finished'].includes(finished.kind)) return problem('Cierre anterior incompatible');
    current = finished.state;
    if ((old.status === 'next' || old.status === 'complete') && current.status !== old.status) {
      return problem('Historial positivo incompleto; revisar progreso anterior');
    }
  } else if (old.status !== 'active') return problem('Estado anterior incompatible');
  return { ok: true, state: current,
    migrated: true, warning: 'Progreso anterior adaptado: las cartas de Energía 0 no cuentan' };
}

export function loadRecallSnapshot(deck, index) {
  const saved = load({}).recall;
  const direct = restoreSnapshot(deck, index, saved);
  if (direct.ok || index?.policy !== 'positive-energy') return direct;
  if (!Array.isArray(index.fullCards) || !index.fullCards.length) return direct;
  const full = { cards: index.fullCards,
    byId: new Map(index.fullCards.map((card) => [card.id, card])) };
  const source = restoreSnapshot(deck, full, saved);
  if (!source.ok) return direct;
  return migrateFullSnapshot(deck, index, source.state);
}
