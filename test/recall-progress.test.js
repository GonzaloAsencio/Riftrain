import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck } from '../src/engine/deck-combos.js';
import { startRecall, reduceRecall, advanceRecall, rerollRecall, levelCardOutcomes } from '../src/engine/recall-progress.js';

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

// ---- Campeón en el recall (AC-CHA-08); 'champ' es un fixture de test ----
const champCatalog = [...wallCatalog, { id: 'champ', energy: 3, power: { fury: 1 } }];
const champIdx = normalizeDeck({ cards: wallCatalog.map(({ id }) => ({ cardId: id, qty: 3 })), champion: 'champ' },
  champCatalog, { policy: 'positive-energy' }).index;

test('AC-CHA-08: nombrar al campeón pagable cuenta como acierto igual que una carta del mazo', () => {
  const start = startRecall(lvl(), champIdx);
  assert.equal(start.ok, true);
  assert.deepEqual(start.state.payable, ['champ', 'cheap', 'fury2']);
  const hit = reduceRecall(start.state, { type: 'name', cardId: 'champ' }, champIdx);
  assert.equal(hit.kind, 'accepted');
  assert.deepEqual(hit.state.found, ['champ']);
  assert.deepEqual(hit.state.misses, []);
});

test('AC-CHA-08: levelCardOutcomes incluye al campeón: acierto si se nombró, perdida si no', () => {
  const hit = outcomeOf(levelCardOutcomes(champIdx, furyBoard, ['champ'], [])).champ;
  assert.deepEqual(hit, { cardId: 'champ', outcome: 'hit', reason: null });
  const missed = outcomeOf(levelCardOutcomes(champIdx, furyBoard, [], [])).champ;
  assert.equal(missed.outcome, 'missed');
  assert.match(missed.reason, /Se podía pagar/);
});

// ---- Muro del mazo: reducer por carta (AC-ARC-12..18, 21) ----
const lvl = (level = 3, runes = furyBoard.runes) => ({ level, runes, identity: `wall-${level}` });
const begin = (scenarioArg = lvl()) => startRecall(scenarioArg, wallIdx).state;
const named = (state, cardId) => reduceRecall(state, { type: 'name', cardId }, wallIdx);

test('AC-ARC-12: nombrar una carta pagable la acredita una sola vez', () => {
  const start = startRecall(lvl(), wallIdx);
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
  for (const type of ['finish', 'skip', 'repeat']) reduceRecall(frozen, { type }, wallIdx);
  assert.equal(JSON.stringify(frozen), snapshot);
  // Repetir sólo corre desde una revisión: también congelada, con un falso positivo que borrar.
  const frozenReview = freeze(structuredClone(reduceRecall(named(begin(), 'huge').state, { type: 'finish' }, wallIdx).state));
  assert.deepEqual(reduceRecall(frozenReview, { type: 'repeat' }, wallIdx).state.misses, []);
  assert.deepEqual(frozenReview.misses, ['huge']);
  assert.equal(reduceRecall(frozen, { type: 'finish' }, wallIdx).kind, 'review');
});

test('AC-ARC-17: el nivel se completa sólo con todas las pagables y cero falsos positivos', () => {
  let state = named(begin(), 'cheap').state;
  const partial = reduceRecall(state, { type: 'finish' }, wallIdx);
  assert.equal(partial.kind, 'review');
  assert.equal(partial.state.status, 'review');
  const done = named(state, 'fury2');
  assert.equal(done.closed, true);
  assert.equal(done.state.status, 'next');
  assert.equal(done.state.nextLevel, 4);
  assert.equal(reduceRecall(begin(), { type: 'finish' }, wallIdx).kind, 'review');
});

test('AC-ARC-18: todas las pagables nombradas más un falso positivo no completa: revisión', () => {
  let state = named(begin(), 'cheap').state;
  state = named(state, 'huge').state;
  const closed = named(state, 'fury2');
  assert.equal(closed.closed, true);
  assert.equal(closed.state.status, 'review');
  assert.deepEqual(closed.state.found, ['cheap', 'fury2']);
});

