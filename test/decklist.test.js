import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecklist } from '../src/engine/decklist.js';
import { expandDeck } from '../src/engine/scenario.js';
import { RUNE_DECK_SIZE } from '../src/engine/runes.js';

/**
 * El parser de decklists pegadas. PURO: no sabe que existe un textarea.
 *
 * No inventa cartas NUNCA. Si una linea no trae el costo, la carta queda
 * marcada como incompleta y alguien la va a tener que completar: el motor
 * necesita energia y poder por dominio para decidir si algo se puede pagar,
 * y adivinarlos seria entrenar con datos falsos.
 */

const byName = (r, name) => r.cards.find((c) => c.name === name);

/**
 * Un export de texto REAL de Piltover Archive, pegado tal cual.
 *
 * Es el insumo de los AC-SEC-*: las secciones vienen en ingles y sin '#', las
 * cantidades van adelante, y hay dos cartas (Gust y Salvage) que estan en el
 * MainDeck Y en el Sideboard. Esa repeticion es justamente la trampa: el parser
 * viejo las sumaba y daba 2 copias de algo que el rival solo puede jugar una vez.
 *
 * Las cuentas: 39 MainDeck + 12 runas + 3 battlefields + 10 sideboard + legend
 * + champion = 66 lineas de carta.
 */
const PILTOVER_EXPORT = `Legend:
1 Kennen, Heart of the Tempest

Champion:
1 Kennen, Storm of Shuriken

MainDeck:
3 Traveling Merchant
3 Rhasa the Sunderer
3 Seal of Discord
3 Shadow Order Disciple
3 Tail-Cloaked Matriarch
3 Lightning Rush
2 Switcheroo
2 Last Rites
2 Star-Crossed
2 Tornado Warrior
1 Gust
1 Ride the Wind
1 The Harrowing
1 Tideturner
1 Salvage
1 Flash
1 Treasure Hunter
1 Baron Nashor
1 Shadows of the Past
2 Fizz, Trickster
2 Ezreal, Prodigy

Battlefields:
1 Zaun Warrens
1 Minefield
1 Shadow Temple

Runes:
9 Chaos Rune
3 Order Rune

Sideboard:
3 Ravenbloom Prefect
2 Decree of Unity
1 Gust
1 Rebuke
1 Salvage
1 Hard Bargain
1 Angler Beast`;

const totalQty = (list) => list.reduce((a, c) => a + c.qty, 0);

test('AC-DCK-01: lee cantidad y nombre en las tres formas que usan los exports', () => {
  const r = parseDecklist('3 Chispa\n2x Descarga\nGranada x4');
  assert.equal(r.errors.length, 0);
  assert.equal(byName(r, 'Chispa').qty, 3);
  assert.equal(byName(r, 'Descarga').qty, 2);
  assert.equal(byName(r, 'Granada').qty, 4);
});

test('AC-DCK-02: sin cantidad, es una copia', () => {
  const r = parseDecklist('Tratado');
  assert.equal(byName(r, 'Tratado').qty, 1);
});

test('AC-DCK-03: el costo se lee cuando viene, con energia y poder por dominio', () => {
  const r = parseDecklist('3 Descarga | 2 + 1 fury\n1 Sello | 5 + 1 calm + 1 order\n2 Motin | 1 chaos');
  assert.deepEqual(byName(r, 'Descarga').power, { fury: 1 });
  assert.equal(byName(r, 'Descarga').energy, 2);
  assert.deepEqual(byName(r, 'Sello').power, { calm: 1, order: 1 });
  assert.equal(byName(r, 'Sello').energy, 5);
  assert.equal(byName(r, 'Motin').energy, 0, 'solo poder: la energia es cero, no se inventa');
  assert.deepEqual(byName(r, 'Motin').power, { chaos: 1 });
});

test('AC-DCK-04: sin costo NO se inventa nada: la carta queda incompleta', () => {
  const r = parseDecklist('2 Bastion');
  const c = byName(r, 'Bastion');
  assert.equal(c.needsCost, true);
  assert.equal(c.energy, null, 'null es "no se", 0 seria una mentira barata');
  assert.deepEqual(r.needsCost, [c.id]);
  assert.equal(r.errors.length, 0, 'no traer costo no es un error de formato');
});

test('AC-DCK-05: un costo con energia queda completo', () => {
  const r = parseDecklist('2 Bastion | 3');
  assert.equal(byName(r, 'Bastion').needsCost, false);
  assert.equal(byName(r, 'Bastion').energy, 3);
  assert.deepEqual(r.needsCost, []);
});

