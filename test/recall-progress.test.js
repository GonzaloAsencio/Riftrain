import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck, countGroups } from '../src/engine/deck-combos.js';
import { startRecall, reduceRecall, advanceRecall, startRecallV2, reduceRecallV2, advanceRecallV2, levelCardOutcomes } from '../src/engine/recall-progress.js';

const cards = [{ id: 'a', energy: 1, power: {} }, { id: 'b', energy: 2, power: {} }];
const { index } = normalizeDeck({ cards: cards.map(({ id }) => ({ cardId: id, qty: 1 })) }, cards);
const scenario = (level = 1) => ({ level, runes: Array.from({ length: level }, () => ({ domain: 'order', ready: true })), identity: `s${level}` });
const answer = [{ cardId: 'a', qty: 1 }];
const oneIndex = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, cards).index;
const emptyIndex = normalizeDeck({ cards: [{ cardId: 'hard', qty: 1 }] }, [{ id: 'hard', energy: 13, power: {} }]).index;

test('AC-CMB-06/17: duplicado o respuesta errada conserva descubrimientos, nivel y motivo', () => {
  const start = startRecall(scenario(), index, countGroups(index, scenario().runes));
  assert.equal(start.ok, true);
  const first = reduceRecall(start.state, { type: 'confirm', entries: answer }, index);
  assert.equal(first.kind, 'accepted');
  const duplicate = reduceRecall(first.state, { type: 'confirm', entries: answer }, index);
  assert.equal(duplicate.kind, 'duplicate');
  assert.deepEqual(duplicate.state, first.state);
  const invalid = reduceRecall(first.state, { type: 'confirm', entries: [{ cardId: 'b', qty: 1 }] }, index);
  assert.equal(invalid.kind, 'invalid');
  assert.match(invalid.reason, /Energia/);
  assert.deepEqual(invalid.state, first.state);
  assert.equal(first.state.found.length, 1);
});

test('AC-CMB-18/35: último grupo exacto promueve sólo N<12; nivel12 cierra sin reinicio', () => {
  const initial = startRecall(scenario(3), oneIndex, countGroups(oneIndex, scenario(3).runes)).state;
  const done = reduceRecall(initial, { type: 'confirm', entries: answer }, oneIndex);
  assert.equal(done.state.status, 'active', 'confirmar la última NO cierra');
  const closed = reduceRecall(done.state, { type: 'finish' }, oneIndex);
  assert.equal(closed.state.status, 'next');
  assert.equal(closed.state.nextLevel, 4);
  const next = advanceRecall(closed.state, scenario(4), oneIndex, countGroups(oneIndex, scenario(4).runes));
  assert.equal(next.ok, true);
  assert.equal(next.state.scenario.level, 4);
  assert.deepEqual(next.state.history[0].found, done.state.found);
  const last = reduceRecall(startRecall(scenario(12), oneIndex, countGroups(oneIndex, scenario(12).runes)).state,
    { type: 'confirm', entries: answer }, oneIndex);
  assert.equal(last.state.status, 'active');
  const final = reduceRecall(last.state, { type: 'finish' }, oneIndex);
  assert.equal(final.state.status, 'complete');
  assert.equal(final.state.message, 'Entrenamiento completado');
  assert.equal(final.state.nextLevel, undefined);
  assert.deepEqual(last.state.found, done.state.found);
});

test('AC-CMB-24/25: vacío exacto avisa pero sólo el salto explícito cambia de nivel', () => {
  const empty = startRecall(scenario(2), emptyIndex, countGroups(emptyIndex, scenario(2).runes)).state;
  assert.equal(empty.status, 'empty');
  assert.equal(empty.message, 'No hay jugadas posibles');
  assert.equal(empty.nextLevel, undefined);
  const ignored = reduceRecall(empty, { type: 'confirm', entries: [] }, emptyIndex);
  assert.equal(ignored.kind, 'invalid');
  assert.deepEqual(ignored.state, empty);
  const skipped = reduceRecall(empty, { type: 'skip' }, emptyIndex);
  assert.equal(skipped.state.status, 'next');
  assert.equal(skipped.state.nextLevel, 3);
  assert.deepEqual(skipped.state.found, []);
  const terminal = reduceRecall(startRecall(scenario(12), emptyIndex, countGroups(emptyIndex, scenario(12).runes)).state,
    { type: 'skip' }, emptyIndex);
  assert.equal(terminal.state.status, 'omitted');
  assert.equal(terminal.state.message, 'Recorrido terminado con nivel omitido');
  assert.equal(terminal.state.nextLevel, undefined);
});

