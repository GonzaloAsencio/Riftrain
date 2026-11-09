import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDeckCode, resolveDeckCode } from '../src/engine/deck-code.js';
import { normalizeDeck } from '../src/engine/deck-combos.js';

/**
 * Códigos de mazo de Piltover Archive. Los casos esperados los generó UNA vez la librería de
 * referencia (@piltoverarchive/riftbound-deck-codes 1.5.0), corrida fuera del repo como oráculo:
 * el decodificador es nuestro, la verdad no.
 */
const FIXTURES = JSON.parse(readFileSync(new URL('./fixtures/deck-codes.json', import.meta.url), 'utf8')).cases;
const CATALOG = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8')).cards;
const SHIPPED = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'));
const fixture = (name) => FIXTURES.find((c) => c.name === name);
const entries = (list) => list.map(({ cardCode, count }) => ({ code: cardCode, count }));

// Base32 RFC 4648 sin padding, para armar bytes a mano en los casos de error.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encode = (bytes) => {
  let out = ''; let buffer = 0; let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHA[(buffer >> bits) & 31]; }
  }
  return bits ? out + ALPHA[(buffer << (5 - bits)) & 31] : out;
};
// v3 con UNA carta de una copia (set, variante, número) y sin campeón.
const oneCard = (set, variant, number, header = 0x13) => encode([header, ...Array(11).fill(0), 1, 1, set, variant, number, 0, 0, 0, 0]);

// ---- Decodificador (AC-CFG-01..05)
test('AC-CFG-01: el código de ejemplo del README decodifica exacto', () => {
  const { code, expected } = fixture('readme-example');
  const result = decodeDeckCode(code);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.main, entries(expected.mainDeck));
  assert.deepEqual(result.sideboard, entries(expected.sideboard));
  assert.equal(result.champion, null);
});

test('AC-CFG-02: cada versión (2 a 6) decodifica igual que la referencia', () => {
  assert.deepEqual([...new Set(FIXTURES.map((c) => c.version))].sort(), [2, 3, 4, 5, 6]);
  for (const { name, code, version, expected } of FIXTURES) {
    const result = decodeDeckCode(code);
    assert.equal(result.ok, true, `${name}: ${result.reason}`);
    assert.equal(result.version, version, name);
    assert.deepEqual(result.main, entries(expected.mainDeck), name);
    assert.deepEqual(result.sideboard, entries(expected.sideboard), name);
    assert.equal(result.champion, expected.chosenChampion ?? null, name);
    assert.deepEqual(result.legends, expected.additionalLegends ?? null, name);
  }
});

test('AC-CFG-03: un código roto devuelve su motivo y nunca lanza', () => {
  const { code } = fixture('koko-kennen-runas-ogn');
  const cases = {
    vacío: '',
    espacios: '   ',
    'carácter inválido': 'CMAQ!AQB',
    truncado: code.slice(0, 40),
    'formato 2': encode([0x23, ...Array(15).fill(0), 0]),
    'versión 7': encode([0x17, 0]),
    'no es texto': 42,
  };
  for (const [label, input] of Object.entries(cases)) {
    let result;
    assert.doesNotThrow(() => { result = decodeDeckCode(input); }, label);
    assert.equal(result.ok, false, label);
    assert.equal(typeof result.reason, 'string', label);
    assert.ok(result.reason.length > 8, label);
  }
  assert.match(decodeDeckCode(encode([0x17, 0])).reason, /versi[oó]n 7/i);
});

test('AC-CFG-04: set, variante o prefijo desconocidos se rechazan con motivo, sin caer en la carta base', () => {
  assert.equal(decodeDeckCode(oneCard(0, 0, 7)).ok, true, 'control: OGN-007 válido');
  assert.match(decodeDeckCode(oneCard(9, 0, 7)).reason, /set/i);
  assert.match(decodeDeckCode(oneCard(0, 7, 7)).reason, /variante/i);
  // v4: cada número lleva su flag; 0x05 no existe.
  const v4 = encode([0x14, ...Array(11).fill(0), 1, 1, 0, 0, 5, 7, 0, 0, 0, 0]);
  assert.match(decodeDeckCode(v4).reason, /prefijo/i);
});

test('AC-CFG-05: es puro y tolera lo que trae un copiar y pegar (minúsculas y espacios)', () => {
  const { code } = fixture('variantes');
  assert.deepEqual(decodeDeckCode(code), decodeDeckCode(code));
  assert.deepEqual(decodeDeckCode(`  ${code.toLowerCase()}\n`), decodeDeckCode(code));
});

// ---- Cruce contra el catálogo (AC-CFG-06..09)
const kk = SHIPPED.decks[0];
const sortCards = (cards) => [...cards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));

test('AC-CFG-06: el mazo real resuelve igual que su lista de texto: leyenda, campeón, mazo y runas', () => {
  for (const name of ['koko-kennen-runas-ogn', 'koko-kennen-runas-ven']) {
    const resolved = resolveDeckCode(decodeDeckCode(fixture(name).code), CATALOG);
    assert.equal(resolved.ok, true, `${name}: ${JSON.stringify(resolved.missing ?? resolved.reason)}`);
    const { deck } = resolved;
    assert.equal(deck.legend, kk.legend, name);
    assert.equal(deck.champion, kk.champion, name);
    assert.deepEqual(deck.runes, kk.runes, name);
    assert.deepEqual(deck.domains, kk.domains, name);
    assert.deepEqual(sortCards(deck.cards), sortCards(kk.cards), name);
    // Las cartas viajan con el mazo: leyenda, campeón y todo lo repartible, sin runas sueltas.
    const ids = new Set(resolved.cards.map((c) => c.id));
    for (const id of [deck.legend, deck.champion, ...deck.cards.map((c) => c.cardId)]) assert.ok(ids.has(id), id);
  }
});