test('AC-DCK-06: todo rechazo devuelve su motivo', () => {
  const r = parseDecklist('0 Chispa\n3 \n2 Augurio | 1 lunar\n2 Motin | abc');
  assert.equal(r.cards.length, 0);
  assert.equal(r.errors.length, 4);
  for (const e of r.errors) {
    assert.ok(e.reason && e.reason.length > 5, `sin motivo: ${JSON.stringify(e)}`);
    assert.ok(Number.isInteger(e.line), 'el motivo tiene que decir en que linea');
  }
  assert.match(r.errors[2].reason, /lunar/, 'el dominio desconocido se nombra');
});

test('AC-DCK-07: comentarios y lineas vacias se ignoran sin ensuciar los errores', () => {
  const r = parseDecklist('# Aggro Fury\n\n// esto es una nota\n3 Chispa | 1\n\n');
  assert.equal(r.errors.length, 0);
  assert.equal(r.cards.length, 1);
});

test('AC-DCK-08: el nombre del mazo sale del encabezado', () => {
  const r = parseDecklist('# Aggro Fury/Chaos\n3 Chispa | 1');
  assert.equal(r.deck.name, 'Aggro Fury/Chaos');
});

test('AC-DCK-09: la misma carta repetida suma copias en vez de duplicarse', () => {
  const r = parseDecklist('2 Chispa | 1\n1 Chispa | 1');
  assert.equal(r.cards.length, 1);
  assert.equal(byName(r, 'Chispa').qty, 3);
  assert.equal(r.deck.cards.length, 1);
  assert.equal(r.deck.cards[0].qty, 3);
});

test('AC-DCK-10: los dominios del mazo salen de los costos, no de una lista aparte', () => {
  const r = parseDecklist('3 Descarga | 2 + 1 fury\n2 Motin | 1 chaos\n2 Bastion');
  assert.deepEqual([...r.deck.domains].sort(), ['chaos', 'fury']);
});

test('AC-DCK-11: el resultado entra tal cual en el motor de escenarios', () => {
  const r = parseDecklist('3 Chispa | 1\n2 Descarga | 2 + 1 fury');
  // El contrato que ya exige expandDeck(): deck.cards con { cardId, qty }.
  for (const entry of r.deck.cards) {
    assert.ok(entry.cardId, 'cada entrada del mazo tiene cardId');
    assert.ok(entry.qty >= 1);
    assert.ok(r.cards.some((c) => c.id === entry.cardId), 'y ese cardId existe en cards');
  }
});

test('AC-DCK-12: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => parseDecklist(null), TypeError);
  assert.throws(() => parseDecklist(42), TypeError);
  assert.throws(() => parseDecklist(), TypeError);
});

// ------------------------------------------------- secciones del export (SEC)

test('AC-SEC-01: los encabezados de seccion no son cartas', () => {
  const r = parseDecklist(PILTOVER_EXPORT);
  const zones = [r.cards, r.sideboard, r.battlefields];
  for (const zone of zones) {
    for (const c of zone) {
      assert.ok(!c.name.endsWith(':'), `se colo un encabezado como carta: ${c.name}`);
    }
  }
  assert.equal(byName(r, 'MainDeck'), undefined);
  assert.equal(byName(r, 'Sideboard'), undefined);
});

test('AC-SEC-02: el encabezado se reconoce sin importar mayusculas ni espacios', () => {
  const r = parseDecklist('MAINDECK :\n3 Chispa | 1\nsideboard:\n2 Chispa | 1');
  assert.equal(r.errors.length, 0);
  assert.equal(byName(r, 'Chispa').qty, 3, 'el sideboard no sumo');
  assert.equal(totalQty(r.sideboard), 2);
});

test('AC-SEC-03: una seccion desconocida devuelve su motivo y no adivina zona', () => {
  const r = parseDecklist('MainDeck:\n3 Chispa | 1\nTokens:\n2 Fantasma | 1');

  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /Tokens/, 'el motivo nombra la seccion');
  assert.equal(r.errors[0].line, 3);

  // Meterla en la zona anterior seria adivinar: el MainDeck no se ensucia.
  assert.equal(byName(r, 'Fantasma'), undefined);
  for (const zona of [r.sideboard, r.battlefields]) {
    assert.ok(!zona.some((c) => c.name === 'Fantasma'));
  }
  assert.equal(totalQty(r.cards), 3);
});

