import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck, countGroups } from '../src/engine/deck-combos.js';
import { createRecallScenario } from '../src/engine/recall-scenario.js';
import { startRecall, reduceRecall, advanceRecall } from '../src/engine/recall-progress.js';
import { load, save, saveRecallSnapshot, loadRecallSnapshot, isMemoryOnly } from '../src/store.js';

const database = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => database.get(key) ?? null,
  setItem: (key, value) => { database.set(key, value); },
  removeItem: (key) => { database.delete(key); },
} };
const cards = [{ id: 'a', energy: 0, power: {}, img: 'not-to-persist' },
  { id: 'b', energy: 1, power: {} }];
const deck = { cards: [{ cardId: 'a', qty: 1 }, { cardId: 'b', qty: 1 }], runes: { order: 12 } };
const index = normalizeDeck(deck, cards).index;
const scenario = createRecallScenario(deck, index, 13, 1).scenario;
const target = countGroups(index, scenario.runes);
const answer = [{ cardId: 'a', qty: 1 }];

test('AC-CMB-27/30: guarda tras confirmar y restaura nivel incompleto con referencias, no objetivo ni imágenes', () => {
  assert.equal(target.count, 3n);
  assert.equal(save({ legacy: { streak: 4 } }), true);
  const state = reduceRecall(startRecall(scenario, index, target).state, { type: 'confirm', entries: answer }, index).state;
  const result = saveRecallSnapshot(state);
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  const raw = [...database.values()][0];
  assert.equal(raw.includes('not-to-persist'), false);
  assert.equal(raw.includes('expected'), false);
  assert.equal(raw.includes('"count"'), false);
  assert.deepEqual(load({}).legacy, { streak: 4 });
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.scenario.identity, state.scenario.identity);
  assert.deepEqual(restored.state.found, state.found);
  assert.equal(restored.state.status, 'active');
  assert.deepEqual(restored.state.scenario.runes, state.scenario.runes);
  const equivalent = { ...deck, cards: [...deck.cards].reverse(), runes: { order: 12 } };
  const resumed = loadRecallSnapshot(equivalent, normalizeDeck(equivalent, cards).index);
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.state.found, state.found);
});

test('AC-CMB-27: guardar ronda legacy preserva recall más reciente aunque estado legacy traiga recall viejo', () => {
  assert.equal(save({ legacy: { streak: 4 } }), true);
  const discovered = reduceRecall(startRecall(scenario, index, target).state,
    { type: 'confirm', entries: answer }, index).state;
  assert.equal(saveRecallSnapshot(discovered).persisted, true);
  const latest = load({}).recall;
  assert.equal(latest.found.length, 1);
  assert.equal(save({ legacy: { streak: 5 }, recall: { ...latest, found: [] } }), true);
  assert.deepEqual(load({}).legacy, { streak: 5 });
  assert.deepEqual(load({}).recall, latest);
  assert.deepEqual(loadRecallSnapshot(deck, index).state.found.length, 1);
  assert.equal(save({ legacy: { streak: 6 } }), true);
  assert.deepEqual(load({}).legacy, { streak: 6 });
  assert.deepEqual(load({}).recall, latest);
  assert.equal(loadRecallSnapshot(deck, index).state.found.length, 1);
});

test('AC-CMB-28/29: versiones, identidad y grupos corruptos se rechazan sin aplicar progreso ajeno', () => {
  const saved = load({}).recall;
  const before = database.get('riftrain.v1');
  const changed = { ...deck, cards: [{ cardId: 'a', qty: 2 }, { cardId: 'b', qty: 1 }] };
  assert.equal(loadRecallSnapshot(changed, normalizeDeck(changed, cards).index).ok, false);
  assert.equal(loadRecallSnapshot({ ...deck, runes: { order: 11, chaos: 1 } }, index).ok, false);
  assert.equal(loadRecallSnapshot(deck, normalizeDeck(deck, [{ ...cards[0], energy: 1 }, cards[1]]).index).ok, false);
  for (const recall of [
    { ...saved, schema: 999 },
    { ...saved, found: [[['missing', 1]]] },
    { ...saved, found: [[['a', 2]]] },
    { ...saved, found: [[["a", 1]], [["a", 1]]] },
    { ...saved, runes: [] },
    { ...saved, status: 'complete' },
  ]) {
    database.set('riftrain.v1', JSON.stringify({ recall }));
    assert.equal(loadRecallSnapshot(deck, index).ok, false);
  }
  database.set('riftrain.v1', before);
  assert.equal(loadRecallSnapshot(deck, index).ok, true);
});

