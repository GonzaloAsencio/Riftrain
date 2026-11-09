/** Pure recall reducer: answers never mutate the original runes or previous state. */
import { checkCard, payableCards } from './deck-combos.js';
import { costLabel } from './cost.js';

const fail = (reason) => ({ ok: false, reason });

/**
 * Muro del mazo: la unidad de respuesta es un cardId. `payable` es el objetivo (sincrono),
 * `found` lo acertado y `misses` los falsos positivos DEL INTENTO (nunca se persisten).
 */
export function startRecall(scenario, index, { maxLevel = 12 } = {}) {
  if (!Number.isSafeInteger(scenario?.level) || scenario.level < 1 || scenario.level > 12 ||
      !Array.isArray(scenario.runes) || typeof scenario.identity !== 'string' || !scenario.identity) {
    return fail('Escenario inválido');
  }
  // Hasta que nivel se juega: lo elige el usuario. Si lo baja por debajo del nivel en curso,
  // ese nivel es el ultimo (cerrarlo completa el recorrido): no se pierde lo jugado.
  if (!Number.isSafeInteger(maxLevel) || maxLevel < 1 || maxLevel > 12) return fail('Nivel máximo inválido');
  const payable = payableCards(index, scenario);
  if (!payable.ok) return payable;
  return { ok: true, state: { scenario, maxLevel, payable: payable.cardIds, found: [], misses: [], history: [],
    status: payable.cardIds.length ? 'active' : 'empty' } };
}

export function reduceRecall(state, event, index) {
  const closeLevel = (current, finalStatus) => current.scenario.level >= (current.maxLevel ?? 12) ? { ...current, status: finalStatus } :
    { ...current, status: 'next', nextLevel: current.scenario.level + 1 };
  if (event?.type === 'skip') {
    if (state?.status !== 'empty') return { kind: 'invalid', state, reason: 'Sólo se puede saltar un nivel sin cartas pagables' };
    return { kind: 'skipped', state: closeLevel(state, 'omitted') };
  }
  if (event?.type === 'finish') {
    if (state?.status !== 'active') return { kind: 'invalid', state, reason: 'Sólo podés terminar un nivel con cartas por nombrar' };
    const complete = state.misses.length === 0 && state.payable.every((id) => state.found.includes(id));
    if (!complete) return { kind: 'review', state: { ...state, status: 'review' } };
    return { kind: 'finished', state: closeLevel(state, 'complete') };
  }
  if (event?.type === 'repeat') {
    if (state?.status !== 'review') return { kind: 'invalid', state, reason: 'No hay revisión para continuar' };
    const reopened = { ...state, status: 'active', misses: [] };
    // Si lo unico que fallo fueron falsos positivos, no queda nada por nombrar: cierra completo.
    if (!reopened.payable.every((id) => reopened.found.includes(id))) return { kind: 'repeated', state: reopened, closed: false };
    return { kind: 'repeated', state: closeLevel(reopened, 'complete'), closed: true };
  }
  if (event?.type !== 'name') return { kind: 'invalid', state, reason: 'Acción desconocida' };
  if (!['active', 'empty'].includes(state?.status)) return { kind: 'invalid', state, reason: 'El nivel ya está cerrado' };
  const { cardId } = event;
  if (state.found.includes(cardId) || state.misses.includes(cardId)) {
    return { kind: 'duplicate', state, reason: 'Carta ya nombrada' };
  }
  const check = checkCard(cardId, state.scenario, index);
  if (check.ok) {
    const next = { ...state, found: [...state.found, cardId] };
    // La ultima pagable no deja nada por nombrar: cierra con la misma regla que Terminé.
    if (!next.payable.every((id) => next.found.includes(id))) return { kind: 'accepted', state: next, closed: false };
    const closed = next.misses.length ? { ...next, status: 'review' } : closeLevel(next, 'complete');
    return { kind: 'accepted', state: closed, closed: true };
  }
  if (check.detail === null) return { kind: 'invalid', state, reason: check.reason };
  return { kind: 'false-positive', reason: check.reason, detail: check.detail,
    state: { ...state, misses: [...state.misses, cardId] } };
}

/** Entra al nivel siguiente, generado aparte: nunca se empareja una mesa vieja con un nivel nuevo. */
export function advanceRecall(state, scenario, index) {
  if (state?.status !== 'next' || scenario?.level !== state.nextLevel) return fail('Avance de nivel inválido');
  const next = startRecall(scenario, index, { maxLevel: state.maxLevel ?? 12 });
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
