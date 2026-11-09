import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck } from '../src/engine/deck-combos.js';
import { createRecallScenario } from '../src/engine/recall-scenario.js';
import { startRecall, reduceRecall, advanceRecall } from '../src/engine/recall-progress.js';
import * as store from '../src/store.js';
import { load, save, saveRecallSnapshot, loadRecallSnapshot, isMemoryOnly, loadSettings, saveSettings } from '../src/store.js';

const database = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => database.get(key) ?? null,
  setItem: (key, value) => { database.set(key, value); },
  removeItem: (key) => { database.delete(key); },
} };
const cards = [{ id: 'a', energy: 1, power: {}, img: 'not-to-persist' },
  { id: 'b', energy: 1, power: {} }, { id: 'c', energy: 3, power: {} }];
const deck = { cards: cards.map(({ id }) => ({ cardId: id, qty: 1 })), runes: { order: 12 } };
const index = normalizeDeck(deck, cards).index;
const scenario = createRecallScenario(deck, index, 13, 1).scenario;
const begin = () => startRecall(scenario, index).state;
const name = (state, cardId) => reduceRecall(state, { type: 'name', cardId }, index).state;
const finish = (state) => reduceRecall(state, { type: 'finish' }, index).state;

test('AC-ARC-26: el store sólo expone la persistencia vigente (sin migración del schema 1)', () => {
  assert.deepEqual(Object.keys(store).sort(),
    ['clear', 'isMemoryOnly', 'load', 'loadRecallSnapshot', 'loadSettings', 'save', 'saveRecallSnapshot', 'saveSettings']);
});

test('AC-ARC-22: el snapshot es schema 2, guarda found como cardId[] y jamás los falsos positivos ni imágenes', () => {
  assert.deepEqual(begin().payable, ['a', 'b']);
  assert.equal(save({ legacy: { streak: 4 } }), true);
  const state = name(name(begin(), 'a'), 'c');
  assert.deepEqual(state.misses, ['c']);
  const result = saveRecallSnapshot(state);
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  const raw = [...database.values()][0];
  assert.equal(raw.includes('not-to-persist'), false);
  assert.equal(raw.includes('misses'), false);
  assert.equal(raw.includes('"count"'), false);
  const recall = load({}).recall;
  assert.equal(recall.schema, 2);
  assert.deepEqual(recall.found, ['a']);
  assert.equal(JSON.stringify(recall).includes('"c"'), false);
  assert.deepEqual(load({}).legacy, { streak: 4 });
});

test('AC-ARC-23: restaurar devuelve found igual y misses vacío, también con el mazo en otro orden', () => {
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.scenario.identity, scenario.identity);
  assert.deepEqual(restored.state.found, ['a']);
  assert.deepEqual(restored.state.misses, []);
  assert.equal(restored.state.status, 'active');
  assert.deepEqual(restored.state.scenario.runes, scenario.runes);
  const equivalent = { ...deck, cards: [...deck.cards].reverse() };
  const resumed = loadRecallSnapshot(equivalent, normalizeDeck(equivalent, cards).index);
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.state.found, ['a']);
});

test('AC-CMB-27: guardar ronda legacy preserva el recall más reciente aunque el estado legacy traiga uno viejo', () => {
  assert.equal(save({ legacy: { streak: 4 } }), true);
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).persisted, true);
  const latest = load({}).recall;
  assert.equal(latest.found.length, 1);
  assert.equal(save({ legacy: { streak: 5 }, recall: { ...latest, found: [] } }), true);
  assert.deepEqual(load({}).legacy, { streak: 5 });
  assert.deepEqual(load({}).recall, latest);
  assert.equal(loadRecallSnapshot(deck, index).state.found.length, 1);
  assert.equal(save({ legacy: { streak: 6 } }), true);
  assert.deepEqual(load({}).recall, latest);
});

