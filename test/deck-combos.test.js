import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeDeck, checkCard, canonicalGroup, validateGroup, countGroups, countGroupsAsync, createMissingPager } from '../src/engine/deck-combos.js';
import { canPlayCard } from '../src/engine/cost.js';

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
  assert.deepEqual(canonicalGroup([{ cardId: 'side', qty: 1 }], result.index),
    { ok: false, reason: 'La carta side no está en el mazo principal' });
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

test('AC-CMB-02: rechaza ajenas, cantidades inválidas y exceso incluso al sumar entradas', () => {
  const { index } = normalizeDeck(deck, cards);
  for (const [entries, message] of [
    [[{ cardId: 'side', qty: 1 }], /side.*mazo principal/],
    [[{ cardId: 'a', qty: 0 }], /Cantidad inválida.*a/],
    [[{ cardId: 'b', qty: 1.5 }], /Cantidad inválida.*b/],
    [[{ cardId: 'b', qty: 4 }], /b.*3 copias/],
    [[{ cardId: 'b', qty: 2 }, { cardId: 'b', qty: 2 }], /b.*3 copias/],
  ]) {
    const result = canonicalGroup(entries, index);
    assert.equal(result.ok, false);
    assert.match(result.reason, message);
    assert.equal(result.key, undefined);
  }
});

test('AC-CMB-03: vacío no genera clave ni acierto; grupos no vacíos sí', () => {
  const { index } = normalizeDeck(deck, cards);
  assert.deepEqual(canonicalGroup([], index), { ok: false, reason: 'La combinación está vacía' });
  assert.deepEqual(canonicalGroup([{ cardId: 'a', qty: 1 }], index),
    { ok: true, group: [{ cardId: 'a', qty: 1 }], key: '[["a",1]]' });
});

test('AC-CMB-02: clave estable por multiset sin permutaciones ni copias físicas', () => {
  const { index } = normalizeDeck(deck, cards);
  const expected = { ok: true, group: [{ cardId: 'a', qty: 1 }, { cardId: 'b', qty: 2 }],
    key: '[["a",1],["b",2]]' };
  assert.deepEqual(canonicalGroup([{ cardId: 'b', qty: 1 }, { cardId: 'a', qty: 1 }, { cardId: 'b', qty: 1 }], index), expected);
  assert.deepEqual(canonicalGroup([{ cardId: 'a', qty: 1 }, { cardId: 'b', qty: 2 }], index), expected);
  assert.notEqual(canonicalGroup([{ cardId: 'b', qty: 1 }], index).key, expected.key);
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

test('AC-CMB-04: cartas individuales pagables se rechazan juntas por el coste agregado', () => {
  const { index } = normalizeDeck({ cards: [{ cardId: 'b', qty: 2 }] }, cards);
  const board = [...runes('order', 1), ...runes('chaos', 2)];
  assert.equal(validateGroup([{ cardId: 'b', qty: 1 }], { runes: board }, index).ok, true);
  const result = validateGroup([{ cardId: 'b', qty: 2 }], { runes: board }, index);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Order/);
  assert.equal(result.cost.energy, 4);
});

test('AC-CMB-05: cada respuesta se evalúa contra las runas originales sin gastarlas', () => {
  const { index } = normalizeDeck({ cards: [{ cardId: 'b', qty: 2 }] }, cards);
  const board = [...runes('order', 1), ...runes('chaos', 1)];
  const before = structuredClone(board);
  for (let i = 0; i < 2; i++) {
    const result = validateGroup([{ cardId: 'b', qty: 1 }], { runes: board }, index);
    assert.equal(result.ok, true);
    assert.deepEqual(result.cost, { energy: 2, power: { order: 1 }, powerTotal: 1, runes: 2 });
  }
  assert.deepEqual(board, before);
});

test('AC-CMB-07/08/09/10/32: floating, agotadas y motivo por energía o dominio', () => {
  const fixture = [{ id: 'f', energy: 3, power: { fury: 1 } },
    { id: 'p', energy: 0, power: { fury: 1 } }, { id: 'e', energy: 1, power: {} }];
  const { index } = normalizeDeck({ cards: fixture.map(({ id }) => ({ cardId: id, qty: 1 })) }, fixture);
  assert.equal(validateGroup([{ cardId: 'f', qty: 1 }], { runes: runes('fury', 3) }, index).ok, true);
  assert.equal(validateGroup([{ cardId: 'p', qty: 1 }], { runes: runes('fury', 1, false) }, index).ok, true);
  assert.match(validateGroup([{ cardId: 'e', qty: 1 }], { runes: runes('fury', 1, false) }, index).reason, /Energia/);
  assert.match(validateGroup([{ cardId: 'p', qty: 1 }], { runes: runes('order', 1) }, index).reason, /Fury/);
});

test('AC-CMB-11/12: objetivo exacto incluye individuales, repeticiones y sobrante sin tope 12', () => {
  const fixture = [{ id: 'zero', energy: 0, power: {} }, { id: 'one', energy: 1, power: {} }];
  const { index } = normalizeDeck({ cards: [{ cardId: 'zero', qty: 14 }, { cardId: 'one', qty: 2 }] }, fixture);
  assert.deepEqual(countGroups(index, runes('order', 1)), { status: 'exact', count: 29n });
  assert.equal(validateGroup([{ cardId: 'zero', qty: 14 }], { runes: runes('order', 1) }, index).ok, true);
  assert.equal(validateGroup([{ cardId: 'one', qty: 2 }], { runes: runes('order', 1) }, index).ok, false);
});

test('AC-CMB-11: un oráculo diminuto por vectores comprueba el DP en boards distintos', () => {
  const fixture = [{ id: 'x', energy: 1, power: {} }, { id: 'y', energy: 0, power: { chaos: 1 } }];
  const { index } = normalizeDeck({ cards: [{ cardId: 'x', qty: 2 }, { cardId: 'y', qty: 2 }] }, fixture);
  for (const board of [[], runes('chaos', 1), [...runes('chaos', 1), ...runes('order', 1)], runes('chaos', 2)]) {
    let expected = 0n;
    for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) {
      if (x + y && validateGroup([{ cardId: 'x', qty: x }, { cardId: 'y', qty: y }].filter((e) => e.qty), { runes: board }, index).ok) expected++;
    }
    assert.deepEqual(countGroups(index, board), { status: 'exact', count: expected });
  }
});