test('AC-CFG-07: las variantes a, b y firmada cuentan como la carta base y suman', () => {
  const resolved = resolveDeckCode(decodeDeckCode(fixture('variantes').code), CATALOG);
  assert.equal(resolved.ok, true, JSON.stringify(resolved.missing));
  const qty = (id) => resolved.deck.cards.find((c) => c.cardId === id)?.qty;
  assert.equal(qty('ahri-inquisitive'), 4, 'OGN-119a ×3 + SFD-227s ×1');
  assert.equal(qty('baron-nashor'), 2, 'UNL-147b');
  assert.deepEqual(resolved.deck.runes, { fury: 12 });
});

test('AC-CFG-08: las cartas que no están en el catálogo se listan TODAS, con su motivo', () => {
  const decoded = { ok: true, version: 3, main: [{ code: 'OGN-007', count: 12 }, { code: 'RAD-998', count: 3 },
    { code: 'RAD-999a', count: 1 }, { code: 'OGN-185', count: 3 }], sideboard: [], champion: null, legends: null };
  const resolved = resolveDeckCode(decoded, CATALOG);
  assert.equal(resolved.ok, false);
  assert.deepEqual(resolved.missing.map(({ code, qty }) => [code, qty]), [['RAD-998', 3], ['RAD-999a', 1]]);
  assert.ok(resolved.missing.every((m) => /cat[aá]logo/.test(m.reason)));
  assert.equal(resolveDeckCode({ ok: false, reason: 'roto' }, CATALOG).ok, false);
});

test('AC-CFG-09: el mazo resuelto entra en el motor (normalizeDeck) y sus runas suman 12', () => {
  const resolved = resolveDeckCode(decodeDeckCode(fixture('koko-kennen-runas-ogn').code), CATALOG);
  const normalized = normalizeDeck(resolved.deck, resolved.cards, { policy: 'positive-energy' });
  assert.equal(normalized.ok, true, normalized.reason);
  assert.equal(Object.values(resolved.deck.runes).reduce((a, b) => a + b, 0), 12);
  // Un mazo sin las 12 runas no se entrena: se rechaza con motivo.
  const pocas = { ok: true, version: 3, main: [{ code: 'OGN-007', count: 5 }, { code: 'OGN-185', count: 3 }],
    sideboard: [], champion: null, legends: null };
  const bad = resolveDeckCode(pocas, CATALOG);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /12/);
});

// ---- Bordes que encontró la revisión (contra la referencia, 300k entradas al azar)
const decodedOf = (main, champion = null) => ({ ok: true, version: 3, main, sideboard: [], champion, legends: null });
const runas12 = [{ code: 'OGN-007', count: 12 }];

test('AC-CFG-03: una cantidad 0 o un carácter no ASCII no pasan como válidos', () => {
  // v5 disperso: 1 cantidad distinta, cantidad 0, 1 grupo de 1 carta OGN-010.
  assert.equal(decodeDeckCode(encode([0x15, 0, 1, 0, 1, 1, 0, 0, 10, 0, 0])).ok, false);
  const { code } = fixture('variantes');
  assert.equal(decodeDeckCode(`${code.slice(0, 10)}ß${code.slice(10)}`).ok, false);
});

test('AC-CFG-08: una runa sin dominio en el catálogo es un motivo, no un dominio "undefined"', () => {
  const catalog = CATALOG.map((c) => (c.id === 'calm-rune' ? { ...c, domain: null } : c));
  const result = resolveDeckCode(decodedOf([{ code: 'OGN-007', count: 6 }, { code: 'OGN-042', count: 6 }, { code: 'OGN-185', count: 3 }, { code: 'VEN-155', count: 1 }]), catalog);
  assert.equal(result.ok, false);
  assert.match(result.reason, /dominio/);
});

test('AC-CFG-06: dos leyendas en el mazo principal son ambiguas y se rechazan; las de v6 no se entrenan', () => {
  const dos = resolveDeckCode(decodedOf([...runas12, { code: 'VEN-155', count: 1 }, { code: 'OGN-253', count: 1 }, { code: 'OGN-185', count: 3 }]), CATALOG);
  assert.equal(dos.ok, false);
  assert.match(dos.reason, /leyenda/i);
  const v6 = resolveDeckCode(decodeDeckCode(fixture('leyendas-adicionales').code), CATALOG);
  assert.equal(v6.ok, true, v6.reason);
  assert.equal(v6.deck.legend, kk.legend, 'la inicial es la del mazo principal');
});

test('AC-CFG-06: el campeón tiene que ser una carta del mazo principal que no sea leyenda', () => {
  const base = [...runas12, { code: 'VEN-155', count: 1 }, { code: 'OGN-185', count: 3 }];
  assert.match(resolveDeckCode(decodedOf(base, 'OGN-119'), CATALOG).reason, /campe[oó]n/i);
  assert.match(resolveDeckCode(decodedOf(base, 'VEN-155'), CATALOG).reason, /campe[oó]n/i);
  assert.equal(resolveDeckCode(decodedOf(base, 'OGN-185'), CATALOG).ok, true);
});
