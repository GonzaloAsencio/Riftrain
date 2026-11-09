import test from 'node:test';
import assert from 'node:assert/strict';
import { cardCost, rejectionRunes, canPlayCard, canPlaySet, availableRunes, boardAfterPaying, costLabel } from '../src/engine/cost.js';
import { makeBoard } from '../src/engine/runes.js';

const card = (id, energy, power = {}, extra = {}) => ({
  id, name: id, energy, power, type: 'unit', domain: Object.keys(power)[0] ?? 'fury', ...extra,
});

/**
 * EL CONCEPTO CRITICO, CORREGIDO (2026-09-19).
 *
 * Hasta esta fecha el motor cobraba energia + poder: 3 + 1 Fury = 4 runas. ESO
 * ERA UN BUG, y de los caros: rechazaba jugadas que en la mesa real se hacen.
 *
 * La regla de verdad ("rune floating"): una runa tiene DOS usos y los dos se
 * pueden usar en el mismo turno. Se agota para dar 1 de Energia, y despues se
 * recicla para dar 1 de Poder de su dominio. Primero agotar, despues reciclar:
 * al reves no, porque reciclada ya no esta.
 *
 * Entonces 3 de Energia + 1 de Poder Fury se paga con TRES runas Fury: se
 * agotan las tres (3 de Energia) y una de esas mismas se recicla (1 de Poder).
 *
 * Lo que NO cambia es lo unico que importa del Poder: sigue siendo especifico
 * de dominio, y sigue saliendo de la mesa para siempre.
 */
test('AC-COST-01: 3 de Energia + 1 Fury se paga con TRES runas Fury, no cuatro', () => {
  const c = card('x', 3, { fury: 1 });
  const cost = cardCost(c);
  assert.equal(cost.energy, 3);
  assert.equal(cost.powerTotal, 1);
  assert.equal(cost.runes, 3, 'la reciclada es UNA de las tres agotadas');

  const tresRunas = makeBoard(['fury', 'fury', 'fury']);
  assert.equal(canPlayCard(c, tresRunas).ok, true, 'con 3 runas Fury SI se paga');

  // Pero sigue haciendo falta una runa del dominio: 3 Order no lo pagan.
  const tresOrder = makeBoard(['order', 'order', 'order']);
  const no = canPlayCard(c, tresOrder);
  assert.equal(no.ok, false, 'no hay ninguna Fury para reciclar');
  assert.match(no.reason, /Fury/);
});

test('AC-COST-12: FLOATING — una runa agotada igual se puede reciclar', () => {
  // Tres Fury en mesa, una sola abierta. La carta pide 1 de Poder Fury y nada
  // de Energia: se recicla cualquiera de las tres, agotada o no.
  const c = card('p', 0, { fury: 1 });
  const casiTodasAgotadas = makeBoard(['fury', 'fury', 'fury'], { readyCount: 1 });
  assert.equal(canPlayCard(c, casiTodasAgotadas).ok, true);

  const ninguna = makeBoard(['fury', 'fury', 'fury'], { readyCount: 0 });
  assert.equal(canPlayCard(c, ninguna).ok, true, 'reciclar no necesita que este abierta');
});

test('AC-COST-13: la Energia SI necesita runas abiertas', () => {
  // 3 Chaos en mesa pero solo 2 abiertas: la energia no llega, aunque para
  // reciclar sobre. Es el caso que separa las dos mitades de la regla.
  const c = card('sc', 3, { chaos: 1 });
  const dosAbiertas = makeBoard(['chaos', 'chaos', 'chaos'], { readyCount: 2 });
  const r = canPlayCard(c, dosAbiertas);
  assert.equal(r.ok, false);
  assert.match(r.reason, /abiertas?/i, 'el motivo habla de runas abiertas, no de dominios');

  const tresAbiertas = makeBoard(['chaos', 'chaos', 'chaos']);
  assert.equal(canPlayCard(c, tresAbiertas).ok, true);
});

