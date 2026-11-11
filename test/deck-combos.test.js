import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecallScenario } from '../src/engine/recall-scenario.js';
import { normalizeDeck, checkCard, payableCards } from '../src/engine/deck-combos.js';
import { canPlayCard } from '../src/engine/cost.js';
import * as deckCombos from '../src/engine/deck-combos.js';
import * as progress from '../src/engine/recall-progress.js';

const cards = [
  { id: 'a', energy: 0, power: {}, needsCost: false },
  { id: 'b', energy: 2, power: { order: 1 }, needsCost: false },
  { id: 'side', energy: 1, power: {}, needsCost: false },
];
const deck = { cards: [{ cardId: 'b', qty: 2 }, { cardId: 'a', qty: 1 }, { cardId: 'b', qty: 1 }],
  legend: 'side', champion: 'side', sideboard: [{ cardId: 'side', qty: 3 }], runes: { order: 12 } };

test('AC-CMB-01: sólo el main completo aporta IDs y copias, fusionados por ID', () => {
  const result = normalizeDeck(deck, cards);
  assert.equal(result.ok, true);
  assert.deepEqual(result.index.cards, [
    { id: 'a', qty: 1, energy: 0, power: {} },
    { id: 'b', qty: 3, energy: 2, power: { order: 1 } },
  ]);
  const outside = checkCard('side', { runes: [] }, result.index);
  assert.equal(outside.ok, false);
  assert.equal(outside.reason, 'La carta side no está en el mazo principal');
});

test('AC-CMB-01: el JSON real del deck excluye legend y champion del universo', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const result = normalizeDeck(data.decks[0], data.cards);
  assert.equal(result.ok, true);
  assert.equal(result.index.cards.length, 21);
  assert.equal(result.index.cards.reduce((total, c) => total + c.qty, 0), 39);
  assert.equal(result.index.byId.has(data.decks[0].legend), false);
  assert.equal(result.index.byId.has(data.decks[0].champion), false);
});

// ---- Campeón en el recall (AC-CHA-01..07) ----
// 'champ' es un fixture de test (no un dato de cartas); el caso real usa Kennen de data/cards.json.
const champCards = [
  { id: 'a', energy: 1, power: {} },
  { id: 'champ', energy: 3, power: { chaos: 1 } },
  { id: 'zeroChamp', energy: 0, power: {} },
];
const champDeck = (champion, entries = [{ cardId: 'a', qty: 3 }]) => ({ cards: entries, champion });

test('AC-CHA-01: el campeón fuera de deck.cards entra al índice con qty 1 y su coste del catálogo', () => {
  const result = normalizeDeck(champDeck('champ'), champCards);
  assert.equal(result.ok, true);
  assert.deepEqual(result.index.byId.get('champ'), { id: 'champ', qty: 1, energy: 3, power: { chaos: 1 } });
  assert.deepEqual(result.index.cards.map((c) => c.id), ['a', 'champ']);
});

test('AC-CHA-01: el campeón real del mazo (Kennen) entra al índice con 3 de Energía + 1 Chaos', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const deck = data.decks[0];
  const { index } = normalizeDeck(deck, data.cards);
  assert.deepEqual(index.byId.get(deck.champion), { id: deck.champion, qty: 1, energy: 3, power: { chaos: 1 } });
  assert.equal(index.byId.has(deck.legend), false);
});

test('AC-CHA-02: con el campeón ya en deck.cards hay una sola entrada y suma una copia', () => {
  const result = normalizeDeck(champDeck('champ', [{ cardId: 'a', qty: 3 }, { cardId: 'champ', qty: 2 }]), champCards);
  assert.equal(result.ok, true);
  assert.equal(result.index.cards.filter((c) => c.id === 'champ').length, 1);
  assert.equal(result.index.byId.get('champ').qty, 3);
});

test('AC-CHA-03: sin campeón (null o ausente) el índice es idéntico al de hoy', () => {
  const base = normalizeDeck({ cards: [{ cardId: 'a', qty: 3 }] }, champCards);
  for (const champion of [null, undefined]) {
    const result = normalizeDeck({ cards: [{ cardId: 'a', qty: 3 }], champion }, champCards);
    assert.deepEqual(result, base);
  }
  assert.deepEqual(base.index.cards, [{ id: 'a', qty: 3, energy: 1, power: {} }]);
});