test('AC-CMB-26: pending/error y objetivo no vacío jamás habilitan salto ni acierto vacuo', () => {
  for (const target of [{ status: 'pending' }, { status: 'error', reason: 'datos' }, countGroups(index, scenario().runes)]) {
    const start = startRecall(scenario(), index, target);
    assert.equal(start.ok, true);
    assert.notEqual(start.state.status, 'empty');
    const attempt = reduceRecall(start.state, { type: 'skip' }, index);
    assert.equal(attempt.kind, 'invalid');
    assert.deepEqual(attempt.state, start.state);
  }
  assert.equal(startRecall(scenario(), index, { status: 'exact', count: -1n }).ok, false);
});

test('AC-CMB-36/37/39: Terminé parcial congela sin acreditar omitidas; repetir continúa misma mesa y found', () => {
  const index = normalizeDeck({ cards: [{ cardId: 'z', qty: 2 }] }, [{ id: 'z', energy: 0, power: {} }]).index;
  const board = scenario(3);
  let state = startRecall(board, index, countGroups(index, board.runes)).state;
  state = reduceRecall(state, { type: 'confirm', entries: [{ cardId: 'z', qty: 1 }] }, index).state;
  const closed = reduceRecall(state, { type: 'finish' }, index);
  assert.equal(closed.kind, 'review');
  assert.equal(closed.state.status, 'review');
  assert.equal(closed.state.nextLevel, undefined);
  assert.equal(closed.state.found.length, 1);
  assert.deepEqual(closed.state.scenario, board);
  assert.equal(reduceRecall(closed.state, { type: 'confirm', entries: [{ cardId: 'z', qty: 2 }] }, index).kind, 'invalid');
  const again = reduceRecall(closed.state, { type: 'repeat' }, index);
  assert.equal(again.kind, 'repeated');
  assert.equal(again.state.status, 'active');
  assert.deepEqual(again.state.found, state.found);
  assert.equal(again.state.scenario, board);
  const last = reduceRecall(again.state, { type: 'confirm', entries: [{ cardId: 'z', qty: 2 }] }, index);
  assert.equal(last.state.status, 'active');
  assert.equal(reduceRecall(last.state, { type: 'finish' }, index).state.status, 'next');
});

test('AC-CMB-36/42: pendiente, error y vacío no convierten Terminé en acierto ni salto', () => {
  for (const target of [{ status: 'pending' }, { status: 'error', reason: 'datos' }]) {
    const state = startRecall(scenario(), oneIndex, target).state;
    const result = reduceRecall(state, { type: 'finish' }, oneIndex);
    assert.equal(result.kind, 'invalid');
    assert.deepEqual(result.state, state);
  }
  const emptyIndex = normalizeDeck({ cards: [{ cardId: 'hard', qty: 1 }] },
    [{ id: 'hard', energy: 13, power: {} }]).index;
  const board = scenario(1);
  const state = startRecall(board, emptyIndex, countGroups(emptyIndex, board.runes)).state;
  assert.equal(state.status, 'empty');
  assert.equal(reduceRecall(state, { type: 'finish' }, emptyIndex).kind, 'invalid');
  assert.equal(reduceRecall(state, { type: 'skip' }, emptyIndex).state.nextLevel, 2);
});