test('AC-CMB-27/30: historial completado se revalida al restaurar nivel siguiente', () => {
  let state = startRecall(scenario, index, target).state;
  for (const entries of [answer, [{ cardId: 'b', qty: 1 }], [...answer, { cardId: 'b', qty: 1 }]]) {
    state = reduceRecall(state, { type: 'confirm', entries }, index).state;
  }
  assert.equal(state.status, 'active', 'todas confirmadas aún esperan Terminé');
  state = reduceRecall(state, { type: 'finish' }, index).state;
  assert.equal(state.status, 'next');
  const nextScenario = createRecallScenario(deck, index, 13, 2).scenario;
  state = advanceRecall(state, nextScenario, index, countGroups(index, nextScenario.runes)).state;
  assert.equal(saveRecallSnapshot(state).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.history, state.history);
  assert.equal(restored.state.scenario.level, 2);
  const tampered = load({}).recall;
  const before = database.get('riftrain.v1');
  database.set('riftrain.v1', JSON.stringify({ recall: { ...tampered, history: [{ ...tampered.history[0], found: [] }] } }));
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
  database.set('riftrain.v1', JSON.stringify({ recall: { ...tampered, history: [] } }));
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
  database.set('riftrain.v1', before);
});

test('AC-CMB-40: review se restaura sin guardar grises, repetir conserva halladas y snapshot activo', () => {
  assert.equal(save({ legacy: { streak: 9 } }), true);
  const partial = reduceRecall(startRecall(scenario, index, target).state,
    { type: 'confirm', entries: answer }, index).state;
  const review = reduceRecall(partial, { type: 'finish' }, index).state;
  assert.equal(review.status, 'review');
  assert.equal(saveRecallSnapshot(review).ok, true);
  const raw = database.get('riftrain.v1');
  assert.equal(raw.includes('missed'), false);
  assert.equal(raw.includes('not-to-persist'), false);
  assert.equal(raw.includes('"count"'), false);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'review');
  assert.deepEqual(restored.state.found, partial.found);
  const again = reduceRecall(restored.state, { type: 'repeat' }, index).state;
  assert.equal(saveRecallSnapshot(again).ok, true);
  assert.equal(loadRecallSnapshot(deck, index).state.status, 'active');
  assert.deepEqual(loadRecallSnapshot(deck, index).state.found, partial.found);
  assert.deepEqual(load({}).legacy, { streak: 9 });
});

test('AC-CMB-36/40: snapshot activo con todos los grupos no auto-cierra; next legacy sí restaura', () => {
  let state = startRecall(scenario, index, target).state;
  for (const entries of [answer, [{ cardId: 'b', qty: 1 }], [...answer, { cardId: 'b', qty: 1 }]]) {
    state = reduceRecall(state, { type: 'confirm', entries }, index).state;
  }
  assert.equal(state.status, 'active');
  assert.equal(saveRecallSnapshot(state).ok, true);
  assert.equal(loadRecallSnapshot(deck, index).state.status, 'active');
  const finished = reduceRecall(state, { type: 'finish' }, index).state;
  assert.equal(saveRecallSnapshot(finished).ok, true);
  assert.equal(loadRecallSnapshot(deck, index).state.status, 'next');
});

test('AC-CMB-22: fallo de lectura usa copia en memoria sin perder último guardado', () => {
  assert.equal(save({ legacy: { streak: 9 } }), true);
  window.localStorage.getItem = () => { throw new Error('blocked read'); };
  assert.deepEqual(load({}).legacy, { streak: 9 });
  assert.equal(isMemoryOnly(), true);
});