test('AC-CMB-13: entradas main desconocidas o con cantidades inválidas bloquean el índice entero', () => {
  for (const entries of [
    [{ cardId: 'a', qty: 1 }, { cardId: 'missing', qty: 1 }],
    [{ cardId: 'a', qty: 0 }], [{ cardId: 'a', qty: 1.5 }],
    [{ cardId: 'a', qty: Number.MAX_SAFE_INTEGER }, { cardId: 'a', qty: 1 }],
  ]) {
    const result = normalizeDeck({ cards: entries }, cards);
    assert.equal(result.ok, false);
    assert.match(result.reason, /desconocido|Cantidad inválida/);
    assert.equal(result.index, undefined);
  }
});

test('AC-CMB-13: coste sin completar o dominio/poder no válido no se interpreta como cero', () => {
  for (const bad of [
    { energy: null }, { energy: undefined }, { energy: -1 }, { energy: 1.5 },
    { power: null }, { power: { lunar: 1 } }, { power: { order: -1 } },
    { power: { order: null } }, { needsCost: true },
  ]) {
    const result = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, [{ ...cards[0], ...bad }]);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.match(result.reason, /Coste|Poder|dominio/);
    assert.equal(result.index, undefined);
  }
});

test('AC-CMB-13: un Map de poder no se puede convertir silenciosamente en coste cero', () => {
  const result = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] },
    [{ ...cards[0], power: new Map([['order', 1]]) }]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Coste|Poder/);
  assert.equal(result.index, undefined);
});

test('AC-CMB-13: formas no planas de poder se rechazan; objeto sin prototipo conserva su coste', () => {
  const inherited = Object.create({ order: 1 });
  const nullProto = Object.assign(Object.create(null), { order: 1 });
  for (const power of [new Date(0), [], inherited]) {
    const result = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, [{ ...cards[0], power }]);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Coste|Poder/);
  }
  const valid = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, [{ ...cards[0], power: nullProto }]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.index.cards[0].power, { order: 1 });
});

const runes = (domain, n, ready = true) => Array.from({ length: n }, () => ({ domain, ready }));

// ---- Muro del mazo: checkCard (AC-ARC-01..04) ----
const wallCards = [
  { id: 'zero', energy: 0, power: {} },
  { id: 'floater', energy: 3, power: { fury: 1 } },
  { id: 'ord2', energy: 1, power: { order: 2 } },
  { id: 'big', energy: 5, power: {} },
  { id: 'side', energy: 1, power: {} },
];
const wallDeck = { cards: ['zero', 'floater', 'ord2', 'big'].map((cardId) => ({ cardId, qty: 2 })) };
const wallIndex = normalizeDeck(wallDeck, wallCards, { policy: 'positive-energy' }).index;
const rune = (domain, ready = true) => ({ domain, ready });
const board = (...runes) => ({ runes });

test('AC-ARC-03: 3 de Energía + 1 Fury se paga con exactamente 3 runas Fury (floating)', () => {
  const result = checkCard('floater', board(rune('fury'), rune('fury'), rune('fury')), wallIndex);
  assert.equal(result.ok, true);
  assert.equal(result.cardId, 'floater');
  assert.equal(result.reason, null);
  assert.equal(result.cost.energy, 3);
  assert.equal(result.cost.powerTotal, 1);
  assert.equal(result.detail.kind, 'ok');
});

test('AC-ARC-01: sin runas del dominio pedido devuelve el motivo y detail de dominio', () => {
  const result = checkCard('ord2', board(rune('fury'), rune('fury')), wallIndex);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Order/);
  assert.deepEqual(result.detail, { kind: 'domain', domain: 'order', need: 2, have: 0 });
});

test('AC-ARC-02: más Energía que runas abiertas devuelve detail de energía', () => {
  const result = checkCard('big', board(rune('fury'), rune('fury'), rune('fury', false)), wallIndex);
  assert.equal(result.ok, false);
  assert.deepEqual(result.detail, { kind: 'energy', need: 5, have: 2 });
});

test('AC-ARC-02: una runa agotada cuenta para el Poder pero no para la Energía', () => {
  const power = checkCard('ord2', board(rune('order', false), rune('order', false), rune('fury')), wallIndex);
  assert.equal(power.ok, true);
  const energy = checkCard('floater', board(rune('fury'), rune('fury'), rune('fury', false)), wallIndex);
  assert.equal(energy.ok, false);
  assert.deepEqual(energy.detail, { kind: 'energy', need: 3, have: 2 });
});