test('AC-CMB-18: un acierto parcial conserva el nivel y el cierre incompleto', () => {
  const partialIndex = normalizeDeck({ cards: [{ cardId: 'z', qty: 2 }] }, [{ id: 'z', energy: 0, power: {} }]).index;
  const initial = startRecall(scenario(5), partialIndex, countGroups(partialIndex, scenario(5).runes)).state;
  const result = reduceRecall(initial, { type: 'confirm', entries: [{ cardId: 'z', qty: 1 }] }, partialIndex);
  assert.equal(result.kind, 'accepted');
  assert.equal(result.state.status, 'active');
  assert.equal(result.state.scenario.level, 5);
  assert.equal(result.state.nextLevel, undefined);
  assert.equal(result.state.found.length, 1);
});

test('AC-CMB-18/26: un total falso o de otra mesa no permite promover antes del total real', () => {
  const zero = [{ id: 'z', energy: 0, power: {} }];
  const other = normalizeDeck({ cards: [{ cardId: 'z', qty: 2 }] }, zero).index;
  const board = scenario(3);
  assert.deepEqual(countGroups(other, board.runes), { status: 'exact', count: 2n });
  const forged = startRecall(board, other, { status: 'exact', count: 1n });
  assert.equal(forged.ok, false);
  const checked = startRecall(board, other, countGroups(other, board.runes));
  assert.equal(checked.ok, true);
  const partial = reduceRecall(checked.state, { type: 'confirm', entries: [{ cardId: 'z', qty: 1 }] }, other);
  assert.equal(partial.state.status, 'active');
  assert.equal(partial.state.found.length, 1);
});

test('AC-CMB-01/02/13/18/26: un ID agregado sólo al mapa no acredita ni promueve', () => {
  const sole = normalizeDeck({ cards: [{ cardId: 'z', qty: 1 }] },
    [{ id: 'z', energy: 0, power: {} }]).index;
  const board = scenario(1);
  const target = countGroups(sole, board.runes);
  assert.equal(target.count, 1n);
  const state = startRecall(board, sole, target).state;
  sole.byId.set('foreign', { id: 'foreign', qty: 1, energy: 0, power: {} });
  const attempt = reduceRecall(state, { type: 'confirm', entries: [{ cardId: 'foreign', qty: 1 }] }, sole);
  assert.notEqual(attempt.kind, 'accepted');
  assert.deepEqual(attempt.state.found, []);
  assert.notEqual(attempt.state.status, 'next');
  assert.equal(countGroups(sole, board.runes).status, 'error');
});

// ---- Muro del mazo: levelCardOutcomes (AC-ARC-19..20) ----
const wallCatalog = [
  { id: 'cheap', energy: 1, power: {} },
  { id: 'fury2', energy: 1, power: { fury: 2 } },
  { id: 'order1', energy: 2, power: { order: 1 } },
  { id: 'huge', energy: 9, power: {} },
  { id: 'zero', energy: 0, power: {} },
];
const wallIdx = normalizeDeck({ cards: wallCatalog.map(({ id }) => ({ cardId: id, qty: 3 })) }, wallCatalog,
  { policy: 'positive-energy' }).index;
// 3 runas Fury abiertas: pagan cheap y fury2; order1 (dominio ausente) y huge (energía) no.
const furyBoard = { runes: [0, 1, 2].map(() => ({ domain: 'fury', ready: true })) };
const outcomeOf = (result) => Object.fromEntries(result.cards.map((c) => [c.cardId, c]));

test('AC-ARC-19: cuatro estados por carta con su motivo', () => {
  const result = levelCardOutcomes(wallIdx, furyBoard, ['cheap'], ['order1']);
  assert.equal(result.ok, true);
  const by = outcomeOf(result);
  assert.deepEqual(by.cheap, { cardId: 'cheap', outcome: 'hit', reason: null });
  assert.equal(by.fury2.outcome, 'missed');
  assert.equal(by.fury2.reason, 'Se podía pagar: 1 + 2 Fury');
  assert.equal(by.order1.outcome, 'false-positive');
  assert.match(by.order1.reason, /Order/);
  assert.deepEqual(by.huge, { cardId: 'huge', outcome: 'irrelevant', reason: null });
});

