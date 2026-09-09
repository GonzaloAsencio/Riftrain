import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, levenshtein, score, search, resolve } from '../src/engine/match.js';

const cards = [
  { id: 'a', name: 'Artilleria Zaunita' },
  { id: 'b', name: 'Descarga' },
  { id: 'c', name: 'Detonante' },
  { id: 'd', name: 'Motin' },
  { id: 'e', name: 'Magistrado' },
];

test('AC-MTC-01: normalize saca acentos, puntuacion y espacios de sobra', () => {
  assert.equal(normalize('Artillería  Zaunita!'), 'artilleria zaunita');
  assert.equal(normalize('MOTÍN'), 'motin');
  assert.equal(normalize('  Sello del Orden  '), 'sello del orden');
  assert.equal(normalize(null), '');
});

test('AC-MTC-02: levenshtein basico', () => {
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('descarga', 'descrga'), 1);
});

test('AC-MTC-03: el nombre exacto puntua 1', () => {
  assert.equal(score('Descarga', { name: 'Descarga' }.name), 1);
  assert.equal(score('descarga', 'Descarga'), 1);
  assert.equal(score('DESCARGA', 'Descarga'), 1);
});

test('AC-MTC-04: el prefijo puntua alto — es lo que hace util el autocompletado', () => {
  assert.ok(score('desc', 'Descarga') > 0.7);
  assert.ok(score('art', 'Artilleria Zaunita') > 0.6);
});

test('AC-MTC-05: matchea por la segunda palabra de un nombre compuesto', () => {
  assert.ok(score('zaunita', 'Artilleria Zaunita') > 0.5);
});

test('AC-MTC-06: EVOCACION EN FRIO — un typo en un nombre largo se perdona', () => {
  const r = resolve('artilleria zaunta', cards);
  assert.equal(r.card?.id, 'a', 'falto una letra y aun asi cuenta');
});

test('AC-MTC-07: pero un nombre corto exige precision', () => {
  assert.equal(score('mota', 'Motin'), 0, 'motin es corto: no se perdona el typo');
});

test('AC-MTC-08: NO acredita una carta cuando el texto es ambiguo', () => {
  const ambiguos = [{ id: 'x', name: 'Descarga' }, { id: 'y', name: 'Descargar' }];
  const r = resolve('descarg', ambiguos);
  assert.equal(r.card, null);
  assert.equal(r.reason, 'ambiguous');
  assert.equal(r.candidates.length, 2, 'devuelve los candidatos para preguntar');
});

test('AC-MTC-09: texto que no se parece a nada NO resuelve', () => {
  const r = resolve('qwertyuiop', cards);
  assert.equal(r.card, null);
  assert.equal(r.reason, 'no-match');
});

test('AC-MTC-10: search ordena por relevancia y respeta el limite', () => {
  const r = search('d', cards, { limit: 2 });
  assert.ok(r.length <= 2);
  assert.ok(['b', 'c'].includes(r[0].id), 'Descarga o Detonante primero');
});

test('AC-MTC-11: search con texto vacio no devuelve la baraja entera', () => {
  assert.deepEqual(search('', cards), []);
  assert.deepEqual(search('   ', cards), []);
});

test('AC-MTC-12: el exacto le gana al prefijo aunque el otro sea mas corto', () => {
  const conflicto = [{ id: 'largo', name: 'Motin del Caos' }, { id: 'corto', name: 'Motin' }];
  assert.equal(resolve('motin', conflicto).card.id, 'corto');
});