test('AC-ARC-04: id fuera del mazo, Energía 0, id vacío o runas inválidas se rechazan con motivo y sin detail', () => {
  const runes = board(rune('fury'), rune('fury'), rune('fury'));
  const cases = [
    ['side', /side.*mazo principal/],
    ['zero', /Energía 0 no cuentan/],
    ['', /Falta|vacío|mazo principal/],
    [undefined, /Falta|vacío|mazo principal/],
  ];
  for (const [id, message] of cases) {
    const result = checkCard(id, runes, wallIndex);
    assert.equal(result.ok, false, String(id));
    assert.match(result.reason, message);
    assert.equal(result.detail, null);
    assert.equal(result.cost, null);
  }
  for (const bad of [board(rune('lunar')), board({ domain: 'fury', ready: 'si' }), { runes: null }, undefined]) {
    const result = checkCard('big', bad, wallIndex);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
    assert.equal(result.detail, null);
  }
});

// ---- Muro del mazo: payableCards (AC-ARC-09..11) ----
// Object.freeze NO congela un Map (.set/.delete siguen andando): se los anula a mano.
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (value instanceof Map || value instanceof Set) {
      for (const method of ['set', 'add', 'delete', 'clear']) {
        if (method in value) value[method] = () => { throw new TypeError(`mutación de ${value.constructor.name}.${method}`); };
      }
    }
    Object.freeze(value);
    for (const child of (value instanceof Map ? [...value.values()] : Object.values(value))) deepFreeze(child);
  }
  return value;
};

test('AC-ARC-09: payableCards devuelve ids distintos del mazo, sin repetir por copias', () => {
  const runes = board(rune('fury'), rune('fury'), rune('fury'), rune('order'), rune('order'));
  const result = payableCards(wallIndex, runes);
  assert.deepEqual(result, { ok: true, cardIds: ['big', 'floater', 'ord2'] });
  assert.equal(new Set(result.cardIds).size, result.cardIds.length);
  for (const id of result.cardIds) assert.equal(checkCard(id, runes, wallIndex).ok, true);
});

test('AC-ARC-10: excluye Energía 0 e impagables, respeta el orden del índice y es determinista', () => {
  const rich = board(...Array.from({ length: 5 }, () => rune('fury')), rune('order'), rune('order'));
  const result = payableCards(wallIndex, rich);
  assert.deepEqual(result.cardIds, wallIndex.cards.map((c) => c.id).filter((id) => id !== 'zero'));
  assert.equal(result.cardIds.includes('zero'), false);
  assert.deepEqual(payableCards(wallIndex, rich), result);
  const poor = payableCards(wallIndex, board(rune('fury')));
  assert.deepEqual(poor, { ok: true, cardIds: [] });
});

test('AC-ARC-10: payableCards no muta el índice ni el escenario', () => {
  const frozenIndex = deepFreeze(normalizeDeck(wallDeck, wallCards, { policy: 'positive-energy' }).index);
  const frozenScenario = deepFreeze(board(rune('fury'), rune('fury'), rune('fury')));
  assert.deepEqual(payableCards(frozenIndex, frozenScenario).cardIds, ['floater']);
});

test('AC-ARC-10: entradas inválidas devuelven ok=false con motivo', () => {
  for (const [index, scenario] of [[undefined, board()], [wallIndex, undefined], [wallIndex, board(rune('lunar'))], [wallIndex, { runes: null }]]) {
    const result = payableCards(index, scenario);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  }
});

test('AC-ARC-11: payableCards y checkCard coinciden con un oráculo independiente (canPlayCard sobre la carta cruda) en el mazo real', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const deck = data.decks[0];
  const { index } = normalizeDeck(deck, data.cards, { policy: 'positive-energy' });
  const raw = new Map(data.cards.map((card) => [card.id, card]));
  let some = 0;
  let unpayable = 0;
  for (const seed of [1, 7, 42, 108]) {
    for (const level of [1, 3, 6, 9, 12]) {
      const made = createRecallScenario(deck, index, seed, level);
      assert.equal(made.ok, true);
      // El oráculo no pasa por el índice ni por checkCard: la carta tal cual viene de cards.json.
      const expected = index.cards.map(({ id }) => id).filter((id) => canPlayCard(raw.get(id), made.scenario.runes).ok);
      const payable = payableCards(index, made.scenario);
      assert.deepEqual(payable, { ok: true, cardIds: expected }, `seed ${seed} nivel ${level}`);
      for (const { id } of index.cards) {
        assert.equal(checkCard(id, made.scenario, index).ok, expected.includes(id), `${id} seed ${seed} nivel ${level}`);
      }
      some += expected.length;
      unpayable += index.cards.length - expected.length;
    }
  }
  assert.ok(some > 0 && unpayable > 0, 'hay niveles con pagables y con impagables: el oráculo discrimina');
});

