import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeck } from '../src/engine/deck-combos.js';
import { createRecallScenario, recallIdentity, RECALL_VERSION } from '../src/engine/recall-scenario.js';

const cards = [{ id: 'a', energy: 1, power: {} }];
const deck = { cards: [{ cardId: 'a', qty: 2 }], runes: { chaos: 9, order: 3 } };
const index = normalizeDeck(deck, cards).index;

test('AC-CMB-19/31/33: nivel N significa N abiertas y mesa+mazo=12, con agotadas legales', () => {
  for (let level = 1; level <= 12; level++) {
    const result = createRecallScenario(deck, index, 108, level);
    assert.equal(result.ok, true);
    const { runes, deckRemaining } = result.scenario;
    assert.equal(runes.filter((r) => r.ready).length, level);
    assert.equal(runes.length + deckRemaining, 12);
    assert.equal(runes.filter((r) => !r.ready).length <= 12 - level, true);
    assert.equal(runes.length <= 12, true);
    assert.equal(runes.every((r) => ['chaos', 'order'].includes(r.domain)), true);
    if (level === 12) assert.equal(runes.filter((r) => !r.ready).length, 0);
  }
  assert.equal(createRecallScenario(deck, index, 108, 1).scenario.runes.some((r) => !r.ready), true);
});

test('AC-CMB-20/34: seed y nivel reproducen recursos e identidad sin reinterpretar legacy', () => {
  const first = createRecallScenario(deck, index, 42, 3).scenario;
  assert.deepEqual(createRecallScenario(deck, index, 42, 3).scenario, first);
  assert.notEqual(createRecallScenario(deck, index, 42, 4).scenario.identity, first.identity);
  assert.notEqual(createRecallScenario({ ...deck, runes: { chaos: 8, order: 4 } }, index, 42, 3).scenario.identity, first.identity);
  const changed = { ...deck, cards: [{ cardId: 'a', qty: 3 }] };
  assert.notEqual(recallIdentity(changed, normalizeDeck(changed, cards).index, 42, 3, first.runes), first.identity);
  assert.notEqual(recallIdentity(deck, index, 43, 3, first.runes), first.identity);
});

test('AC-CHA-09: sin campeón la identidad no cambia; con un campeón de copia única la identidad lo incluye', () => {
  const catalog = [...cards, { id: 'champ', energy: 3, power: { chaos: 1 } }];
  const runes = createRecallScenario(deck, index, 42, 3).scenario.runes;
  const plain = normalizeDeck({ ...deck, champion: null }, catalog).index;
  assert.equal(recallIdentity({ ...deck, champion: null }, plain, 42, 3, runes), recallIdentity(deck, index, 42, 3, runes));
  const withChamp = { ...deck, champion: 'champ' };
  const champIndex = normalizeDeck(withChamp, catalog).index;
  const identity = recallIdentity(withChamp, champIndex, 42, 3, runes);
  assert.notEqual(identity, recallIdentity(deck, index, 42, 3, runes));
  assert.ok(identity.includes('"champ",1,3'), 'el campeón figura con qty 1 y su coste');
});

test('AC-CMB-34: metadata rúnica ausente o ilegal no produce recursos inventados', () => {
  for (const runes of [undefined, { chaos: 11 }, { lunar: 12 }, { chaos: 12.5 }, { chaos: -1, order: 13 }]) {
    const result = createRecallScenario({ ...deck, runes }, index, 42, 3);
    assert.equal(result.ok, false);
    assert.match(result.reason, /runas/i);
    assert.equal(result.scenario, undefined);
  }
  assert.equal(createRecallScenario(deck, index, 42, 0).ok, false);
  assert.equal(createRecallScenario(deck, index, NaN, 2).ok, false);
});

