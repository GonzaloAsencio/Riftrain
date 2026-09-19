import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog, resolveDeck } from '../src/engine/catalog.js';
import { parseDecklist } from '../src/engine/decklist.js';
import { expandDeck } from '../src/engine/scenario.js';
import { canPlayCard } from '../src/engine/cost.js';

/**
 * Cruce de un mazo pegado contra el catalogo. PURO: no lee archivos ni red.
 *
 * Es el ultimo eslabon: el parser saca los nombres de la lista pegada, el
 * catalogo trae los costos, y esto los une. Sin este paso el mazo tiene nombres
 * sin costo y el motor no puede decidir nada.
 */

const ITEMS = JSON.parse(
  readFileSync(new URL('./fixtures/riot-items.json', import.meta.url), 'utf8'),
);
const CATALOGO = buildCatalog(ITEMS).cards;

const LISTA = `Legend:
1 Kennen, Heart of the Tempest

MainDeck:
3 Star-Crossed
2 Baron Nashor
2 Fizz, Trickster

Runes:
9 Chaos Rune
3 Order Rune`;

test('AC-BLD-01: una carta del MainDeck se resuelve y trae su costo real', () => {
  const r = resolveDeck(parseDecklist(LISTA), CATALOGO);
  assert.deepEqual(r.missing, []);

  const sc = r.cards.find((c) => c.name === 'Star-Crossed');
  assert.equal(sc.energy, 3, 'el costo sale del catalogo, no de la lista pegada');
  assert.deepEqual(sc.power, { chaos: 1 });
  assert.equal(sc.needsCost, false);

  // Y la cantidad la sigue poniendo la lista, no el catalogo.
  assert.equal(r.deck.cards.find((e) => e.cardId === sc.id).qty, 3);
});

test('AC-BLD-02: la Legend "Campeon, Nombre" resuelve por la parte de atras', () => {
  // Piltover Archive exporta "Kennen, Heart of the Tempest", pero la carta se
  // llama solo "Heart of the Tempest": el campeon va adelante como prefijo.
  const r = resolveDeck(parseDecklist(LISTA), CATALOGO);
  assert.ok(r.deck.legend, 'la Legend resolvio');
  assert.equal(r.deck.legend.name, 'Heart of the Tempest');
  assert.equal(r.deck.legend.type, 'legend');
});

test('AC-BLD-03: el nombre completo gana sobre el fallback de la coma', () => {
  // Hay cartas cuyo nombre propio lleva coma ("Fizz, Trickster"). Si el nombre
  // entero existe en el catalogo, ese es -- no se parte por la coma.
  const r = resolveDeck(parseDecklist('MainDeck:\n2 Fizz, Trickster'), CATALOGO);
  assert.deepEqual(r.missing, []);
  assert.equal(r.cards[0].name, 'Fizz, Trickster');
  assert.equal(r.cards[0].subtitle, 'Trickster');
});

test('AC-BLD-04: lo que no esta en el catalogo se reporta, no se inventa', () => {
  const r = resolveDeck(parseDecklist('MainDeck:\n3 Carta Que No Existe\n1 Star-Crossed'), CATALOGO);

  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].name, 'Carta Que No Existe');
  assert.ok(r.missing[0].reason);
  assert.equal(r.cards.length, 1, 'la que si existe entra igual');
  assert.ok(!r.deck.cards.some((e) => e.cardId.includes('no-existe')), 'la que falta NO va al mazo');
});

test('AC-BLD-05: el mazo resuelto entra en el motor y se puede evaluar pagabilidad', () => {
  const r = resolveDeck(parseDecklist(LISTA), CATALOGO);
  const porId = new Map(r.cards.map((c) => [c.id, c]));

  const mano = expandDeck(r.deck, porId);
  assert.equal(mano.length, 7, '3 + 2 + 2');

  // Star-Crossed pide 3 de Energia + 1 de Poder Chaos. Con floating, TRES runas
  // Chaos alcanzan: se agotan las tres y una de esas mismas se recicla.
  const sc = porId.get('star-crossed');
  const tresChaos = [0, 1, 2].map(() => ({ domain: 'chaos', ready: true }));
  assert.equal(canPlayCard(sc, tresChaos).ok, true);

  // Con solo 2 abiertas la Energia no llega, aunque para reciclar sobre.
  const dosAbiertas = [
    { domain: 'chaos', ready: true }, { domain: 'chaos', ready: true },
    { domain: 'chaos', ready: false },
  ];
  const no = canPlayCard(sc, dosAbiertas);
  assert.equal(no.ok, false);
  assert.match(no.reason, /Energia/, 'el motivo es la energia, no el dominio');
});

test('AC-BLD-06: solo viajan las cartas que el mazo usa, no el catalogo entero', () => {
  const r = resolveDeck(parseDecklist(LISTA), CATALOGO);
  assert.equal(r.cards.length, 3, 'tres cartas distintas en el MainDeck');
  assert.ok(r.cards.length < CATALOGO.length, 'el catalogo tiene mas cartas que el mazo');

  // La Legend no es una carta robable: no va en cards ni en deck.cards.
  assert.ok(!r.cards.some((c) => c.type === 'legend'));
  assert.ok(!r.deck.cards.some((e) => e.cardId === 'heart-of-the-tempest'));
});

test('AC-BLD-07: los dominios y las runas del mazo sobreviven al cruce', () => {
  const r = resolveDeck(parseDecklist(LISTA), CATALOGO);
  assert.deepEqual(r.deck.runes, { chaos: 9, order: 3 });
  assert.deepEqual(r.deck.domains, ['chaos', 'order']);
});

test('AC-BLD-08: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => resolveDeck(null, CATALOGO), TypeError);
  assert.throws(() => resolveDeck(parseDecklist('1 Star-Crossed'), null), TypeError);
});