test('AC-COST-02: el ejemplo textual del usuario — 5 runas, solo 1 Fury', () => {
  const runas = makeBoard(['fury', 'calm', 'calm', 'mind', 'body']);
  const unaFury = card('a', 0, { fury: 1 });
  const otraFury = card('b', 0, { fury: 1 });

  assert.equal(canPlayCard(unaFury, runas).ok, true, 'una carta que pida 1 Fury: SI');

  const dos = canPlaySet([unaFury, otraFury], runas);
  assert.equal(dos.ok, false, 'dos cartas que pidan 1 Fury cada una: NO');
  assert.match(dos.reason, /Fury/, 'y el motivo tiene que nombrar el dominio');
});

test('AC-COST-03: el motivo del rechazo por dominio es especifico y mostrable', () => {
  const runas = makeBoard(['fury', 'fury', 'mind', 'mind', 'calm']);
  const pideOrder = card('o', 0, { order: 2 });
  const r = canPlayCard(pideOrder, runas);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Pide 2 Order y no hay runas Order en mesa');
});

test('AC-COST-04: el motivo por falta de energia dice cuanto pide y cuanto hay', () => {
  const runas = makeBoard(['fury', 'fury', 'fury']);
  const cara = card('c', 5, { fury: 1 });
  const r = canPlayCard(cara, runas);
  assert.equal(r.ok, false);
  assert.match(r.reason, /5 de Energia/);
  assert.match(r.reason, /3 runas abiertas/);
});

test('AC-COST-05: "abiertas" no es lo mismo que "en mesa" — para la ENERGIA', () => {
  const seisEnMesa = makeBoard(['fury', 'fury', 'calm', 'calm', 'mind', 'mind'], { readyCount: 2 });
  const avail = availableRunes(seisEnMesa);
  assert.equal(avail.onBoard, 6);
  assert.equal(avail.total, 2, 'ya jugo algo este turno: le quedan 2 abiertas');

  const deTres = card('t', 3);
  assert.equal(canPlayCard(deTres, seisEnMesa).ok, false, 'tiene 6 en mesa pero solo 2 abiertas');

  // Para el Poder, en cambio, las 6 de la mesa sirven: reciclar no las necesita abiertas.
  assert.equal(avail.onBoardByDomain.fury, 2);
  assert.equal(canPlayCard(card('f', 0, { fury: 2 }), seisEnMesa).ok, true);
});

test('AC-COST-06: la Energia es incolora — la paga cualquier runa que sobre', () => {
  const runas = makeBoard(['chaos', 'chaos', 'chaos', 'fury']);
  const c = card('m', 3, { fury: 1 });
  assert.equal(canPlayCard(c, runas).ok, true, '3 de energia pagados con runas Chaos');
});

test('AC-COST-07: multiples dominios en la misma carta', () => {
  const c = card('multi', 1, { fury: 1, order: 2 });
  assert.equal(cardCost(c).runes, 3, '1 de energia y 3 de poder: mandan las 3 recicladas');

  const alcanza = makeBoard(['fury', 'order', 'order', 'calm']);
  assert.equal(canPlayCard(c, alcanza).ok, true);

  const faltaOrder = makeBoard(['fury', 'order', 'calm', 'calm']);
  const r = canPlayCard(c, faltaOrder);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Order/);
  assert.match(r.reason, /solo hay 1 runa Order/);
});

test('AC-COST-08: pagar Poder reduce la mesa del turno siguiente; la Energia no', () => {
  assert.equal(boardAfterPaying(cardCost(card('a', 5)), 10), 10, '5 de energia: se enderezan, mesa intacta');
  assert.equal(boardAfterPaying(cardCost(card('b', 0, { fury: 2 })), 10), 8, '2 de poder: -2 permanente');
  assert.equal(boardAfterPaying(cardCost(card('c', 3, { fury: 1 })), 10), 9, 'solo el poder cuenta');
});

