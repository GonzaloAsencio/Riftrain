import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCard, buildCatalog } from '../src/engine/catalog.js';
import { cardCost, canPlayCard } from '../src/engine/cost.js';
import { parseDecklist } from '../src/engine/decklist.js';

/**
 * Normalizacion del catalogo oficial. PURO: no sabe que existe la red.
 *
 * El fixture son items REALES de la galeria de Riot, recortados a los campos
 * que el normalizador lee (los iconos y las dimensiones son ruido de
 * presentacion). La forma anidada se conserva tal cual: si Riot la cambia,
 * estos tests tienen que romperse.
 *
 * EL PROBLEMA QUE RESUELVE: Riot guarda el poder como UN NUMERO SUELTO y los
 * dominios como una lista aparte. El motor necesita poder POR DOMINIO. Con un
 * solo dominio la cuenta es obvia; con dos, no hay forma de saber como se
 * reparte, y ahi la carta se marca incompleta en vez de inventarse.
 */

const ITEMS = JSON.parse(
  readFileSync(new URL('./fixtures/riot-items.json', import.meta.url), 'utf8'),
);

const item = (name) => ITEMS.find((x) => x.name === name);
const norm = (name) => normalizeCard(item(name));

test('AC-CAT-01: aplana la forma verbosa de Riot al esquema del motor', () => {
  const { card, error } = norm('Star-Crossed');
  assert.equal(error, null);
  assert.equal(card.name, 'Star-Crossed');
  assert.equal(card.energy, 3);
  assert.deepEqual(card.power, { chaos: 1 });
  assert.equal(card.type, 'spell');
  assert.equal(card.needsCost, false);
});

test('AC-CAT-02: sin energia y sin poder, la carta queda incompleta — no vale 0', () => {
  const { card } = norm('Abandoned Hall');
  assert.equal(card.energy, null, 'null es "no se"');
  assert.equal(card.needsCost, true);
  assert.ok(card.reason, 'y dice por que');
});

test('AC-CAT-03: un 0 de energia REAL no se confunde con el ausente', () => {
  const { card } = norm('Called Shot');
  assert.equal(card.energy, 0);
  assert.equal(card.needsCost, false, 'cuesta cero de energia, pero se sabe cuanto cuesta');
  assert.deepEqual(card.power, { chaos: 1 });
});

test('AC-CAT-04: un solo dominio reparte todo el poder a ese dominio', () => {
  const { card } = norm('Baron Nashor');
  assert.equal(card.energy, 10);
  assert.deepEqual(card.power, { chaos: 3 });
  assert.equal(card.needsCost, false);
});

test('AC-CAT-05: dos dominios con poder es AMBIGUO: se marca, no se adivina', () => {
  const { card } = norm('Acceleration Gate'); // mind+body, power 1
  assert.equal(card.needsCost, true);
  assert.match(card.reason, /mind/i);
  assert.match(card.reason, /body/i);
  assert.deepEqual(card.power, {}, 'no se inventa un reparto');
});

test('AC-CAT-06: dos dominios SIN poder queda completo — no hay nada que repartir', () => {
  const { card } = norm('Lightning Rush'); // order+chaos, sin power
  assert.equal(card.energy, 1);
  assert.deepEqual(card.power, {});
  assert.equal(card.needsCost, false);
});

test('AC-CAT-07: Colorless no aporta dominio: la energia es incolora', () => {
  const { card } = norm('Abandoned Hall');
  assert.deepEqual(card.power, {});
  assert.equal(card.domain, null);
});