test('AC-CMB-22: bloqueo de storage deja continuar en memoria con aviso sin prometer persistencia', () => {
  window.localStorage.setItem = () => { throw new Error('quota'); };
  window.localStorage.getItem = () => { throw new Error('blocked'); };
  const state = reduceRecall(startRecall(scenario, index, target).state, { type: 'confirm', entries: answer }, index).state;
  const result = saveRecallSnapshot(state);
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.match(result.warning, /memoria/i);
  assert.equal(isMemoryOnly(), true);
  assert.deepEqual(loadRecallSnapshot(deck, index).state.found, state.found);
});

test('AC-CMB-22/27: primera lectura bloqueada y escritura habilitada no sobrescribe raíz legacy', async () => {
  const isolated = await import('../src/store.js?asymmetric-read');
  database.set('riftrain.v1', JSON.stringify({ legacy: { streak: 9 } }));
  globalThis.window = { localStorage: {
    getItem: () => { throw new Error('blocked read'); },
    setItem: (key, raw) => { database.set(key, raw); },
    removeItem: (key) => { database.delete(key); },
  } };
  const state = reduceRecall(startRecall(scenario, index, target).state, { type: 'confirm', entries: answer }, index).state;
  const result = isolated.saveRecallSnapshot(state);
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.match(result.warning, /memoria/i);
  assert.deepEqual(JSON.parse(database.get('riftrain.v1')), { legacy: { streak: 9 } });
  assert.deepEqual(isolated.loadRecallSnapshot(deck, index).state.found, state.found);
  assert.equal(isolated.save({ legacy: { streak: 10 }, recall: { schema: 999 } }), false);
  assert.deepEqual(JSON.parse(database.get('riftrain.v1')), { legacy: { streak: 9 } });
  assert.deepEqual(isolated.load({}).legacy, { streak: 10 });
  assert.deepEqual(isolated.loadRecallSnapshot(deck, index).state.found, state.found);
});

