import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck, countGroups } from '../src/engine/deck-combos.js';
import { startRecall, reduceRecall, advanceRecall, levelCardOutcomes } from '../src/engine/recall-progress.js';

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