const manyRunes = (domain, n, ready = true) => Array.from({ length: n }, () => rune(domain, ready));

test('AC-ARC-04: un índice alterado tras normalizar (poder como Map) no se interpreta como coste cero', () => {
  const { index } = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, [{ id: 'a', energy: 1, power: {} }]);
  index.cards[0].power = new Map([['order', 1]]);
  const scenario = board(rune('order'));
  const check = checkCard('a', scenario, index);
  assert.equal(check.ok, false);
  assert.match(check.reason, /inválid|desconocid/i);
  assert.equal(check.detail, null);
  assert.equal(payableCards(index, scenario).ok, false);
});

test('AC-CMB-49: la política recall saca la Energía 0 (incluso con Poder) del muro sin tocar el juego', () => {
  const fixture = [
    { id: 'free', energy: 0, power: {} },
    { id: 'seal', energy: 0, power: { chaos: 1 } },
    { id: 'paid', energy: 1, power: {} },
  ];
  const deck = { cards: fixture.map(({ id }) => ({ cardId: id, qty: 1 })) };
  const full = normalizeDeck(deck, fixture);
  const recall = normalizeDeck(deck, fixture, { policy: 'positive-energy' });
  assert.equal(full.ok, true);
  assert.equal(recall.ok, true);
  assert.deepEqual(full.index.cards.map((c) => c.id), ['free', 'paid', 'seal']);
  assert.deepEqual(recall.index.cards.map((c) => c.id), ['paid']);
  assert.deepEqual(recall.index.fullCards.map((c) => c.id), ['free', 'paid', 'seal']);
  const scenario = board(rune('chaos'));
  assert.equal(canPlayCard(fixture[1], scenario.runes).ok, true, 'Seal sigue legal en juego');
  assert.deepEqual(payableCards(full.index, scenario).cardIds, ['free', 'paid', 'seal']);
  assert.deepEqual(payableCards(recall.index, scenario).cardIds, ['paid']);
  for (const id of ['free', 'seal']) {
    const check = checkCard(id, scenario, recall.index);
    assert.equal(check.ok, false);
    assert.match(check.reason, /Energía 0 no cuentan en este entrenamiento/);
    assert.equal(check.detail, null);
  }
});

test('AC-CMB-50: un mazo sólo de Energía 0 no tiene pagables; un coste inválido en la excluida bloquea todo', () => {
  const free = { id: 'zero', energy: 0, power: { chaos: 1 } };
  const deck = { cards: [{ cardId: 'zero', qty: 2 }] };
  const filtered = normalizeDeck(deck, [free], { policy: 'positive-energy' });
  assert.equal(filtered.ok, true);
  assert.deepEqual(filtered.index.cards, []);
  assert.deepEqual(payableCards(filtered.index, board(rune('chaos'))), { ok: true, cardIds: [] });
  for (const invalid of [{ ...free, energy: null }, { ...free, power: { lunar: 1 } }]) {
    const result = normalizeDeck(deck, [invalid], { policy: 'positive-energy' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Coste|dominio/);
    assert.equal(result.index, undefined);
  }
});

test('AC-CMB-49/50: el mazo real excluye a Seal pero conserva copias y la carta Ride', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const full = normalizeDeck(data.decks[0], data.cards);
  const paid = normalizeDeck(data.decks[0], data.cards, { policy: 'positive-energy' });
  assert.equal(full.index.cards.length, 21);
  assert.equal(full.index.cards.reduce((sum, c) => sum + c.qty, 0), 39);
  assert.equal(paid.index.cards.length, 20);
  assert.equal(paid.index.cards.reduce((sum, c) => sum + c.qty, 0), 36);
  assert.equal(paid.index.byId.has('seal-of-discord'), false);
  assert.equal(paid.index.byId.has('ride-the-wind'), true);
});