test('AC-CMB-13/26: entradas o recursos inválidos no equivalen a objetivo vacío', () => {
  assert.equal(countGroups(undefined, []).status, 'error');
  const { index } = normalizeDeck(deck, cards);
  assert.equal(countGroups(index, [{ domain: 'lunar', ready: true }]).status, 'error');
  assert.equal(validateGroup([{ cardId: 'missing', qty: 1 }], { runes: [] }, index).ok, false);
});

test('AC-CMB-11/32: cantidades exactas del deck real con abiertas y agotadas', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const { index } = normalizeDeck(data.decks[0], data.cards);
  for (const [chaos, order, exhausted, expected] of [
    [1, 0, 0, 5n], [0, 1, 0, 2n], [2, 1, 0, 97n],
    [4, 2, 0, 1936n], [9, 3, 0, 87169n], [0, 1, 1, 5n],
  ]) {
    assert.deepEqual(countGroups(index, [...runes('chaos', chaos), ...runes('order', order),
      ...runes('chaos', exhausted, false)]), { status: 'exact', count: expected });
  }
});

test('AC-CMB-26: el contador cooperativo cancela sin declarar vacío ni entregar un total viejo', async () => {
  const { index } = normalizeDeck(deck, cards);
  const controller = new AbortController();
  let yields = 0;
  const result = await countGroupsAsync(index, runes('order', 2), {
    yieldTo: async () => { yields++; controller.abort(); }, signal: controller.signal, chunk: 1,
  });
  assert.equal(yields, 1);
  assert.deepEqual(result, { status: 'pending' });
  assert.deepEqual(await countGroupsAsync(index, runes('order', 2), { yieldTo: async () => {} }),
    countGroups(index, runes('order', 2)));
});

