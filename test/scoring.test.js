import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreNaming } from '../src/engine/scoring.js';

/**
 * El puntaje de una ronda de cartas. Vive en el motor y NO en el DOM.
 *
 * Por que existe este modulo: el puntaje se derivaba de `dataset.result` de los
 * nodos del abanico, asi que solo contaba lo que la UI hubiera dado vuelta. En
 * los niveles 1 y 2 (modo picks) nada se daba vuelta, y el resultado era 0/N
 * siempre. Una regla del juego no puede vivir en un atributo del DOM.
 */

test('AC-SCO-01: marcar una carta jugable la cuenta como acierto', () => {
  const r = scoreNaming({
    namedIds: ['artillera'],
    handIds: ['artillera', 'chispa', 'caos'],
    playableIds: ['artillera', 'chispa'],
  });
  assert.equal(r.hits, 1);
  assert.deepEqual(r.hitIds, ['artillera']);
  assert.equal(r.falsePositives, 0);
});

test('AC-SCO-02: expected son las cartas jugables DISTINTAS, no las instancias', () => {
  // La mano trae dos Descarga y las dos son pagables: sigue siendo UNA carta que ver.
  const r = scoreNaming({
    namedIds: [],
    handIds: ['descarga', 'descarga', 'granada'],
    playableIds: ['descarga', 'descarga', 'granada'],
  });
  assert.equal(r.expected, 2);
});

test('AC-SCO-03: nombrar algo que no esta en la mano es falso positivo', () => {
  const r = scoreNaming({
    namedIds: ['tratado'],
    handIds: ['artillera', 'chispa'],
    playableIds: ['artillera'],
  });
  assert.equal(r.hits, 0);
  assert.equal(r.falsePositives, 1);
  assert.deepEqual(r.falsePositiveIds, ['tratado']);
  assert.deepEqual(r.notInHandIds, ['tratado'], 'la UI necesita saber que ni siquiera estaba');
});

test('AC-SCO-04: estaba en la mano pero no era pagable: tambien es falso positivo', () => {
  const r = scoreNaming({
    namedIds: ['caos'],
    handIds: ['artillera', 'caos'],
    playableIds: ['artillera'],
  });
  assert.equal(r.hits, 0);
  assert.equal(r.falsePositives, 1);
  assert.deepEqual(r.falsePositiveIds, ['caos']);
  assert.deepEqual(r.notInHandIds, [], 'estaba en la mano: el motivo del rechazo es otro');
});

test('AC-SCO-05: las jugables que no nombre salen en missedIds', () => {
  const r = scoreNaming({
    namedIds: ['artillera'],
    handIds: ['artillera', 'chispa', 'granada'],
    playableIds: ['artillera', 'chispa', 'granada'],
  });
  assert.equal(r.hits, 1);
  assert.equal(r.expected, 3);
  assert.deepEqual(r.missedIds, ['chispa', 'granada']);
});

test('AC-SCO-06: nombrar dos veces la misma carta no infla el puntaje', () => {
  const r = scoreNaming({
    namedIds: ['descarga', 'descarga'],
    handIds: ['descarga', 'descarga', 'granada'],
    playableIds: ['descarga', 'descarga', 'granada'],
  });
  assert.equal(r.hits, 1, 'dos copias dadas vuelta siguen siendo UNA carta acertada');
  assert.equal(r.expected, 2);
  assert.ok(r.hits <= r.expected, 'el puntaje nunca puede pasarse de lo esperado');
});

test('AC-SCO-07: no marcar nada da cero aciertos y todo perdido', () => {
  const r = scoreNaming({
    namedIds: [],
    handIds: ['artillera', 'chispa'],
    playableIds: ['artillera', 'chispa'],
  });
  assert.equal(r.hits, 0);
  assert.equal(r.expected, 2);
  assert.deepEqual(r.missedIds, ['artillera', 'chispa']);
  assert.equal(r.falsePositives, 0);
});

test('AC-SCO-08: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => scoreNaming({ namedIds: 'artillera', handIds: [], playableIds: [] }), TypeError);
  assert.throws(() => scoreNaming({ namedIds: [], handIds: null, playableIds: [] }), TypeError);
  assert.throws(() => scoreNaming({ namedIds: [], handIds: [], playableIds: 3 }), TypeError);
  assert.throws(() => scoreNaming(), TypeError);
});