test('AC-COST-09: canPlaySet usa el pool comun del turno', () => {
  const runas = makeBoard(['fury', 'fury', 'calm', 'calm', 'mind']);
  const a = card('a', 1, { fury: 1 });
  const b = card('b', 1, { calm: 1 });
  assert.equal(canPlaySet([a, b], runas).ok, true);

  // 4 de energia contra 5 abiertas: entra, porque las 2 recicladas salen de
  // esas mismas 5. Con la regla vieja esto se rechazaba por "6 runas".
  const c = card('c', 2);
  assert.equal(canPlaySet([a, b, c], runas).ok, true);

  // Lo que si lo rompe es pedir mas ENERGIA que runas abiertas.
  const caro = card('caro', 5);
  const no = canPlaySet([a, b, caro], runas);
  assert.equal(no.ok, false);
  assert.match(no.reason, /Energia/);
});

test('AC-COST-14: el Poder NO se comparte entre cartas — cada reciclada sale de la mesa', () => {
  // Dos cartas que piden 1 Fury cada una necesitan DOS runas Fury: la primera
  // reciclada ya no esta para la segunda.
  const unaSolaFury = makeBoard(['fury', 'calm', 'calm', 'mind', 'body']);
  const a = card('a', 0, { fury: 1 });
  const b = card('b', 0, { fury: 1 });
  const r = canPlaySet([a, b], unaSolaFury);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Fury/);
});

test('AC-COST-10: costLabel arma el texto que se muestra en la carta', () => {
  assert.equal(costLabel(cardCost(card('a', 3, { fury: 1 }))), '3 + 1 Fury');
  assert.equal(costLabel(cardCost(card('b', 0, { order: 2 }))), '2 Order');
  assert.equal(costLabel(cardCost(card('c', 4))), '4');
});

test('AC-COST-11: el conjunto vacio siempre se puede jugar', () => {
  assert.equal(canPlaySet([], makeBoard([])).ok, true);
});

// ---- Muro del mazo: rejectionRunes (AC-ARC-05..08) ----
// Forma pinneada: { indices: number[], missingDomain: string|null }. El design pedia
// number[]; el AC-ARC-06 exige missingDomain, asi que los indices viven en `.indices`.
const tableRunes = () => [
  { domain: 'fury', ready: true }, { domain: 'order', ready: false },
  { domain: 'fury', ready: false }, { domain: 'order', ready: true },
];

test('AC-ARC-05: detail de dominio con have>0 devuelve las runas de ese dominio en mesa, abiertas o agotadas', () => {
  const result = rejectionRunes({ kind: 'domain', domain: 'fury', need: 3, have: 2 }, tableRunes());
  assert.deepEqual(result, { indices: [0, 2], missingDomain: null });
});

test('AC-ARC-06: dominio ausente devuelve indices vacíos y el dominio faltante, sin lanzar', () => {
  const result = rejectionRunes({ kind: 'domain', domain: 'calm', need: 1, have: 0 }, tableRunes());
  assert.deepEqual(result, { indices: [], missingDomain: 'calm' });
  assert.deepEqual(rejectionRunes({ kind: 'domain', domain: 'calm', need: 1, have: 0 }, []),
    { indices: [], missingDomain: 'calm' });
});

test('AC-ARC-07: detail de energía devuelve sólo las runas abiertas', () => {
  const result = rejectionRunes({ kind: 'energy', need: 5, have: 2 }, tableRunes());
  assert.deepEqual(result, { indices: [0, 3], missingDomain: null });
});

test('AC-ARC-08: detail nulo, ok, desconocido o runas inválidas devuelven vacío; es pura y determinista', () => {
  const empty = { indices: [], missingDomain: null };
  for (const detail of [null, undefined, { kind: 'ok', recycled: 0, exhausted: 1 }, { kind: 'otra' }, {}]) {
    assert.deepEqual(rejectionRunes(detail, tableRunes()), empty);
  }
  assert.deepEqual(rejectionRunes({ kind: 'energy', need: 1, have: 0 }, null), empty);
  const frozen = Object.freeze(tableRunes().map((r) => Object.freeze(r)));
  const detail = Object.freeze({ kind: 'domain', domain: 'order', need: 2, have: 2 });
  assert.deepEqual(rejectionRunes(detail, frozen), rejectionRunes(detail, frozen));
  assert.deepEqual(frozen, tableRunes());
});