test('AC-CMB-22: fallo de serialización no anuncia falso fallback ni destruye estado anterior', async () => {
  const isolated = await import('../src/store.js?cyclic-snapshot');
  const before = JSON.stringify({ legacy: { streak: 9 } });
  database.set('riftrain.v1', before);
  globalThis.window = { localStorage: {
    getItem: (key) => database.get(key) ?? null,
    setItem: (key, raw) => { database.set(key, raw); },
  } };
  const state = startRecall(scenario, index, target).state;
  const cyclic = { domain: 'order', ready: true };
  cyclic.self = cyclic;
  const result = isolated.saveRecallSnapshot({ ...state, scenario: { ...state.scenario, runes: [cyclic] } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /serializ/i);
  assert.equal(database.get('riftrain.v1'), before);
  assert.equal(isolated.loadRecallSnapshot(deck, index).ok, false);
});

const legacyDeck = { cards: [{ cardId: 'paid', qty: 2 }, { cardId: 'seal', qty: 1 }], runes: { order: 12 } };
const legacyCards = [{ id: 'paid', energy: 1, power: {} }, { id: 'seal', energy: 0, power: { order: 1 } }];
const fullLegacy = normalizeDeck(legacyDeck, legacyCards).index;
const paidLegacy = normalizeDeck(legacyDeck, legacyCards, { policy: 'positive-energy' }).index;
const beforeLegacy = (seed = 17, level = 1) => createRecallScenario(legacyDeck, fullLegacy, seed, level).scenario;
const oldGroups = [
  [{ cardId: 'seal', qty: 1 }],
  [{ cardId: 'paid', qty: 1 }],
  [{ cardId: 'paid', qty: 1 }, { cardId: 'seal', qty: 1 }],
];

test('AC-CMB-51: viejo snapshot activo filtra grupo íntegro cero/mixto, conserva paid, seed, mesa y legacy', async () => {
  const persisted = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
    removeItem: (key) => persisted.delete(key),
  } };
  const isolated = await import('../src/store.js?migrate-active');
  assert.equal(isolated.save({ legacy: { streak: 7 } }), true);
  const oldScenario = beforeLegacy();
  let old = startRecall(oldScenario, fullLegacy, countGroups(fullLegacy, oldScenario.runes)).state;
  assert.equal(old.target.count, 3n);
  for (const entries of oldGroups) old = reduceRecall(old, { type: 'confirm', entries }, fullLegacy).state;
  assert.equal(old.status, 'active');
  assert.equal(isolated.saveRecallSnapshot(old).ok, true);
  const rawBefore = persisted.get('riftrain.v1');
  const migrated = isolated.loadRecallSnapshot(legacyDeck, paidLegacy);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.state.status, 'active');
  assert.equal(migrated.state.scenario.seed, oldScenario.seed);
  assert.deepEqual(migrated.state.scenario.runes, oldScenario.runes);
  assert.equal(migrated.state.target.count, 1n);
  assert.deepEqual(migrated.state.found.map(({ group }) => group), [[{ cardId: 'paid', qty: 1 }]]);
  assert.notEqual(migrated.state.scenario.identity, oldScenario.identity);
  assert.equal(persisted.get('riftrain.v1'), rawBefore, 'lectura no sobrescribe fuente sin acción');
  const changed = { ...legacyDeck, cards: [{ cardId: 'paid', qty: 3 }, { cardId: 'seal', qty: 1 }] };
  assert.equal(isolated.loadRecallSnapshot(changed,
    normalizeDeck(changed, legacyCards, { policy: 'positive-energy' }).index).ok, false);
  assert.equal(isolated.saveRecallSnapshot(migrated.state).ok, true);
  assert.deepEqual(isolated.loadRecallSnapshot(legacyDeck, paidLegacy).state.found, migrated.state.found);
  assert.deepEqual(isolated.load({}).legacy, { streak: 7 });
});

test('AC-CMB-51: review antiguo con sólo Seal muestra paid faltante, no inventa logro', async () => {
  const persisted = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
  } };
  const isolated = await import('../src/store.js?migrate-review');
  const scene = beforeLegacy();
  let state = startRecall(scene, fullLegacy, countGroups(fullLegacy, scene.runes)).state;
  state = reduceRecall(state, { type: 'confirm', entries: oldGroups[0] }, fullLegacy).state;
  state = reduceRecall(state, { type: 'finish' }, fullLegacy).state;
  assert.equal(state.status, 'review');
  isolated.saveRecallSnapshot(state);
  const converted = isolated.loadRecallSnapshot(legacyDeck, paidLegacy);
  assert.equal(converted.ok, true);
  assert.equal(converted.state.status, 'review');
  assert.equal(converted.state.target.count, 1n);
  assert.deepEqual(converted.state.found, []);
  assert.equal(converted.state.scenario.identity !== scene.identity, true);
  assert.equal(persisted.get('riftrain.v1').includes('"found":[[["seal",1]]]'), true);
});

test('AC-CMB-51: historial terminado validado se convierte nivel por nivel, sin inventar hallazgos', async () => {
  const persisted = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
  } };
  const isolated = await import('../src/store.js?migrate-history');
  const first = beforeLegacy();
  let state = startRecall(first, fullLegacy, countGroups(fullLegacy, first.runes)).state;
  for (const entries of oldGroups) state = reduceRecall(state, { type: 'confirm', entries }, fullLegacy).state;
  state = reduceRecall(state, { type: 'finish' }, fullLegacy).state;
  assert.equal(state.status, 'next');
  const second = beforeLegacy(17, 2);
  state = advanceRecall(state, second, fullLegacy, countGroups(fullLegacy, second.runes)).state;
  state = reduceRecall(state, { type: 'confirm', entries: [{ cardId: 'paid', qty: 1 }] }, fullLegacy).state;
  assert.equal(isolated.saveRecallSnapshot(state).ok, true);
  const converted = isolated.loadRecallSnapshot(legacyDeck, paidLegacy);
  assert.equal(converted.ok, true);
  assert.equal(converted.state.scenario.level, 2);
  assert.equal(converted.state.scenario.seed, 17);
  assert.equal(converted.state.history.length, 1);
  assert.deepEqual(converted.state.history[0].found.map(({ group }) => group), [[{ cardId: 'paid', qty: 1 }]]);
  assert.deepEqual(converted.state.found.map(({ group }) => group), [[{ cardId: 'paid', qty: 1 }]]);
  assert.equal(converted.state.target.count, 2n);
  assert.equal(converted.state.status, 'active');
});

