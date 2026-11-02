/** Pure recall reducer: answers never mutate the original runes or previous state. */
import { validateGroup, isExactCountFor, checkCard, payableCards } from './deck-combos.js';
import { costLabel } from './cost.js';

const fail = (reason) => ({ ok: false, reason });

export function startRecall(scenario, index, target) {
  if (!Number.isSafeInteger(scenario?.level) || scenario.level < 1 || scenario.level > 12 ||
      !Array.isArray(scenario.runes) || typeof scenario.identity !== 'string' || !scenario.identity ||
      !['pending', 'exact', 'error'].includes(target?.status) ||
      !Array.isArray(index?.cards) || !(index.byId instanceof Map) ||
      (target.status === 'exact' && !isExactCountFor(target, index, scenario.runes))) {
    return fail('Escenario u objetivo inválido');
  }
  const empty = target.status === 'exact' && target.count === 0n;
  return { ok: true, state: { scenario, target, found: [], history: [],
    status: empty ? 'empty' : 'active', ...(empty ? { message: 'No hay jugadas posibles' } : {}) } };
}

export function reduceRecall(state, event, index) {
  if (state?.target?.status === 'exact' && !isExactCountFor(state.target, index, state.scenario?.runes)) {
    return { kind: 'data-error', state, reason: 'Objetivo incompatible con el mazo o las runas' };
  }
  if (event?.type === 'skip') {
    if (state?.status !== 'empty' || state.target.status !== 'exact' || state.target.count !== 0n) {
      return { kind: 'invalid', state, reason: 'Sólo se puede saltar un nivel vacío verificado' };
    }
    const last = state.scenario.level === 12;
    return { kind: 'skipped', state: { ...state, status: last ? 'omitted' : 'next',
      ...(last ? { message: 'Recorrido terminado con nivel omitido' } : { nextLevel: state.scenario.level + 1 }) } };
  }
  if (event?.type === 'finish') {
    if (state?.status !== 'active' || state.target.status !== 'exact' || state.target.count === 0n) {
      return { kind: 'invalid', state, reason: 'Sólo podés terminar un nivel con objetivo verificado' };
    }
    const complete = BigInt(state.found.length) === state.target.count;
    if (!complete) return { kind: 'review', state: { ...state, status: 'review' } };
    const last = state.scenario.level === 12;
    return { kind: 'finished', state: { ...state, status: last ? 'complete' : 'next',
      ...(last ? { message: 'Entrenamiento completado' } : { nextLevel: state.scenario.level + 1 }) } };
  }
  if (event?.type === 'repeat') {
    if (state?.status !== 'review') return { kind: 'invalid', state, reason: 'No hay revisión para continuar' };
    return { kind: 'repeated', state: { ...state, status: 'active' } };
  }
  if (event?.type !== 'confirm') return { kind: 'invalid', state, reason: 'Acción desconocida' };
  const check = validateGroup(event.entries, state?.scenario, index);
  if (!check.ok) return { kind: 'invalid', state, reason: check.reason };
  if (state.found.some((found) => found.key === check.key)) return { kind: 'duplicate', state, reason: 'Combinación ya descubierta' };
  if (state.status !== 'active' || state.target.status !== 'exact' || state.target.count === 0n) {
    return { kind: 'invalid', state, reason: 'Objetivo aún no verificado o nivel cerrado' };
  }
  const found = [...state.found, { key: check.key, group: check.group }];
  if (BigInt(found.length) > state.target.count) return { kind: 'data-error', state, reason: 'Total inconsistente' };
  return { kind: 'accepted', state: { ...state, found } };
}

/** Enter a separately generated next scenario; do not pair old runes with a new level. */
export function advanceRecall(state, scenario, index, target) {
  if (state?.status !== 'next' || scenario?.level !== state.nextLevel) return fail('Avance de nivel inválido');
  const next = startRecall(scenario, index, target);
  if (!next.ok) return next;
  next.state.history = [...state.history, { identity: state.scenario.identity,
    level: state.scenario.level, found: state.found, omitted: state.target.count === 0n }];
  return next;
}

/**
 * Muro del mazo: la unidad de respuesta es un cardId. `payable` es el objetivo (sincrono),
 * `found` lo acertado y `misses` los falsos positivos DEL INTENTO (nunca se persisten).
 * Nombres V2 temporales: conviven con el reducer de combinaciones hasta que se lo elimine.
 */