// ---- Cartas de dos dominios (AC-DUO): el Poder se paga con runas de CUALQUIERA de los dos.
// Regla fijada por el usuario (2026-11-09): Blade of the Exile (3 + 1 de Poder, Calm y Chaos)
// se paga reciclando una runa Calm o una Chaos.
const blade = card('blade', 3, {}, { powerAny: { amount: 1, domains: ['chaos', 'calm'] } });
const runes = (spec) => spec.map(([domain, ready]) => ({ domain, ready }));

test('AC-DUO-01: el Poder de dos dominios se paga con una runa de cualquiera de los dos', () => {
  assert.equal(canPlayCard(blade, runes([['chaos', true], ['chaos', true], ['chaos', true]])).ok, true);
  assert.equal(canPlayCard(blade, runes([['calm', true], ['fury', true], ['fury', true]])).ok, true);
  // Floating: una de las tres agotadas por Energía se recicla por Poder. Tres runas alcanzan.
  assert.equal(cardCost(blade).runes, 3);
  assert.equal(boardAfterPaying(cardCost(blade), 7), 6);
});

test('AC-DUO-02: sin runas de ninguno de los dos dominios se rechaza con su motivo', () => {
  const check = canPlayCard(blade, runes([['fury', true], ['fury', true], ['order', true]]));
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'Pide 1 de Poder Calm o Chaos y no hay runas Calm ni Chaos en mesa');
  assert.deepEqual(check.detail, { kind: 'domain', domains: ['calm', 'chaos'], need: 1, have: 0 });
  // Para reciclar no hace falta que esté abierta: una Calm agotada en mesa alcanza.
  assert.equal(canPlayCard(blade, runes([['fury', true], ['fury', true], ['order', true], ['calm', false]])).ok, true);
});

test('AC-DUO-03: con otras cartas en el mismo turno, el dominio fijo se reserva primero', () => {
  const calmOne = card('calm-one', 1, { calm: 1 });
  const board = runes([['calm', true], ['fury', true], ['fury', true], ['fury', true]]);
  const set = canPlaySet([calmOne, blade], board);
  assert.equal(set.ok, false, 'la única Calm la usa la carta de Calm fijo');
  assert.match(set.reason, /Calm o Chaos/);
  assert.equal(canPlaySet([calmOne, blade], runes([['calm', true], ['chaos', true], ['fury', true], ['fury', true]])).ok, true);
  // Dos cartas de dos dominios distintos que se pisan: Hall, no un reparto ciego.
  const encore = card('encore', 1, {}, { powerAny: { amount: 1, domains: ['mind', 'order'] } });
  const both = canPlaySet([blade, encore], runes([['chaos', true], ['order', true], ['fury', true], ['fury', true]]));
  assert.equal(both.ok, true);
  assert.equal(canPlaySet([blade, encore], runes([['chaos', true], ['fury', true], ['fury', true], ['fury', true]])).ok, false);
});

test('AC-DUO-04: el texto del coste nombra los dos dominios y las runas a resaltar son las de los dos', () => {
  assert.equal(costLabel(cardCost(blade)), '3 + 1 Calm/Chaos');
  const board = runes([['calm', true], ['fury', true], ['chaos', false]]);
  const detail = { kind: 'domain', domains: ['calm', 'chaos'], need: 2, have: 1 };
  assert.deepEqual(rejectionRunes(detail, board), { indices: [0, 2], missingDomain: null, missingDomains: [] });
  assert.deepEqual(rejectionRunes(detail, runes([['fury', true]])), { indices: [], missingDomain: null, missingDomains: ['calm', 'chaos'] });
});