test('AC-ARC-24: un snapshot schema 1 se descarta sin lanzar y deja la raíz intacta', () => {
  const old = { schema: 1, seed: 13, level: 1, identity: scenario.identity, runes: scenario.runes,
    status: 'active', found: [[['a', 1]]], history: [] };
  const raw = JSON.stringify({ legacy: { streak: 7 }, recall: old });
  database.set('riftrain.v1', raw);
  let result;
  assert.doesNotThrow(() => { result = loadRecallSnapshot(deck, index); });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Snapshot ausente o versión incompatible');
  assert.equal(database.get('riftrain.v1'), raw);
  assert.deepEqual(load({}).legacy, { streak: 7 });
  database.set('riftrain.v1', JSON.stringify({ legacy: { streak: 7 } }));
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
});

test('AC-CMB-28/29: versión, identidad y cartas corruptas se rechazan sin aplicar progreso ajeno', () => {
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).ok, true);
  const saved = load({}).recall;
  const before = database.get('riftrain.v1');
  const changed = { ...deck, cards: [{ cardId: 'a', qty: 2 }, { cardId: 'b', qty: 1 }, { cardId: 'c', qty: 1 }] };
  assert.equal(loadRecallSnapshot(changed, normalizeDeck(changed, cards).index).ok, false);
  assert.equal(loadRecallSnapshot({ ...deck, runes: { order: 11, chaos: 1 } }, index).ok, false);
  for (const recall of [
    { ...saved, schema: 999 },
    { ...saved, found: ['missing'] },
    { ...saved, found: ['c'] },
    { ...saved, found: ['a', 'a'] },
    { ...saved, found: [[['a', 1]]] },
    { ...saved, found: 'a' },
    { ...saved, runes: [] },
    { ...saved, status: 'complete' },
  ]) {
    database.set('riftrain.v1', JSON.stringify({ recall }));
    assert.equal(loadRecallSnapshot(deck, index).ok, false, JSON.stringify(recall.found));
  }
  database.set('riftrain.v1', before);
  assert.equal(loadRecallSnapshot(deck, index).ok, true);
});

test('AC-CMB-27/30: el historial completado se revalida al restaurar el nivel siguiente', () => {
  const done = finish(name(name(begin(), 'a'), 'b'));
  assert.equal(done.status, 'next');
  const nextScenario = createRecallScenario(deck, index, 13, 2).scenario;
  const state = advanceRecall(done, nextScenario, index).state;
  assert.equal(saveRecallSnapshot(state).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.history, state.history);
  assert.deepEqual(restored.state.history[0].found, ['a', 'b']);
  assert.equal(restored.state.scenario.level, 2);
  const tampered = load({}).recall;
  const before = database.get('riftrain.v1');
  database.set('riftrain.v1', JSON.stringify({ recall: { ...tampered, history: [{ ...tampered.history[0], found: [] }] } }));
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
  database.set('riftrain.v1', JSON.stringify({ recall: { ...tampered, history: [] } }));
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
  database.set('riftrain.v1', before);
});

test('AC-ARC-50: todas las pagables más un falso positivo se restauran en revisión, no cerradas', () => {
  assert.equal(save({ legacy: { streak: 9 } }), true);
  const review = finish(name(name(name(begin(), 'a'), 'c'), 'b'));
  assert.equal(review.status, 'review');
  assert.deepEqual(review.found, ['a', 'b']);
  assert.equal(saveRecallSnapshot(review).ok, true);
  assert.equal(database.get('riftrain.v1').includes('misses'), false);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'review');
  assert.deepEqual(restored.state.found, ['a', 'b']);
  assert.deepEqual(restored.state.misses, []);
  // Repetir con todo hallado cierra solo (AC-CEL-18): se restaura cerrado.
  const again = reduceRecall(restored.state, { type: 'repeat' }, index).state;
  assert.equal(saveRecallSnapshot(again).ok, true);
  assert.equal(loadRecallSnapshot(deck, index).state.status, 'next');
  assert.deepEqual(loadRecallSnapshot(deck, index).state.found, ['a', 'b']);
  assert.deepEqual(load({}).legacy, { streak: 9 });
});