test('AC-ARC-18: un nivel cerrado no acepta nombres, cierres ni saltos, y una revisión nunca avanza', () => {
  const review = reduceRecall(begin(), { type: 'finish' }, wallIdx).state;
  const done = named(named(begin(), 'cheap').state, 'fury2').state;
  const last = named(named(begin(lvl(12)), 'cheap').state, 'fury2').state;
  assert.deepEqual([review.status, done.status, last.status], ['review', 'next', 'complete']);
  for (const closed of [review, done, last]) {
    for (const event of [{ type: 'name', cardId: 'cheap' }, { type: 'name', cardId: 'order1' }, { type: 'finish' }, { type: 'skip' }]) {
      const result = reduceRecall(closed, event, wallIdx);
      assert.equal(result.kind, 'invalid', `${closed.status} ${event.type} ${event.cardId ?? ''}`);
      assert.ok(result.reason);
      assert.equal(result.state, closed);
    }
  }
  assert.equal(advanceRecall(review, lvl(4), wallIdx).ok, false);
  assert.equal(advanceRecall(done, lvl(4), wallIdx).ok, true);
});

test('AC-ARC-21: repetir conserva found, borra los falsos positivos y mantiene la misma mesa', () => {
  let state = named(begin(), 'cheap').state;
  state = named(state, 'huge').state;
  const review = reduceRecall(state, { type: 'finish' }, wallIdx).state;
  const again = reduceRecall(review, { type: 'repeat' }, wallIdx);
  assert.equal(again.kind, 'repeated');
  assert.equal(again.state.status, 'active');
  assert.deepEqual(again.state.found, ['cheap']);
  assert.deepEqual(again.state.misses, []);
  assert.equal(again.state.scenario, review.scenario);
  assert.equal(reduceRecall(begin(), { type: 'repeat' }, wallIdx).kind, 'invalid');
});

test('AC-ARC-21: sólo avanza un nivel completo o saltado; la revisión nunca avanza', () => {
  const done = named(named(begin(), 'cheap').state, 'fury2').state;
  const next = advanceRecall(done, lvl(4, [...furyBoard.runes, { domain: 'fury', ready: true }]), wallIdx);
  assert.equal(next.ok, true);
  assert.equal(next.state.scenario.level, 4);
  assert.deepEqual(next.state.history, [{ identity: 'wall-3', level: 3, found: ['cheap', 'fury2'], omitted: false }]);
  assert.deepEqual(next.state.found, []);
  const review = reduceRecall(begin(), { type: 'finish' }, wallIdx).state;
  assert.equal(advanceRecall(review, lvl(4), wallIdx).ok, false);
  assert.equal(advanceRecall(done, lvl(9), wallIdx).ok, false);
});

test('AC-ARC-21: un nivel sin pagables se salta; cualquier carta nombrada es falso positivo', () => {
  const poor = lvl(1, [{ domain: 'fury', ready: false }]);
  const start = startRecall(poor, wallIdx);
  assert.equal(start.state.status, 'empty');
  assert.deepEqual(start.state.payable, []);
  const miss = named(start.state, 'cheap');
  assert.equal(miss.kind, 'false-positive');
  assert.equal(reduceRecall(miss.state, { type: 'finish' }, wallIdx).kind, 'invalid');
  const skipped = reduceRecall(miss.state, { type: 'skip' }, wallIdx);
  assert.equal(skipped.kind, 'skipped');
  assert.equal(skipped.state.status, 'next');
  const history = advanceRecall(skipped.state, lvl(2, [{ domain: 'fury', ready: true }, { domain: 'fury', ready: true }]), wallIdx);
  assert.equal(history.state.history[0].omitted, true);
  assert.equal(reduceRecall(begin(), { type: 'skip' }, wallIdx).kind, 'invalid');
});

test('AC-ARC-21: el nivel 12 cierra sin nivel 13 y rechaza escenarios inválidos', () => {
  const board = Array.from({ length: 12 }, () => ({ domain: 'fury', ready: true }));
  let state = startRecall({ level: 12, runes: board, identity: 'wall-12' }, wallIdx).state;
  for (const id of state.payable) state = named(state, id).state;
  assert.equal(state.status, 'complete');
  assert.equal(state.nextLevel, undefined);
  assert.equal(startRecall({ ...lvl(), level: 13 }, wallIdx).ok, false);
  assert.equal(startRecall({ ...lvl(), identity: '' }, wallIdx).ok, false);
  assert.equal(startRecall(lvl(), undefined).ok, false);
});

// ---- Cierre automático al nombrar la última pagable (AC-CEL-01..06) ----
test('AC-CEL-01: nombrar la última pagable sin falsos positivos cierra el nivel y ofrece el siguiente', () => {
  const last = named(named(begin(), 'cheap').state, 'fury2');
  assert.equal(last.kind, 'accepted');
  assert.equal(last.closed, true);
  assert.equal(last.state.status, 'next');
  assert.equal(last.state.nextLevel, 4);
  assert.deepEqual(last.state.found, ['cheap', 'fury2']);
});