test('AC-ARC-20: una entrada por carta distinta del índice, en orden estable y sin la Energía 0', () => {
  const result = levelCardOutcomes(wallIdx, furyBoard, [], []);
  assert.deepEqual(result.cards.map((c) => c.cardId), wallIdx.cards.map((c) => c.id));
  assert.equal(result.cards.some((c) => c.cardId === 'zero'), false);
  assert.deepEqual(levelCardOutcomes(wallIdx, furyBoard, [], []), result);
});

test('AC-ARC-20: sin nombrar nada las pagables son missed y el resto irrelevant', () => {
  const by = outcomeOf(levelCardOutcomes(wallIdx, furyBoard, [], []));
  assert.deepEqual(Object.values(by).map((c) => c.outcome), ['missed', 'missed', 'irrelevant', 'irrelevant']);
  assert.equal(Object.values(by).every((c) => c.outcome !== 'hit'), true);
});

test('AC-ARC-20: un nivel sin pagables no produce hit ni missed', () => {
  const poor = { runes: [{ domain: 'fury', ready: false }] };
  const result = levelCardOutcomes(wallIdx, poor, [], ['huge']);
  assert.equal(result.cards.some((c) => c.outcome === 'hit' || c.outcome === 'missed'), false);
  assert.equal(outcomeOf(result).huge.outcome, 'false-positive');
});

test('AC-ARC-20: no muta las entradas y rechaza índice o runas inválidos', () => {
  const found = Object.freeze(['cheap']);
  const misses = Object.freeze(['order1']);
  const frozenBoard = Object.freeze({ runes: Object.freeze(furyBoard.runes.map((r) => Object.freeze({ ...r }))) });
  assert.equal(levelCardOutcomes(wallIdx, frozenBoard, found, misses).ok, true);
  assert.equal(levelCardOutcomes(undefined, furyBoard, [], []).ok, false);
  const bad = levelCardOutcomes(wallIdx, { runes: [{ domain: 'lunar', ready: true }] }, [], []);
  assert.equal(bad.ok, false);
  assert.ok(bad.reason);
});

// ---- Muro del mazo: reducer por carta (AC-ARC-12..18, 21) ----
const lvl = (level = 3, runes = furyBoard.runes) => ({ level, runes, identity: `wall-${level}` });
const begin = (scenarioArg = lvl()) => startRecallV2(scenarioArg, wallIdx).state;
const named = (state, cardId) => reduceRecallV2(state, { type: 'name', cardId }, wallIdx);

test('AC-ARC-12: nombrar una carta pagable la acredita una sola vez', () => {
  const start = startRecallV2(lvl(), wallIdx);
  assert.equal(start.ok, true);
  assert.deepEqual(start.state.payable, ['cheap', 'fury2']);
  assert.equal(start.state.status, 'active');
  const hit = named(start.state, 'cheap');
  assert.equal(hit.kind, 'accepted');
  assert.deepEqual(hit.state.found, ['cheap']);
  assert.deepEqual(hit.state.misses, []);
});

test('AC-ARC-13: una carta del muro impagable es falso positivo con motivo y detalle, sin acreditar', () => {
  const miss = named(begin(), 'order1');
  assert.equal(miss.kind, 'false-positive');
  assert.match(miss.reason, /Order/);
  assert.equal(miss.detail.kind, 'domain');
  assert.deepEqual(miss.state.found, []);
  assert.deepEqual(miss.state.misses, ['order1']);
});

test('AC-ARC-14: nombrar de nuevo un acierto o un falso positivo es duplicado y no cambia nada', () => {
  const afterHit = named(begin(), 'cheap').state;
  const dupHit = named(afterHit, 'cheap');
  assert.equal(dupHit.kind, 'duplicate');
  assert.match(dupHit.reason, /ya nombrada/);
  assert.deepEqual(dupHit.state, afterHit);
  const afterMiss = named(begin(), 'huge').state;
  const dupMiss = named(afterMiss, 'huge');
  assert.equal(dupMiss.kind, 'duplicate');
  assert.deepEqual(dupMiss.state.misses, ['huge']);
  assert.deepEqual(dupMiss.state, afterMiss);
});

