import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playableCards, verifyCombo, enumerateCombos, countCombos,
  mostExpensiveCombo, sneakyCombo,
} from '../src/engine/combos.js';
import { makeBoard } from '../src/engine/runes.js';

const card = (id, energy, power = {}) => ({
  id, name: id, energy, power, type: 'unit', domain: Object.keys(power)[0] ?? 'fury',
});

test('AC-CMB-01: playableCards marca cada carta con su motivo', () => {
  const runas = makeBoard(['fury', 'fury', 'calm']);
  const mano = [card('barata', 2), card('cara', 8), card('sinDominio', 0, { order: 1 })];
  const r = playableCards(mano, runas);

  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.match(r[1].reason, /8 runas/);
  assert.equal(r[2].ok, false);
  assert.match(r[2].reason, /Order/);
});

test('AC-CMB-02: LA TRAMPA — la de 5 tapa que tambien entran dos de 2 y una de 1', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury', 'fury']);
  const mano = [card('grande', 5), card('a', 2), card('b', 2), card('c', 1)];

  assert.equal(verifyCombo([mano[0]], runas).ok, true, 'la de 5 entra');
  const tres = verifyCombo([mano[1], mano[2], mano[3]], runas);
  assert.equal(tres.ok, true, '2 + 2 + 1 = 5, TAMBIEN entra');
  assert.equal(tres.cost.runes, 5);
});

test('AC-CMB-03: verificacion puntual — "puede jugar esta unidad Y ademas este hechizo?"', () => {
  const runas = makeBoard(['fury', 'fury', 'mind', 'mind']);
  const unidad = card('u', 1, { fury: 1 });
  const hechizo = card('h', 1, { mind: 1 });

  assert.equal(verifyCombo([unidad, hechizo], runas).ok, true, '4 runas justas');

  const pocas = makeBoard(['fury', 'mind', 'mind']);
  const r = verifyCombo([unidad, hechizo], pocas);
  assert.equal(r.ok, false);
  assert.match(r.reason, /4 runas/);
});

test('AC-CMB-04: la combinacion mas cara', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury', 'fury', 'fury']);
  const mano = [card('a', 4), card('b', 3), card('c', 3), card('d', 1)];
  const { best, spend } = mostExpensiveCombo(mano, runas);
  assert.equal(spend, 6, 'gasta las 6 runas');
  assert.ok(best.cards.length >= 2);
});

test('AC-CMB-05: los empates se devuelven aparte — la seleccion tiene que aceptar cualquiera', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury']);
  const mano = [card('a', 4), card('b', 4), card('c', 1)];
  const { spend, ties } = mostExpensiveCombo(mano, runas);
  assert.equal(spend, 4);
  assert.ok(ties.length >= 2, 'a sola y b sola gastan lo mismo');
});

test('AC-CMB-06: dos copias de la MISMA carta son una sola combinacion', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury']);
  const copia1 = card('shock', 1);
  const copia2 = card('shock', 1);
  const combos = enumerateCombos([copia1, copia2], runas);
  const claves = combos.map((c) => c.key);
  assert.equal(new Set(claves).size, claves.length, 'sin duplicados');
  assert.equal(combos.length, 2, 'solo {shock} y {shock,shock}');
});

test('AC-CMB-07: no puede jugar dos copias si tiene UNA sola en mano', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury']);
  const unaSola = [card('shock', 1)];
  assert.equal(countCombos(unaSola, runas), 1, 'la mano concreta manda, no el mazo');
});

test('AC-CMB-08: conteo de combinaciones', () => {
  const runas = makeBoard(['fury', 'fury']);
  const mano = [card('a', 1), card('b', 1), card('c', 3)];
  // jugables: {a} {b} {a,b}. La c cuesta 3 y hay 2 runas.
  assert.equal(countCombos(mano, runas), 3);
  assert.equal(countCombos(mano, runas, { minSize: 2 }), 1, 'solo {a,b}');
});

test('AC-CMB-09: sin runas disponibles no hay ninguna combinacion', () => {
  const agotadas = makeBoard(['fury', 'fury', 'fury'], { readyCount: 0 });
  const mano = [card('a', 1), card('b', 2)];
  assert.equal(countCombos(mano, agotadas), 0);
  assert.equal(mostExpensiveCombo(mano, agotadas).best, null);
});

test('AC-CMB-10: sneakyCombo detecta cuando la multi-carta le gana a la mejor sola', () => {
  const runas = makeBoard(['fury', 'fury', 'fury', 'fury', 'fury']);
  const mano = [card('grande', 4), card('a', 2), card('b', 2), card('c', 1)];
  const sneaky = sneakyCombo(mano, runas);
  assert.ok(sneaky, 'hay una trampa que ver');
  assert.equal(sneaky.bestSingle, 4);
  assert.equal(sneaky.combo.spend, 5, '2+2+1 le gana a la de 4');
});

test('AC-CMB-11: el conteo respeta los dominios, no solo el total', () => {
  const runas = makeBoard(['fury', 'calm', 'calm', 'calm']);
  const mano = [card('f1', 0, { fury: 1 }), card('f2', 0, { fury: 1 })];
  // Cada una sola: si. Las dos juntas: no, hay una sola runa Fury.
  assert.equal(countCombos(mano, runas), 2);
  assert.equal(countCombos(mano, runas, { minSize: 2 }), 0);
});