test('AC-SEC-04: solo el MainDeck alimenta la mano', () => {
  const r = parseDecklist(PILTOVER_EXPORT);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(totalQty(r.cards), 39, 'el MainDeck son 39 cartas, no 72');
  assert.equal(totalQty(r.deck.cards), 39);

  for (const fuera of ['Chaos Rune', 'Zaun Warrens', 'Ravenbloom Prefect',
                       'Kennen, Heart of the Tempest', 'Kennen, Storm of Shuriken']) {
    assert.equal(byName(r, fuera), undefined, `${fuera} no va en la mano`);
  }
});

test('AC-SEC-05: una lista sin secciones sigue siendo todo MainDeck', () => {
  const r = parseDecklist('3 Chispa | 1\n2 Descarga | 2 + 1 fury');
  assert.equal(totalQty(r.cards), 5);
  assert.deepEqual(r.sideboard, []);
  assert.deepEqual(r.battlefields, []);
});

test('AC-SEC-06: el sideboard NO suma copias al mazo', () => {
  const r = parseDecklist(PILTOVER_EXPORT);
  // Gust y Salvage estan en las dos zonas: 1 + 1. El rival tiene UNA copia.
  assert.equal(byName(r, 'Gust').qty, 1);
  assert.equal(byName(r, 'Salvage').qty, 1);
  assert.ok(r.sideboard.some((c) => c.name === 'Gust'), 'el sideboard no se tira');
  assert.equal(totalQty(r.sideboard), 10);
});

test('AC-SEC-07: las runas salen como composicion de dominios', () => {
  const r = parseDecklist(PILTOVER_EXPORT);
  assert.deepEqual(r.runes, { chaos: 9, order: 3 });

  const total = Object.values(r.runes).reduce((a, n) => a + n, 0);
  assert.equal(total, RUNE_DECK_SIZE, 'el Mazo de Runas es 12 (regla 1)');
  assert.equal(r.errors.length, 0);
});

test('AC-SEC-08: un Mazo de Runas que no suma 12 devuelve su motivo, pero las runas vienen igual', () => {
  const r = parseDecklist('Runes:\n8 Chaos Rune\n3 Order Rune');

  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /12/, 'el motivo dice cuantas tiene que haber');
  assert.equal(r.errors[0].line, 1, 'apunta al encabezado Runes:');

  // No se descartan: hay que poder mostrar el problema, no esconderlo.
  assert.deepEqual(r.runes, { chaos: 8, order: 3 });
});

test('AC-SEC-09: una runa de un dominio que no existe devuelve su motivo', () => {
  const r = parseDecklist('Runes:\n12 Lunar Rune');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /Lunar/i, 'el motivo nombra la runa');
  assert.deepEqual(r.runes, {});
});

test('AC-SEC-10: la Legend, el Champion y las battlefields salen en campos propios', () => {
  const r = parseDecklist(PILTOVER_EXPORT);

  assert.equal(r.deck.legend.name, 'Kennen, Heart of the Tempest');
  assert.equal(r.deck.champion.name, 'Kennen, Storm of Shuriken');
  assert.equal(r.battlefields.length, 3);
  assert.deepEqual(
    r.battlefields.map((c) => c.name).sort(),
    ['Minefield', 'Shadow Temple', 'Zaun Warrens'],
  );
});

test('AC-SEC-10b: sin seccion Legend, los campos son null y no un objeto vacio', () => {
  const r = parseDecklist('3 Chispa | 1');
  assert.equal(r.deck.legend, null);
  assert.equal(r.deck.champion, null);
});

test('AC-SEC-11: dos Legends devuelve su motivo — la Legend es una sola', () => {
  const r = parseDecklist('Legend:\n1 Kennen\n1 Jinx\nMainDeck:\n3 Chispa | 1');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /Legend/i);
  assert.equal(r.errors[0].line, 3, 'apunta a la carta de mas, no a la primera');

  const dos = parseDecklist('Champion:\n2 Kennen');
  assert.equal(dos.errors.length, 1, 'qty 2 tambien es de mas');
  assert.match(dos.errors[0].reason, /Champion/i);
});

test('AC-SEC-14: expandDeck no reparte ni la Legend ni el Champion', () => {
  const r = parseDecklist(PILTOVER_EXPORT);
  const cardsById = new Map(r.cards.map((c) => [c.id, c]));
  const mazo = expandDeck(r.deck, cardsById);

  assert.equal(mazo.length, 39);
  for (const c of mazo) {
    assert.ok(!c.name.startsWith('Kennen'), 'la Legend/Champion quedan afuera del mazo');
  }
});