test('AC-CMB-40: la revisión parcial se restaura con lo hallado y repetir vuelve a activo', () => {
  const review = finish(name(begin(), 'a'));
  assert.equal(review.status, 'review');
  assert.equal(saveRecallSnapshot(review).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.state.status, 'review');
  assert.deepEqual(restored.state.found, ['a']);
});

test('AC-CEL-07: el nivel cerrado al nombrar la última pagable se restaura cerrado, con el nivel siguiente', () => {
  const state = name(name(begin(), 'a'), 'b');
  assert.equal(state.status, 'next');
  assert.equal(saveRecallSnapshot(state).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'next');
  assert.equal(restored.state.nextLevel, 2);
  assert.deepEqual(restored.state.found, ['a', 'b']);
});

test('AC-CMB-36/40: el snapshot activo con todas las pagables (tras Repetir) se restaura activo, sin nivel siguiente', () => {
  const opened = { ...load({}).recall, status: 'active', found: ['a', 'b'] };
  database.set('riftrain.v1', JSON.stringify({ recall: opened }));
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'active');
  assert.equal(restored.state.nextLevel, undefined);
  assert.equal(reduceRecall(restored.state, { type: 'finish' }, index).state.status, 'next');
});

test('AC-CEL-08: una revisión con todas las pagables halladas se restaura en revisión, sin nivel siguiente', () => {
  const review = name(name(name(begin(), 'a'), 'c'), 'b');
  assert.equal(review.status, 'review');
  assert.equal(saveRecallSnapshot(review).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'review');
  assert.equal(restored.state.nextLevel, undefined);
  assert.equal(reduceRecall(restored.state, { type: 'repeat' }, index).kind, 'repeated');
});

test('AC-CEL-09/10: el nivel 12 completo se restaura completo y su historial se revalida', () => {
  let state = begin();
  for (let level = 1; level <= 12; level++) {
    for (const id of state.payable) state = name(state, id);
    if (state.status === 'empty') state = reduceRecall(state, { type: 'skip' }, index).state;
    if (level < 12) state = advanceRecall(state, createRecallScenario(deck, index, 13, level + 1).scenario, index).state;
  }
  assert.equal(state.status, 'complete');
  assert.equal(saveRecallSnapshot(state).ok, true);
  const restored = loadRecallSnapshot(deck, index);
  assert.equal(restored.ok, true, restored.reason);
  assert.equal(restored.state.status, 'complete');
  assert.equal(restored.state.history.length, 11);
  assert.deepEqual(restored.state.history, state.history);
});

test('AC-ARC-21: un nivel sin pagables saltado se restaura como siguiente nivel', () => {
  const hard = [{ id: 'hard', energy: 9, power: {} }];
  const hardDeck = { cards: [{ cardId: 'hard', qty: 1 }], runes: { order: 12 } };
  const hardIndex = normalizeDeck(hardDeck, hard).index;
  const hardScenario = createRecallScenario(hardDeck, hardIndex, 13, 1).scenario;
  const start = startRecall(hardScenario, hardIndex).state;
  assert.equal(start.status, 'empty');
  const skipped = reduceRecall(start, { type: 'skip' }, hardIndex).state;
  assert.equal(saveRecallSnapshot(skipped).ok, true);
  const restored = loadRecallSnapshot(hardDeck, hardIndex);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.status, 'next');
  assert.deepEqual(restored.state.payable, []);
});

// ---- Ajustes (AC-CFG-12..14): nivel máximo y mazo importado, en la misma raíz.
const imported = { deck: { id: 'code-otro', name: 'Otro', domains: ['order'], legend: null, champion: null,
  runes: { order: 12 }, cards: [{ cardId: 'a', qty: 3 }, { cardId: 'b', qty: 2 }] }, cards: cards.slice(0, 2) };

test('AC-CFG-12: sin ajustes guardados, el máximo es 12 y el mazo es el de siempre', () => {
  database.clear();
  assert.deepEqual(loadSettings(), { ok: true, settings: { startLevel: 1, maxLevel: 12, deck: null } });
});