test('AC-CMB-51: fuente corrupta o tier sólo cero sin equivalente seguro no se reescribe', async () => {
  const persisted = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
  } };
  const isolated = await import('../src/store.js?migrate-invalid');
  persisted.set('riftrain.v1', JSON.stringify({ legacy: { streak: 3 }, recall: { schema: 999 } }));
  const corruptRaw = persisted.get('riftrain.v1');
  assert.equal(isolated.loadRecallSnapshot(legacyDeck, paidLegacy).ok, false);
  assert.equal(persisted.get('riftrain.v1'), corruptRaw);
  const zeroDeck = { cards: [{ cardId: 'seal', qty: 1 }], runes: { order: 12 } };
  const fullZero = normalizeDeck(zeroDeck, [legacyCards[1]]).index;
  const paidZero = normalizeDeck(zeroDeck, [legacyCards[1]], { policy: 'positive-energy' }).index;
  const scenario = createRecallScenario(zeroDeck, fullZero, 17, 1).scenario;
  let old = startRecall(scenario, fullZero, countGroups(fullZero, scenario.runes)).state;
  old = reduceRecall(old, { type: 'confirm', entries: [{ cardId: 'seal', qty: 1 }] }, fullZero).state;
  old = reduceRecall(old, { type: 'finish' }, fullZero).state;
  assert.equal(old.status, 'next');
  assert.equal(isolated.saveRecallSnapshot(old).ok, true);
  const completedRaw = persisted.get('riftrain.v1');
  const currentFinished = isolated.loadRecallSnapshot(zeroDeck, paidZero);
  assert.equal(currentFinished.ok, false, 'un nivel sólo zero ya terminado no se convierte en vacío/restaurado');
  assert.match(currentFinished.reason, /incompatible|migrar|revisar/i);
  assert.equal(persisted.get('riftrain.v1'), completedRaw);
  const nextScenario = createRecallScenario(zeroDeck, fullZero, 17, 2).scenario;
  old = advanceRecall(old, nextScenario, fullZero, countGroups(fullZero, nextScenario.runes)).state;
  assert.equal(isolated.saveRecallSnapshot(old).ok, true);
  const before = persisted.get('riftrain.v1');
  const impossible = isolated.loadRecallSnapshot(zeroDeck, paidZero);
  assert.equal(impossible.ok, false);
  assert.match(impossible.reason, /incompatible|migrar|revisar/i);
  assert.equal(persisted.get('riftrain.v1'), before);
  const last = createRecallScenario(zeroDeck, fullZero, 17, 12).scenario;
  let oldLast = startRecall(last, fullZero, countGroups(fullZero, last.runes)).state;
  oldLast = reduceRecall(oldLast, { type: 'confirm', entries: [{ cardId: 'seal', qty: 1 }] }, fullZero).state;
  oldLast = reduceRecall(oldLast, { type: 'finish' }, fullZero).state;
  assert.equal(oldLast.status, 'complete');
  // Un snapshot nivel12 sin los 11 niveles anteriores es corrupto: nunca aplicar.
  assert.equal(isolated.saveRecallSnapshot(oldLast).ok, true);
  const finalRaw = persisted.get('riftrain.v1');
  assert.equal(isolated.loadRecallSnapshot(zeroDeck, paidZero).ok, false);
  assert.equal(persisted.get('riftrain.v1'), finalRaw);
});