test('AC-ARC-15: fuera del mazo, id vacío o Energía 0 son inválidos: ni acierto ni falso positivo', () => {
  const state = begin();
  for (const id of ['nope', '', 'zero', undefined]) {
    const result = named(state, id);
    assert.equal(result.kind, 'invalid', String(id));
    assert.ok(result.reason);
    assert.deepEqual(result.state, state);
  }
  assert.match(named(state, 'zero').reason, /Energía 0/);
});

test('AC-ARC-16: el reducer no muta el estado de entrada y es determinista', () => {
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };
  // Congelado de punta a punta (scenario, runas, payable, found, misses): cualquier escritura tira.
  const frozen = freeze(structuredClone(begin()));
  const snapshot = JSON.stringify(frozen);
  for (const id of ['cheap', 'order1', 'nope']) {
    assert.deepEqual(named(frozen, id), named(frozen, id));
  }
  for (const type of ['finish', 'skip', 'repeat']) reduceRecallV2(frozen, { type }, wallIdx);
  assert.equal(JSON.stringify(frozen), snapshot);
  // Repetir sólo corre desde una revisión: también congelada, con un falso positivo que borrar.
  const frozenReview = freeze(structuredClone(reduceRecallV2(named(begin(), 'huge').state, { type: 'finish' }, wallIdx).state));
  assert.deepEqual(reduceRecallV2(frozenReview, { type: 'repeat' }, wallIdx).state.misses, []);
  assert.deepEqual(frozenReview.misses, ['huge']);
  assert.equal(reduceRecallV2(frozen, { type: 'finish' }, wallIdx).kind, 'review');
});

test('AC-ARC-17: el nivel se completa sólo con todas las pagables y cero falsos positivos', () => {
  let state = named(begin(), 'cheap').state;
  const partial = reduceRecallV2(state, { type: 'finish' }, wallIdx);
  assert.equal(partial.kind, 'review');
  assert.equal(partial.state.status, 'review');
  state = named(state, 'fury2').state;
  const done = reduceRecallV2(state, { type: 'finish' }, wallIdx);
  assert.equal(done.kind, 'finished');
  assert.equal(done.state.status, 'next');
  assert.equal(done.state.nextLevel, 4);
  assert.equal(reduceRecallV2(begin(), { type: 'finish' }, wallIdx).kind, 'review');
});

test('AC-ARC-18: todas las pagables nombradas más un falso positivo no completa: revisión', () => {
  let state = named(begin(), 'cheap').state;
  state = named(state, 'fury2').state;
  state = named(state, 'huge').state;
  const closed = reduceRecallV2(state, { type: 'finish' }, wallIdx);
  assert.equal(closed.kind, 'review');
  assert.equal(closed.state.status, 'review');
  assert.deepEqual(closed.state.found, ['cheap', 'fury2']);
});

test('AC-ARC-18: un nivel cerrado no acepta nombres, cierres ni saltos, y una revisión nunca avanza', () => {
  const review = reduceRecallV2(begin(), { type: 'finish' }, wallIdx).state;
  let done = named(named(begin(), 'cheap').state, 'fury2').state;
  done = reduceRecallV2(done, { type: 'finish' }, wallIdx).state;
  const last = reduceRecallV2(named(named(begin(lvl(12)), 'cheap').state, 'fury2').state, { type: 'finish' }, wallIdx).state;
  assert.deepEqual([review.status, done.status, last.status], ['review', 'next', 'complete']);
  for (const closed of [review, done, last]) {
    for (const event of [{ type: 'name', cardId: 'cheap' }, { type: 'name', cardId: 'order1' }, { type: 'finish' }, { type: 'skip' }]) {
      const result = reduceRecallV2(closed, event, wallIdx);
      assert.equal(result.kind, 'invalid', `${closed.status} ${event.type} ${event.cardId ?? ''}`);
      assert.ok(result.reason);
      assert.equal(result.state, closed);
    }
  }
  assert.equal(advanceRecallV2(review, lvl(4), wallIdx).ok, false);
  assert.equal(advanceRecallV2(done, lvl(4), wallIdx).ok, true);
});