test('AC-CEL-02: en el nivel 12 la última pagable completa el entrenamiento', () => {
  const last = named(named(begin(lvl(12)), 'cheap').state, 'fury2');
  assert.equal(last.closed, true);
  assert.equal(last.state.status, 'complete');
  assert.equal(last.state.nextLevel, undefined);
});

test('AC-CEL-03: con un falso positivo en la ronda, la última pagable cierra en revisión', () => {
  const state = named(named(begin(), 'cheap').state, 'huge').state;
  const last = named(state, 'fury2');
  assert.equal(last.kind, 'accepted');
  assert.equal(last.closed, true);
  assert.equal(last.state.status, 'review');
  assert.equal(last.state.nextLevel, undefined);
  assert.deepEqual(last.state.misses, ['huge']);
});

test('AC-CEL-04: una pagable que no es la última no cierra nada', () => {
  const first = named(begin(), 'cheap');
  assert.equal(first.kind, 'accepted');
  assert.equal(first.closed, false);
  assert.equal(first.state.status, 'active');
});

test('AC-CEL-05: un nivel cerrado solo no acepta otro nombre ni Terminé', () => {
  const closed = named(named(begin(), 'cheap').state, 'fury2').state;
  for (const event of [{ type: 'finish' }, { type: 'name', cardId: 'order1' }, { type: 'name', cardId: 'cheap' }]) {
    const result = reduceRecall(closed, event, wallIdx);
    assert.equal(result.kind, 'invalid', event.type);
    assert.equal(result.state, closed);
  }
});

test('AC-CEL-06: Terminé con pagables pendientes sigue siendo rendirse: revisión', () => {
  const partial = reduceRecall(named(begin(), 'cheap').state, { type: 'finish' }, wallIdx);
  assert.equal(partial.kind, 'review');
  assert.equal(partial.state.status, 'review');
});

test('AC-CEL-18: Repetir con todas las pagables halladas no deja nada que nombrar: cierra solo', () => {
  const review = named(named(named(begin(), 'cheap').state, 'huge').state, 'fury2').state;
  assert.equal(review.status, 'review');
  const again = reduceRecall(review, { type: 'repeat' }, wallIdx);
  assert.equal(again.kind, 'repeated');
  assert.equal(again.closed, true);
  assert.equal(again.state.status, 'next');
  assert.equal(again.state.nextLevel, 4);
  assert.deepEqual(again.state.misses, []);
  const last = named(named(named(begin(lvl(12)), 'cheap').state, 'huge').state, 'fury2').state;
  assert.equal(reduceRecall(last, { type: 'repeat' }, wallIdx).state.status, 'complete');
});

test('AC-CEL-18: Repetir con pagables pendientes reabre el nivel, sin cerrar', () => {
  const review = reduceRecall(named(begin(), 'cheap').state, { type: 'finish' }, wallIdx).state;
  const again = reduceRecall(review, { type: 'repeat' }, wallIdx);
  assert.equal(again.closed, false);
  assert.equal(again.state.status, 'active');
});

// ---- Nivel máximo (AC-CFG-10, 11, 14)
const startAt = (level, maxLevel) => startRecall(lvl(level), wallIdx, maxLevel === undefined ? undefined : { maxLevel });

test('AC-CFG-10: al completar el nivel máximo el recorrido termina, sin nivel siguiente', () => {
  const last = named(named(startAt(5, 5).state, 'cheap').state, 'fury2').state;
  assert.equal(last.status, 'complete');
  assert.equal(last.nextLevel, undefined);
  assert.equal(advanceRecall(last, lvl(6), wallIdx).ok, false);
});

test('AC-CFG-11: sin ajuste el máximo es 12 y un nivel intermedio sigue ofreciendo el siguiente', () => {
  const state = startAt(5).state;
  assert.equal(state.maxLevel, 12);
  assert.equal(named(named(state, 'cheap').state, 'fury2').state.status, 'next');
  for (const bad of [0, 13, 2.5, '8', null]) assert.equal(startAt(3, bad).ok, false, String(bad));
});

