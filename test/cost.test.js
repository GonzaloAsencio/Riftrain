import test from 'node:test';
import assert from 'node:assert/strict';
import { cardCost, canPlayCard, canPlaySet, availableRunes, boardAfterPaying, costLabel } from '../src/engine/cost.js';
import { makeBoard } from '../src/engine/runes.js';

const card = (id, energy, power = {}, extra = {}) => ({
  id, name: id, energy, power, type: 'unit', domain: Object.keys(power)[0] ?? 'fury', ...extra,
});

test('AC-COST-01: EL CONCEPTO CRITICO — 3 de Energia + 1 Fury cuesta CUATRO runas, no tres', () => {
  const c = card('x', 3, { fury: 1 });
  const cost = cardCost(c);
  assert.equal(cost.runes, 4, 'tres agotadas mas una reciclada');
  assert.equal(cost.energy, 3);
  assert.equal(cost.powerTotal, 1);

  const tresRunas = makeBoard(['fury', 'fury', 'fury']);
  assert.equal(canPlayCard(c, tresRunas).ok, false, 'con 3 runas NO se paga');

  const cuatroRunas = makeBoard(['fury', 'fury', 'fury', 'fury']);
  assert.equal(canPlayCard(c, cuatroRunas).ok, true);
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
  assert.equal(r.reason, 'Pide 2 Order y no hay runas Order disponibles');
});

test('AC-COST-04: el motivo por runas totales dice el desglose', () => {
  const runas = makeBoard(['fury', 'fury', 'fury']);
  const cara = card('c', 5, { fury: 1 });
  const r = canPlayCard(cara, runas);
  assert.equal(r.ok, false);
  assert.match(r.reason, /6 runas/);
  assert.match(r.reason, /5 \+ 1 Fury/);
  assert.match(r.reason, /3 disponibles/);
});

test('AC-COST-05: "abiertas" NO es lo mismo que "en mesa" — las agotadas no pagan', () => {
  const seisEnMesa = makeBoard(['fury', 'fury', 'calm', 'calm', 'mind', 'mind'], { readyCount: 2 });
  const avail = availableRunes(seisEnMesa);
  assert.equal(avail.onBoard, 6);
  assert.equal(avail.total, 2, 'ya jugo algo este turno: le quedan 2');

  const deTres = card('t', 3);
  assert.equal(canPlayCard(deTres, seisEnMesa).ok, false, 'tiene 6 en mesa pero NO puede pagar 3');
});

test('AC-COST-06: la Energia es incolora — la paga cualquier runa que sobre', () => {
  const runas = makeBoard(['chaos', 'chaos', 'chaos', 'fury']);
  const c = card('m', 3, { fury: 1 });
  assert.equal(canPlayCard(c, runas).ok, true, '3 de energia pagados con runas Chaos');
});

test('AC-COST-07: multiples dominios en la misma carta', () => {
  const c = card('multi', 1, { fury: 1, order: 2 });
  assert.equal(cardCost(c).runes, 4);

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

test('AC-COST-09: canPlaySet suma el pool comun del turno', () => {
  const runas = makeBoard(['fury', 'fury', 'calm', 'calm', 'mind']);
  const a = card('a', 1, { fury: 1 });
  const b = card('b', 1, { calm: 1 });
  assert.equal(canPlaySet([a, b], runas).ok, true, '4 runas de 5');

  const c = card('c', 2);
  assert.equal(canPlaySet([a, b, c], runas).ok, false, '6 runas y solo hay 5');
});

test('AC-COST-10: costLabel arma el texto que se muestra en la carta', () => {
  assert.equal(costLabel(cardCost(card('a', 3, { fury: 1 }))), '3 + 1 Fury');
  assert.equal(costLabel(cardCost(card('b', 0, { order: 2 }))), '2 Order');
  assert.equal(costLabel(cardCost(card('c', 4))), '4');
});

test('AC-COST-11: el conjunto vacio siempre se puede jugar', () => {
  assert.equal(canPlaySet([], makeBoard([])).ok, true);
});