test('AC-CMB-20/34: cambiar sólo el orden de claves rúnicas conserva mesa e identidad', () => {
  const equivalent = { ...deck, runes: { order: 3, chaos: 9 } };
  const original = createRecallScenario(deck, index, 42, 3);
  const reordered = createRecallScenario(equivalent, index, 42, 3);
  assert.equal(original.ok, true);
  assert.equal(reordered.ok, true);
  assert.deepEqual(reordered.scenario.runes, original.scenario.runes);
  assert.equal(reordered.scenario.identity, original.scenario.identity);
  assert.equal(reordered.scenario.deckRemaining, original.scenario.deckRemaining);
});

test('AC-CMB-20/27: reordenar o partir main semánticamente idéntico no invalida identidad', () => {
  const mixed = [{ id: 'a', energy: 1, power: {} }, { id: 'b', energy: 2, power: { chaos: 1 } }];
  const source = { cards: [{ cardId: 'a', qty: 2 }, { cardId: 'b', qty: 1 }], runes: deck.runes };
  const reordered = { ...source, cards: [{ cardId: 'b', qty: 1 }, { cardId: 'a', qty: 1 }, { cardId: 'a', qty: 1 }] };
  const canonical = normalizeDeck(source, mixed).index;
  const original = createRecallScenario(source, canonical, 42, 3).scenario;
  assert.equal(createRecallScenario(reordered, normalizeDeck(reordered, mixed).index, 42, 3).scenario.identity,
    original.identity);
  assert.notEqual(createRecallScenario({ ...source, cards: [{ cardId: 'a', qty: 3 }, { cardId: 'b', qty: 1 }] },
    normalizeDeck({ ...source, cards: [{ cardId: 'a', qty: 3 }, { cardId: 'b', qty: 1 }] }, mixed).index, 42, 3).scenario.identity,
  original.identity);
});

test('AC-CMB-34: metadatos rúnicos heredados no se cuentan como doce runas propias', () => {
  const inherited = Object.create({ chaos: 12 });
  const result = createRecallScenario({ ...deck, runes: inherited }, index, 42, 3);
  assert.equal(result.ok, false);
  assert.match(result.reason, /runas/i);
});

test('AC-CMB-34: cantidad rúnica explícita desconocida no equivale a cero', () => {
  for (const qty of [null, undefined]) {
    const result = createRecallScenario({ ...deck, runes: { chaos: 12, order: qty } }, index, 42, 3);
    assert.equal(result.ok, false);
    assert.match(result.reason, /runas/i);
  }
});

test('AC-CMB-51: misma semilla y runas, identidad distinta para política positiva y fuente completa', () => {
  const source = { ...deck, cards: [...deck.cards, { cardId: 'zero', qty: 1 }] };
  const catalog = [...cards, { id: 'zero', energy: 0, power: { chaos: 1 } }];
  const full = normalizeDeck(source, catalog).index;
  const paid = normalizeDeck(source, catalog, { policy: 'positive-energy' }).index;
  const a = createRecallScenario(source, full, 42, 3);
  const b = createRecallScenario(source, paid, 42, 3);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(b.scenario.runes, a.scenario.runes);
  assert.notEqual(b.scenario.identity, a.scenario.identity);
  const changed = { ...source, cards: [deck.cards[0], { cardId: 'zero', qty: 2 }] };
  const changedPaid = normalizeDeck(changed, catalog, { policy: 'positive-energy' }).index;
  assert.notEqual(createRecallScenario(changed, changedPaid, 42, 3).scenario.identity, b.scenario.identity);
});

// Guarda de regresión (AC-ARC-25): RECALL_VERSION entra al seed del PRNG y a la identidad.
// Cambiarlo regenera TODAS las mesas; para cambiar el formato guardado se sube `schema`.
test('AC-ARC-25: RECALL_VERSION y la mesa de un seed fijo no cambian', () => {
  assert.equal(RECALL_VERSION, 2);
  const table = (seed, level) => createRecallScenario(deck, index, seed, level).scenario.runes
    .map((r) => `${r.domain[0]}${r.ready ? 1 : 0}`).join(' ');
  assert.equal(table(42, 3), 'o1 c1 o1 c0 c0 c0 c0');
  assert.equal(table(108, 6), 'o1 c1 c1 c1 c1 c1 c0 c0');
});