test('AC-ARC-11: payableCards coincide con el oráculo de cartas sueltas (canPlayCard) en el mazo real', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const { index } = normalizeDeck(data.decks[0], data.cards, { policy: 'positive-energy' });
  const catalog = new Map(data.cards.map((c) => [c.id, c]));
  let payableSeen = 0;
  for (const runes of [
    [...manyRunes('chaos', 9), ...manyRunes('order', 3)], manyRunes('chaos', 1), manyRunes('order', 1),
    [...manyRunes('chaos', 2), ...manyRunes('order', 1)], [...manyRunes('chaos', 4), ...manyRunes('order', 2)],
    [...manyRunes('order', 1), ...manyRunes('chaos', 1, false)], [],
  ]) {
    const oracle = index.cards.filter(({ id }) => canPlayCard(catalog.get(id), runes).ok).map(({ id }) => id);
    assert.deepEqual(payableCards(index, { runes }).cardIds, oracle, JSON.stringify(runes.length));
    payableSeen += oracle.length;
  }
  assert.ok(payableSeen > 10, 'el oráculo no es vacuo');
});

test('AC-ARC-26: el motor ya no exporta nada de las combinaciones ni los nombres V2', () => {
  for (const name of ['canonicalGroup', 'validateGroup', 'countGroups', 'countGroupsAsync', 'createMissingPager', 'isExactCountFor']) {
    assert.equal(deckCombos[name], undefined, name);
  }
  for (const name of ['startRecallV2', 'reduceRecallV2', 'advanceRecallV2']) assert.equal(progress[name], undefined, name);
  for (const name of ['startRecall', 'reduceRecall', 'advanceRecall', 'levelCardOutcomes']) {
    assert.equal(typeof progress[name], 'function', name);
  }
  assert.deepEqual(Object.keys(deckCombos).sort(), ['checkCard', 'normalizeDeck', 'payableCards']);
});

test('AC-ARC-26: los módulos de UI de la bandeja y del arco ya no existen', async () => {
  for (const file of ['combo-results', 'arc']) {
    await assert.rejects(import(`../src/ui/${file}.js`), { code: 'ERR_MODULE_NOT_FOUND' }, file);
  }
});

// ---- Cartas de dos dominios en el índice del mazo (AC-DUO-06..07)
const duoCards = [
  { id: 'blade', energy: 3, power: {}, powerAny: { amount: 1, domains: ['calm', 'chaos'] } },
  { id: 'plain', energy: 1, power: {} },
];
const duoDeck = { cards: [{ cardId: 'blade', qty: 3 }, { cardId: 'plain', qty: 3 }], runes: { chaos: 6, order: 6 } };

test('AC-DUO-06: el índice conserva el Poder de dos dominios y lo cobra con cualquiera de los dos', () => {
  const normalized = normalizeDeck(duoDeck, duoCards, { policy: 'positive-energy' });
  assert.equal(normalized.ok, true, normalized.reason);
  assert.deepEqual(normalized.index.byId.get('blade').powerAny, { amount: 1, domains: ['calm', 'chaos'] });
  const chaos = { runes: [0, 1, 2].map(() => ({ domain: 'chaos', ready: true })) };
  const order = { runes: [0, 1, 2].map(() => ({ domain: 'order', ready: true })) };
  assert.equal(checkCard('blade', chaos, normalized.index).ok, true);
  const rejected = checkCard('blade', order, normalized.index);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /Calm o Chaos/);
});

test('AC-DUO-06: un Poder de dos dominios mal formado se rechaza con motivo', () => {
  for (const powerAny of [{ amount: 0, domains: ['calm', 'chaos'] }, { amount: 1, domains: ['calm'] },
    { amount: 1, domains: ['calm', 'lunar'] }, { amount: 1, domains: ['calm', 'calm'] }, { amount: 1.5, domains: ['calm', 'chaos'] }, null, 'calm']) {
    const bad = normalizeDeck(duoDeck, [{ ...duoCards[0], powerAny }, duoCards[1]]);
    assert.equal(bad.ok, false, JSON.stringify(powerAny));
    assert.ok(bad.reason);
  }
});

test('AC-DUO-07: la identidad de la mesa cambia si cambia el Poder de dos dominios', () => {
  const a = normalizeDeck(duoDeck, duoCards, { policy: 'positive-energy' }).index;
  const otro = [{ ...duoCards[0], powerAny: { amount: 1, domains: ['calm', 'order'] } }, duoCards[1]];
  const b = normalizeDeck(duoDeck, otro, { policy: 'positive-energy' }).index;
  assert.notEqual(createRecallScenario(duoDeck, a, 7, 3).scenario.identity, createRecallScenario(duoDeck, b, 7, 3).scenario.identity);
});
