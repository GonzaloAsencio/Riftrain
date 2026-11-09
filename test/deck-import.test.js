import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looksLikeList, prepareDeckInput, importDeck } from '../src/engine/deck-import.js';
import { normalizeDeck } from '../src/engine/deck-combos.js';

/**
 * Un solo campo para el mazo del rival: el código de Piltover Archive o su export de texto
 * ("Legend: / Champion: / MainDeck: / Runes: ..."). Los dos caminos terminan en la misma forma.
 */
const LIST = readFileSync(new URL('./fixtures/piltover-export.txt', import.meta.url), 'utf8');
const CATALOG = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8')).cards;
const CODES = JSON.parse(readFileSync(new URL('./fixtures/deck-codes.json', import.meta.url), 'utf8')).cases;
const code = CODES.find((c) => c.name === 'koko-kennen-runas-ogn').code;
const run = (text, catalog = CATALOG) => { const prepared = prepareDeckInput(text); return prepared.ok ? importDeck(prepared, catalog) : prepared; };
const sorted = (cards) => [...cards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));

test('AC-IMP-01: distingue una lista de texto de un código', () => {
  assert.equal(looksLikeList(LIST), true);
  assert.equal(looksLikeList(code), false);
  assert.equal(looksLikeList(`  ${code}\n`), false, 'un código con espacios o salto final sigue siendo código');
  assert.equal(looksLikeList('3 Gust\n2 Flash'), true, 'una lista sin encabezados también');
  assert.equal(prepareDeckInput(LIST).kind, 'list');
  assert.equal(prepareDeckInput(code).kind, 'code');
  assert.equal(prepareDeckInput('   ').ok, false);
});

test('AC-IMP-02: el export de texto y el código del mismo mazo dan el mismo mazo', () => {
  const fromList = run(LIST);
  const fromCode = run(code);
  assert.equal(fromList.ok, true, JSON.stringify(fromList.missing ?? fromList.reason));
  assert.equal(fromCode.ok, true, fromCode.reason);
  for (const key of ['legend', 'champion', 'runes', 'domains']) assert.deepEqual(fromList.deck[key], fromCode.deck[key], key);
  assert.deepEqual(sorted(fromList.deck.cards), sorted(fromCode.deck.cards));
  assert.equal(normalizeDeck(fromList.deck, fromList.cards, { policy: 'positive-energy' }).ok, true);
  const ids = new Set(fromList.cards.map((c) => c.id));
  for (const id of [fromList.deck.legend, fromList.deck.champion]) assert.ok(ids.has(id), id);
});

test('AC-IMP-03: las cartas de la lista que no están en el catálogo se listan TODAS', () => {
  const broken = LIST.replace('3 Traveling Merchant', '3 Carta Que No Existe').replace('1 Gust', '1 Otra Inventada');
  const result = run(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((m) => [m.label, m.qty]), [['Carta Que No Existe', 3], ['Otra Inventada', 1]]);
  assert.ok(result.missing.every((m) => /cat[aá]logo/.test(m.reason)));
});

test('AC-IMP-04: una línea que no se entiende es un motivo con su número de línea', () => {
  const result = run(LIST.replace('3 Traveling Merchant', '3 Traveling Merchant | dos de energía'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /l[ií]nea \d+/i);
});

test('AC-IMP-05: sin las 12 runas o sin leyenda, el mazo no se entrena', () => {
  const pocas = run(LIST.replace('9 Chaos Rune', '5 Chaos Rune'));
  assert.equal(pocas.ok, false);
  assert.match(pocas.reason, /12/);
  // El parser ya avisa las runas de menos; el cruce no confía en eso y vuelve a mirar.
  const prepared = prepareDeckInput(LIST);
  const tampered = { ...prepared, parsed: { ...prepared.parsed, deck: { ...prepared.parsed.deck, runes: { chaos: 5 } } } };
  assert.match(importDeck(tampered, CATALOG).reason, /12/);
  const sinLeyenda = run(LIST.replace(/Legend:\n1 Kennen, Heart of the Tempest\n/, ''));
  assert.equal(sinLeyenda.ok, false);
  assert.match(sinLeyenda.reason, /leyenda/i);
});

test('AC-IMP-06: el camino del código sigue igual que antes (códigos rotos con su motivo)', () => {
  const bad = run('ESTO-NO-ES-UN-CODIGO');
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.length > 10);
  const missing = run(code, CATALOG.filter((c) => c.id !== 'traveling-merchant'));
  assert.equal(missing.ok, false);
  assert.equal(missing.missing[0].label, 'OGN-185');
});