test('AC-CFG-12: los ajustes se guardan y vuelven, sin tocar el progreso ni lo legacy', () => {
  database.clear();
  assert.equal(save({ legacy: { streak: 3 } }), true);
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).ok, true);
  assert.equal(saveSettings({ maxLevel: 8, deck: null }).ok, true);
  assert.deepEqual(loadSettings().settings, { startLevel: 1, maxLevel: 8, deck: null });
  assert.deepEqual(load({}).legacy, { streak: 3 });
  assert.equal(loadRecallSnapshot(deck, index).ok, true, 'el progreso sigue');
  assert.equal(saveSettings({ maxLevel: 8, deck: imported }).ok, true);
  assert.deepEqual(loadSettings().settings, { startLevel: 1, maxLevel: 8, deck: imported });
});

test('AC-CFG-12: ajustes inválidos no se guardan, y los guardados rotos vuelven a los de siempre con aviso', () => {
  database.clear();
  for (const bad of [{ maxLevel: 0, deck: null }, { maxLevel: 13, deck: null }, { maxLevel: '8', deck: null },
    { maxLevel: 5, deck: { deck: { cards: [{ cardId: 'zzz', qty: 1 }], runes: { order: 12 } }, cards } }, null]) {
    assert.equal(saveSettings(bad).ok, false, JSON.stringify(bad));
  }
  database.set('riftrain.v1', JSON.stringify({ settings: { maxLevel: 99, deck: 'basura' } }));
  const loaded = loadSettings();
  assert.equal(loaded.ok, false);
  assert.ok(loaded.reason);
  assert.deepEqual(loaded.settings, { startLevel: 1, maxLevel: 12, deck: null });
});

test('AC-CFG-13: guardar un mazo distinto empieza de nuevo; el mismo mazo conserva el progreso', () => {
  database.clear();
  assert.equal(saveSettings({ maxLevel: 12, deck: imported }).ok, true);
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).ok, true);
  assert.equal(saveSettings({ maxLevel: 6, deck: imported }).ok, true);
  assert.ok(load({}).recall, 'mismo mazo: el snapshot queda');
  assert.equal(saveSettings({ maxLevel: 6, deck: null }).ok, true);
  assert.equal(load({}).recall, undefined, 'otro mazo: el snapshot del anterior se borra');
});

test('AC-CFG-14: con el máximo bajado, un nivel guardado como cerrado se restaura completo', () => {
  database.clear();
  const done = name(name(begin(), 'a'), 'b');
  assert.equal(done.status, 'next');
  assert.equal(saveRecallSnapshot(done).ok, true);
  const restored = loadRecallSnapshot(deck, index, { maxLevel: 1 });
  assert.equal(restored.ok, true, restored.reason);
  assert.equal(restored.state.status, 'complete');
  assert.equal(restored.state.maxLevel, 1);
  assert.equal(loadRecallSnapshot(deck, index).state.status, 'next', 'sin ajuste sigue igual');
});

test('AC-CFG-14: subir el máximo después de terminar reabre el recorrido en vez de perderlo', () => {
  database.clear();
  const done = reduceRecall(name(startRecall(scenario, index, { maxLevel: 1 }).state, 'a'), { type: 'name', cardId: 'b' }, index).state;
  assert.equal(done.status, 'complete');
  assert.equal(saveRecallSnapshot(done).ok, true);
  const raised = loadRecallSnapshot(deck, index, { maxLevel: 8 });
  assert.equal(raised.ok, true, raised.reason);
  assert.equal(raised.state.status, 'next');
  assert.equal(raised.state.nextLevel, 2);
  assert.equal(raised.state.maxLevel, 8);
});