export function startRecallV2(scenario, index) {
  if (!Number.isSafeInteger(scenario?.level) || scenario.level < 1 || scenario.level > 12 ||
      !Array.isArray(scenario.runes) || typeof scenario.identity !== 'string' || !scenario.identity) {
    return fail('Escenario inválido');
  }
  const payable = payableCards(index, scenario);
  if (!payable.ok) return payable;
  return { ok: true, state: { scenario, payable: payable.cardIds, found: [], misses: [], history: [],
    status: payable.cardIds.length ? 'active' : 'empty' } };
}

export function reduceRecallV2(state, event, index) {
  const closeLevel = (finalStatus) => state.scenario.level === 12 ? { ...state, status: finalStatus } :
    { ...state, status: 'next', nextLevel: state.scenario.level + 1 };
  if (event?.type === 'skip') {
    if (state?.status !== 'empty') return { kind: 'invalid', state, reason: 'Sólo se puede saltar un nivel sin cartas pagables' };
    return { kind: 'skipped', state: closeLevel('omitted') };
  }
  if (event?.type === 'finish') {
    if (state?.status !== 'active') return { kind: 'invalid', state, reason: 'Sólo podés terminar un nivel con cartas por nombrar' };
    const complete = state.misses.length === 0 && state.payable.every((id) => state.found.includes(id));
    if (!complete) return { kind: 'review', state: { ...state, status: 'review' } };
    return { kind: 'finished', state: closeLevel('complete') };
  }
  if (event?.type === 'repeat') {
    if (state?.status !== 'review') return { kind: 'invalid', state, reason: 'No hay revisión para continuar' };
    return { kind: 'repeated', state: { ...state, status: 'active', misses: [] } };
  }
  if (event?.type !== 'name') return { kind: 'invalid', state, reason: 'Acción desconocida' };
  if (!['active', 'empty'].includes(state?.status)) return { kind: 'invalid', state, reason: 'El nivel ya está cerrado' };
  const { cardId } = event;
  if (state.found.includes(cardId) || state.misses.includes(cardId)) {
    return { kind: 'duplicate', state, reason: 'Carta ya nombrada' };
  }
  const check = checkCard(cardId, state.scenario, index);
  if (check.ok) return { kind: 'accepted', state: { ...state, found: [...state.found, cardId] } };
  if (check.detail === null) return { kind: 'invalid', state, reason: check.reason };
  return { kind: 'false-positive', reason: check.reason, detail: check.detail,
    state: { ...state, misses: [...state.misses, cardId] } };
}

/** Entra al nivel siguiente, generado aparte: nunca se empareja una mesa vieja con un nivel nuevo. */
export function advanceRecallV2(state, scenario, index) {
  if (state?.status !== 'next' || scenario?.level !== state.nextLevel) return fail('Avance de nivel inválido');
  const next = startRecallV2(scenario, index);
  if (!next.ok) return next;
  next.state.history = [...state.history, { identity: state.scenario.identity,
    level: state.scenario.level, found: state.found, omitted: state.payable.length === 0 }];
  return next;
}

/**
 * Resultado por carta distinta del muro al cerrar el nivel, en el orden del indice:
 *   hit            -> esta en `found`.
 *   missed         -> se pagaba sola y nadie la nombro ("Se podía pagar: ...").
 *   false-positive -> esta en `misses` y no se paga sola (motivo del motor).
 *   irrelevant     -> no se paga sola y nadie la nombro; sin motivo: una carta boca
 *                     abajo no se explica sola.
 * Pura: no muta nada.
 */
export function levelCardOutcomes(index, scenario, found = [], misses = []) {
  if (!Array.isArray(index?.cards) || !(index.byId instanceof Map)) return fail('Índice de mazo inválido');
  const hits = new Set(found ?? []);
  const named = new Set(misses ?? []);
  const cards = [];
  for (const { id } of index.cards) {
    const check = checkCard(id, scenario, index);
    if (!check.ok && check.detail === null) return fail(check.reason);
    if (hits.has(id)) cards.push({ cardId: id, outcome: 'hit', reason: null });
    else if (check.ok) cards.push({ cardId: id, outcome: 'missed', reason: `Se podía pagar: ${costLabel(check.cost)}` });
    else if (named.has(id)) cards.push({ cardId: id, outcome: 'false-positive', reason: check.reason });
    else cards.push({ cardId: id, outcome: 'irrelevant', reason: null });
  }
  return { ok: true, cards };
}