test('AC-CFG-10: el máximo pasa de nivel en nivel y nunca se avanza más allá', () => {
  const done = named(named(startAt(3, 4).state, 'cheap').state, 'fury2').state;
  assert.equal(done.status, 'next');
  const next = advanceRecall(done, lvl(4), wallIdx);
  assert.equal(next.ok, true);
  assert.equal(next.state.maxLevel, 4);
  assert.equal(named(named(next.state, 'cheap').state, 'fury2').state.status, 'complete');
});

test('AC-CFG-14: bajar el máximo por debajo del nivel actual cierra completo al terminar el nivel', () => {
  const last = named(named(startAt(7, 5).state, 'cheap').state, 'fury2').state;
  assert.equal(last.status, 'complete');
  const skipped = reduceRecall(startRecall(lvl(9, [{ domain: 'fury', ready: false }]), wallIdx, { maxLevel: 2 }).state, { type: 'skip' }, wallIdx);
  assert.equal(skipped.state.status, 'omitted');
});

// ---- Seguir después del máximo (AC-CFG-22): terminar no es un callejón sin salida.
test('AC-CFG-22: un recorrido completo antes del 12 se extiende al nivel siguiente', () => {
  const done = named(named(startAt(3, 3).state, 'cheap').state, 'fury2').state;
  assert.equal(done.status, 'complete');
  const extended = reduceRecall(done, { type: 'extend', maxLevel: 4 }, wallIdx);
  assert.equal(extended.kind, 'extended');
  assert.equal(extended.state.status, 'next');
  assert.equal(extended.state.nextLevel, 4);
  assert.equal(extended.state.maxLevel, 4);
  assert.equal(advanceRecall(extended.state, lvl(4), wallIdx).state.maxLevel, 4);
});

test('AC-CFG-22: extender vale también tras un último nivel omitido, y nunca más allá del 12 ni hacia atrás', () => {
  const poor = lvl(2, [{ domain: 'fury', ready: false }]);
  const omitted = reduceRecall(startRecall(poor, wallIdx, { maxLevel: 2 }).state, { type: 'skip' }, wallIdx).state;
  assert.equal(omitted.status, 'omitted');
  assert.equal(reduceRecall(omitted, { type: 'extend', maxLevel: 3 }, wallIdx).state.status, 'next');
  const last = named(named(startAt(12, 12).state, 'cheap').state, 'fury2').state;
  for (const [state, maxLevel] of [[last, 13], [omitted, 2], [omitted, 1], [startAt(3, 3).state, 4]]) {
    const result = reduceRecall(state, { type: 'extend', maxLevel }, wallIdx);
    assert.equal(result.kind, 'invalid', `${state.status} -> ${maxLevel}`);
    assert.equal(result.state, state);
  }
});

// ---- Reiniciar nivel: otra mesa, mismo nivel (AC-RER-01..03) ----
const otherTable = (level = 3) => ({ level, runes: furyBoard.runes.slice(0, 2), identity: `wall-${level}-b` });

test('AC-RER-01: reiniciar el nivel cambia la mesa, vacía lo nombrado y conserva historial y máximo', () => {
  let state = startRecall(lvl(3), wallIdx, { maxLevel: 7 }).state;
  state = { ...state, history: [{ identity: 'wall-2', level: 2, found: ['cheap'], omitted: false }] };
  state = named(state, 'cheap').state;
  state = named(state, 'order1').state;
  const result = rerollRecall(state, otherTable(3), wallIdx);
  assert.equal(result.ok, true);
  assert.equal(result.state.scenario.identity, 'wall-3-b');
  assert.equal(result.state.scenario.level, 3);
  assert.deepEqual([result.state.found, result.state.misses], [[], []]);
  assert.equal(result.state.status, 'active');
  assert.equal(result.state.maxLevel, 7);
  assert.deepEqual(result.state.history, state.history);
});

test('AC-RER-02: se puede reiniciar también un nivel cerrado (revisión, siguiente o completo)', () => {
  const review = reduceRecall(begin(), { type: 'finish' }, wallIdx).state;
  const done = named(named(begin(), 'cheap').state, 'fury2').state;
  for (const closed of [review, done]) {
    const result = rerollRecall(closed, otherTable(3), wallIdx);
    assert.equal(result.ok, true, closed.status);
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.nextLevel, undefined);
  }
});

test('AC-RER-03: una mesa de otro nivel o la misma mesa se rechazan con motivo y no tocan el estado', () => {
  const state = named(begin(), 'cheap').state;
  for (const scenario of [otherTable(4), lvl(3), null]) {
    const result = rerollRecall(state, scenario, wallIdx);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  }
  assert.deepEqual(state.found, ['cheap']);
});