test('AC-CFG-13: el mismo mazo con las claves en otro orden conserva el progreso', () => {
  database.clear();
  assert.equal(saveSettings({ maxLevel: 12, deck: imported }).ok, true);
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).ok, true);
  const { deck: d, cards: c } = imported;
  const reordered = { cards: c, deck: { cards: [...d.cards].reverse(), runes: d.runes, champion: d.champion, legend: d.legend,
    domains: d.domains, name: d.name, id: d.id } };
  assert.equal(saveSettings({ deck: reordered, maxLevel: 7 }).ok, true);
  assert.ok(load({}).recall, 'es el mismo mazo: el progreso queda');
});

// ---- Desde qué nivel se empieza (AC-CFG-24..26)
test('AC-CFG-24: el nivel de inicio se guarda y vuelve; los ajustes viejos sin él empiezan en 1', () => {
  database.clear();
  assert.equal(saveSettings({ startLevel: 5, maxLevel: 9, deck: null }).ok, true);
  assert.deepEqual(loadSettings().settings, { startLevel: 5, maxLevel: 9, deck: null });
  database.set('riftrain.v1', JSON.stringify({ settings: { maxLevel: 7, deck: null } }));
  assert.deepEqual(loadSettings(), { ok: true, settings: { startLevel: 1, maxLevel: 7, deck: null } });
  for (const bad of [{ startLevel: 0, maxLevel: 5, deck: null }, { startLevel: 6, maxLevel: 5, deck: null }, { startLevel: '2', maxLevel: 5, deck: null }]) {
    assert.equal(saveSettings(bad).ok, false, JSON.stringify(bad));
  }
});

test('AC-CFG-25: cambiar el nivel de inicio empieza de nuevo; cambiar sólo el máximo conserva el progreso', () => {
  database.clear();
  assert.equal(saveSettings({ startLevel: 1, maxLevel: 12, deck: null }).ok, true);
  assert.equal(saveRecallSnapshot(name(begin(), 'a')).ok, true);
  assert.equal(saveSettings({ startLevel: 1, maxLevel: 6, deck: null }).ok, true);
  assert.ok(load({}).recall, 'sólo el máximo: el progreso queda');
  assert.equal(saveSettings({ startLevel: 3, maxLevel: 6, deck: null }).ok, true);
  assert.equal(load({}).recall, undefined, 'otro inicio: se empieza de nuevo');
});

test('AC-CFG-26: un recorrido que empezó en el nivel 2 se restaura con su historial desde el 2', () => {
  database.clear();
  const at = (level) => createRecallScenario(deck, index, 13, level).scenario;
  let state = startRecall(at(2), index).state;
  for (const id of state.payable) state = name(state, id);
  if (state.status === 'empty') state = reduceRecall(state, { type: 'skip' }, index).state;
  state = advanceRecall(state, at(3), index).state;
  assert.deepEqual(state.history.map((h) => h.level), [2]);
  assert.equal(saveRecallSnapshot(state).ok, true);
  const restored = loadRecallSnapshot(deck, index, { startLevel: 2 });
  assert.equal(restored.ok, true, restored.reason);
  assert.equal(restored.state.scenario.level, 3);
  assert.deepEqual(restored.state.history.map((h) => h.level), [2]);
  // Con el inicio configurado en 1, ese mismo guardado es un historial al que le falta el nivel 1.
  assert.equal(loadRecallSnapshot(deck, index).ok, false);
  // Un hueco en el historial (2 y después 4 para un nivel 5) no es un recorrido válido.
  const saved = load({}).recall;
  database.set('riftrain.v1', JSON.stringify({ recall: { ...saved, level: 5, history: [saved.history[0], { ...saved.history[0], level: 4 }] } }));
  assert.equal(loadRecallSnapshot(deck, index, { startLevel: 2 }).ok, false);
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
  const state = name(begin(), 'a');
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
  const state = name(begin(), 'a');
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
  const state = begin();
  const cyclic = { domain: 'order', ready: true };
  cyclic.self = cyclic;
  const result = isolated.saveRecallSnapshot({ ...state, scenario: { ...state.scenario, runes: [cyclic] } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /serializ/i);
  assert.equal(database.get('riftrain.v1'), before);
  assert.equal(isolated.loadRecallSnapshot(deck, index).ok, false);
});