test('AC-CMB-13/26: índice alterado tras normalizar no interpreta Map como poder gratis', () => {
  const { index } = normalizeDeck({ cards: [{ cardId: 'a', qty: 1 }] }, cards);
  index.cards[0].power = new Map([['order', 1]]);
  assert.equal(countGroups(index, runes('order', 1)).status, 'error');
  const result = validateGroup([{ cardId: 'a', qty: 1 }], { runes: runes('order', 1) }, index);
  assert.equal(result.ok, false);
  assert.match(result.reason, /inválid|desconocid/i);
});

test('AC-CMB-37/41: faltantes son todos los vectores pagables menos found, paginados sin cap', async () => {
  const fixture = [{ id: 'zero', energy: 0, power: {} }, { id: 'one', energy: 1, power: {} }];
  const { index } = normalizeDeck({ cards: [{ cardId: 'zero', qty: 14 }, { cardId: 'one', qty: 2 }] }, fixture);
  const scenario = { runes: runes('order', 1) };
  const target = countGroups(index, scenario.runes);
  assert.equal(target.count, 29n);
  const found = [canonicalGroup([{ cardId: 'zero', qty: 1 }], index),
    canonicalGroup([{ cardId: 'one', qty: 1 }], index)];
  const pager = createMissingPager(index, scenario, target, found, { pageSize: 8, chunk: 2, yieldTo: async () => {} });
  assert.equal(pager.ok, true);
  const collected = [];
  for (let page = 0; page < 4; page++) {
    const result = await pager.page(page);
    assert.equal(result.status, 'exact');
    assert.equal(result.total, 27n);
    assert.equal(result.groups.length, page === 3 ? 3 : 8);
    collected.push(...result.groups);
  }
  assert.equal(new Set(collected.map((group) => group.key)).size, 27);
  assert.equal(collected.some((group) => group.key === found[0].key || group.key === found[1].key), false);
  assert.equal(collected.some((group) => group.group.some((entry) => entry.cardId === 'zero' && entry.qty === 14)), true);
  for (const group of collected) assert.equal(validateGroup(group.group, scenario, index).ok, true);
});

test('AC-CMB-41/42: dominio agotado cuenta; objetivo vacío y blanco antiguo no son éxito', async () => {
  const fixture = [{ id: 'seal', energy: 0, power: { chaos: 1 } }];
  const { index } = normalizeDeck({ cards: [{ cardId: 'seal', qty: 1 }] }, fixture);
  const order = { runes: runes('order', 1) };
  const empty = createMissingPager(index, order, countGroups(index, order.runes), []);
  assert.deepEqual(await empty.page(0), { status: 'exact', groups: [], total: 0n });
  const mixed = { runes: [...runes('order', 1), ...runes('chaos', 1, false)] };
  const exact = countGroups(index, mixed.runes);
  const result = await createMissingPager(index, mixed, exact, []).page(0);
  assert.equal(result.total, 1n);
  assert.deepEqual(result.groups[0].group, [{ cardId: 'seal', qty: 1 }]);
  assert.equal(createMissingPager(index, mixed, { status: 'exact', count: 1n }, []).ok, false);
});

test('AC-CMB-41: cancelación cooperativa nunca devuelve página parcial como completa', async () => {
  const fixture = [{ id: 'zero', energy: 0, power: {} }];
  const { index } = normalizeDeck({ cards: [{ cardId: 'zero', qty: 1100 }] }, fixture);
  const scenario = { runes: runes('order', 1) };
  const controller = new AbortController();
  let yielded = 0;
  const pager = createMissingPager(index, scenario, countGroups(index, scenario.runes), [], {
    chunk: 1, signal: controller.signal, yieldTo: async () => { yielded++; controller.abort(); },
  });
  assert.deepEqual(await pager.page(0), { status: 'pending' });
  assert.equal(yielded, 1);
});

test('AC-CMB-49: política recall excluye energía0 incluso con Poder; índice genérico y juego intactos', async () => {
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
  const board = [{ domain: 'chaos', ready: true }];
  assert.equal(canPlayCard(fixture[1], board).ok, true, 'Seal sigue legal en juego');
  assert.deepEqual(countGroups(full.index, board), { status: 'exact', count: 7n });
  assert.deepEqual(countGroups(recall.index, board), { status: 'exact', count: 1n });
  for (const id of ['free', 'seal']) {
    const response = validateGroup([{ cardId: 'paid', qty: 1 }, { cardId: id, qty: 1 }], { runes: board }, recall.index);
    assert.equal(response.ok, false);
    assert.match(response.reason, /Energía 0 no cuentan en este entrenamiento/);
  }
  const pager = createMissingPager(recall.index, { runes: board }, countGroups(recall.index, board), []);
  assert.deepEqual((await pager.page(0)).groups.map(({ key }) => key), ['[["paid",1]]']);
});