test('AC-ARC-21: repetir conserva found, borra los falsos positivos y mantiene la misma mesa', () => {
  let state = named(begin(), 'cheap').state;
  state = named(state, 'huge').state;
  const review = reduceRecallV2(state, { type: 'finish' }, wallIdx).state;
  const again = reduceRecallV2(review, { type: 'repeat' }, wallIdx);
  assert.equal(again.kind, 'repeated');
  assert.equal(again.state.status, 'active');
  assert.deepEqual(again.state.found, ['cheap']);
  assert.deepEqual(again.state.misses, []);
  assert.equal(again.state.scenario, review.scenario);
  assert.equal(reduceRecallV2(begin(), { type: 'repeat' }, wallIdx).kind, 'invalid');
});

test('AC-ARC-21: sólo avanza un nivel completo o saltado; la revisión nunca avanza', () => {
  const state = named(named(begin(), 'cheap').state, 'fury2').state;
  const done = reduceRecallV2(state, { type: 'finish' }, wallIdx).state;
  const next = advanceRecallV2(done, lvl(4, [...furyBoard.runes, { domain: 'fury', ready: true }]), wallIdx);
  assert.equal(next.ok, true);
  assert.equal(next.state.scenario.level, 4);
  assert.deepEqual(next.state.history, [{ identity: 'wall-3', level: 3, found: ['cheap', 'fury2'], omitted: false }]);
  assert.deepEqual(next.state.found, []);
  const review = reduceRecallV2(begin(), { type: 'finish' }, wallIdx).state;
  assert.equal(advanceRecallV2(review, lvl(4), wallIdx).ok, false);
  assert.equal(advanceRecallV2(done, lvl(9), wallIdx).ok, false);
});

test('AC-ARC-21: un nivel sin pagables se salta; cualquier carta nombrada es falso positivo', () => {
  const poor = lvl(1, [{ domain: 'fury', ready: false }]);
  const start = startRecallV2(poor, wallIdx);
  assert.equal(start.state.status, 'empty');
  assert.deepEqual(start.state.payable, []);
  const miss = named(start.state, 'cheap');
  assert.equal(miss.kind, 'false-positive');
  assert.equal(reduceRecallV2(miss.state, { type: 'finish' }, wallIdx).kind, 'invalid');
  const skipped = reduceRecallV2(miss.state, { type: 'skip' }, wallIdx);
  assert.equal(skipped.kind, 'skipped');
  assert.equal(skipped.state.status, 'next');
  const history = advanceRecallV2(skipped.state, lvl(2, [{ domain: 'fury', ready: true }, { domain: 'fury', ready: true }]), wallIdx);
  assert.equal(history.state.history[0].omitted, true);
  assert.equal(reduceRecallV2(begin(), { type: 'skip' }, wallIdx).kind, 'invalid');
});

test('AC-ARC-21: el nivel 12 cierra sin nivel 13 y rechaza escenarios inválidos', () => {
  const board = Array.from({ length: 12 }, () => ({ domain: 'fury', ready: true }));
  let state = startRecallV2({ level: 12, runes: board, identity: 'wall-12' }, wallIdx).state;
  for (const id of state.payable) state = named(state, id).state;
  const last = reduceRecallV2(state, { type: 'finish' }, wallIdx);
  assert.equal(last.state.status, 'complete');
  assert.equal(last.state.nextLevel, undefined);
  assert.equal(startRecallV2({ ...lvl(), level: 13 }, wallIdx).ok, false);
  assert.equal(startRecallV2({ ...lvl(), identity: '' }, wallIdx).ok, false);
  assert.equal(startRecallV2(lvl(), undefined).ok, false);
});