test('AC-CAT-08: deduplica las impresiones: una carta por nombre', () => {
  const { cards } = buildCatalog(ITEMS);
  const nombres = cards.map((c) => c.name);
  assert.equal(nombres.length, new Set(nombres).size, 'no quedan nombres repetidos');
  assert.equal(cards.length, 10, 'los 19 items son 10 cartas distintas');

  // Y se queda con la impresion base, no con el art alternativo.
  const baron = cards.find((c) => c.name === 'Baron Nashor');
  assert.ok(!baron.code.includes('*'), `quedo una variante: ${baron.code}`);
  assert.ok(!/\d+[a-z]\//.test(baron.code), `quedo un art alternativo: ${baron.code}`);
});

test('AC-CAT-13: el subtitulo es parte de la identidad — "Ahri" son DOS cartas', () => {
  // Ahri, Inquisitive cuesta 3 + 1 Mind. Ahri, Alluring cuesta 5 + 1 Calm.
  // Deduplicar por "Ahri" a secas perderia una de las dos, y ademas es el
  // nombre que exportan las decklists: "Fizz, Trickster".
  const { cards, errors } = buildCatalog(ITEMS);
  assert.equal(errors.length, 0, JSON.stringify(errors));

  const ahris = cards.filter((c) => c.name.startsWith('Ahri'));
  assert.equal(ahris.length, 2, 'las dos Ahri sobreviven');
  assert.deepEqual(ahris.map((c) => c.name).sort(), ['Ahri, Alluring', 'Ahri, Inquisitive']);

  const inq = ahris.find((c) => c.name === 'Ahri, Inquisitive');
  assert.equal(inq.energy, 3);
  assert.deepEqual(inq.power, { mind: 1 });

  const all = ahris.find((c) => c.name === 'Ahri, Alluring');
  assert.equal(all.energy, 5);
  assert.deepEqual(all.power, { calm: 1 });
});

test('AC-CAT-14: el nombre completo es el que usan las decklists pegadas', () => {
  const { cards } = buildCatalog(ITEMS);
  const porId = new Map(cards.map((c) => [c.id, c]));

  // Tal cual lo escribe el export de Piltover Archive.
  const pegado = parseDecklist('MainDeck:\n2 Fizz, Trickster');
  assert.equal(pegado.errors.length, 0);
  const [entry] = pegado.deck.cards;
  assert.ok(porId.has(entry.cardId), `el catalogo no tiene ${entry.cardId}`);
  assert.equal(porId.get(entry.cardId).name, 'Fizz, Trickster');
});

test('AC-CAT-09: dos impresiones del mismo nombre con costos distintos se reportan', () => {
  const raro = JSON.parse(JSON.stringify(item('Star-Crossed')));
  raro.publicCode = 'UNL-999/219';
  raro.collectorNumber = 999;
  raro.energy.value.id = 7;

  const { errors } = buildCatalog([item('Star-Crossed'), raro]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /Star-Crossed/);
});

test('AC-CAT-10: la carta normalizada entra en cost.js sin adaptador', () => {
  const { card } = norm('Star-Crossed');
  const cost = cardCost(card);
  assert.equal(cost.energy, 3);
  assert.equal(cost.powerTotal, 1);
  assert.equal(cost.runes, 3, 'floating: la reciclada es una de las tres agotadas');

  // Tres Chaos abiertas alcanzan: se agotan las tres y una se recicla.
  const tres = [0, 1, 2].map(() => ({ domain: 'chaos', ready: true }));
  assert.equal(canPlayCard(card, tres).ok, true);

  // Tres Order NO: no hay ninguna Chaos para reciclar.
  const otroDominio = [0, 1, 2].map(() => ({ domain: 'order', ready: true }));
  const no = canPlayCard(card, otroDominio);
  assert.equal(no.ok, false);
  assert.match(no.reason, /Chaos/);
});

test('AC-CAT-11: los ids del catalogo cruzan con los del parser de decklists', () => {
  // La misma funcion slug() de los dos lados: por eso un mazo pegado encuentra
  // sus cartas en el catalogo sin traductor en el medio.
  const { cards } = buildCatalog(ITEMS);
  const porId = new Map(cards.map((c) => [c.id, c]));

  const pegado = parseDecklist('MainDeck:\n3 Star-Crossed\n1 Baron Nashor\n2 Lightning Rush');
  assert.equal(pegado.errors.length, 0);

  for (const { cardId } of pegado.deck.cards) {
    assert.ok(porId.has(cardId), `el catalogo no tiene ${cardId}`);
  }
});

test('AC-CAT-12: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => buildCatalog(null), TypeError);
  assert.throws(() => buildCatalog('nope'), TypeError);

  const { card, error } = normalizeCard({ collectorNumber: 1 });
  assert.equal(card, null);
  assert.ok(error, 'un item sin nombre se descarta con su motivo');
});