test('AC-CMB-50: mazo sólo energía0 es vacío exacto, pero unknown en excluida bloquea todo', async () => {
  const free = { id: 'zero', energy: 0, power: { chaos: 1 } };
  const deck = { cards: [{ cardId: 'zero', qty: 2 }] };
  const filtered = normalizeDeck(deck, [free], { policy: 'positive-energy' });
  assert.equal(filtered.ok, true);
  assert.deepEqual(filtered.index.cards, []);
  const board = [{ domain: 'chaos', ready: true }];
  assert.deepEqual(countGroups(filtered.index, board), { status: 'exact', count: 0n });
  assert.deepEqual(await createMissingPager(filtered.index, { runes: board }, countGroups(filtered.index, board), []).page(0),
    { status: 'exact', groups: [], total: 0n });
  for (const invalid of [{ ...free, energy: null }, { ...free, power: { lunar: 1 } }]) {
    const result = normalizeDeck(deck, [invalid], { policy: 'positive-energy' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Coste|dominio/);
    assert.equal(result.index, undefined);
  }
});

test('AC-CMB-49/50: real deck positivo excluye Seal pero conserva qty y pago de Ride sin alterar datos', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const deck = data.decks[0];
  const full = normalizeDeck(deck, data.cards);
  const paid = normalizeDeck(deck, data.cards, { policy: 'positive-energy' });
  assert.equal(full.index.cards.length, 21);
  assert.equal(full.index.cards.reduce((sum, c) => sum + c.qty, 0), 39);
  assert.equal(paid.index.cards.length, 20);
  assert.equal(paid.index.cards.reduce((sum, c) => sum + c.qty, 0), 36);
  assert.equal(paid.index.byId.has('seal-of-discord'), false);
  assert.equal(paid.index.byId.has('ride-the-wind'), true);
  const board = [...runes('chaos', 9), ...runes('order', 3)];
  assert.equal(countGroups(full.index, board).count, 87169n);
  assert.equal(countGroups(paid.index, board).count, 21794n);
  for (const [chaos, order, expected] of [[1, 0, 2n], [0, 1, 2n], [2, 1, 36n], [4, 2, 524n]]) {
    const runesOnBoard = [...runes('chaos', chaos), ...runes('order', order)];
    assert.equal(countGroups(paid.index, runesOnBoard).count, expected);
  }
  assert.equal(countGroups(paid.index, [...runes('order', 1), ...runes('chaos', 1, false)]).count, 2n);
});

test('AC-CMB-52: Ride×2 suma 2 Chaos de Poder, una Chaos agotada adicional sí paga', async () => {
  const data = JSON.parse(await readFile(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const ride = data.cards.find((c) => c.id === 'ride-the-wind');
  assert.equal(ride.energy, 2);
  assert.deepEqual(ride.power, { chaos: 1 });
  const fixture = normalizeDeck({ cards: [{ cardId: ride.id, qty: 2 }] }, [ride]);
  const ready = [...runes('chaos', 1), ...runes('order', 3)];
  const exhausted = [...ready, ...runes('chaos', 1, false)];
  assert.match(validateGroup([{ cardId: ride.id, qty: 2 }], { runes: ready }, fixture.index).reason, /Pide 2 Chaos/);
  assert.equal(validateGroup([{ cardId: ride.id, qty: 2 }], { runes: exhausted }, fixture.index).ok, true);
  assert.equal(countGroups(fixture.index, ready).count, 1n);
  assert.equal(countGroups(fixture.index, exhausted).count, 2n);
  const actual = normalizeDeck(data.decks[0], data.cards);
  assert.match(canonicalGroup([{ cardId: ride.id, qty: 2 }], actual.index).reason, /1 copias/);
});

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
