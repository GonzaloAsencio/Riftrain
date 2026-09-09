import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, record, nextLevel, accuracyOf, isPerfect,
  shouldReview, nextSeed, stats, WINDOW, UP_AT, DOWN_AT,
} from '../src/engine/progression.js';

const answer = (o = {}) => ({
  seed: 1, question: 'playable', deckId: 'd', turn: 5,
  hits: 3, expected: 3, falsePositives: 0, missedIds: [], falsePositiveIds: [], ms: 4000, ...o,
});

const feed = (state, results) => results.reduce((s, r) => record(s, r), state);

test('AC-PRG-01: la precision NO es binaria — 3 de 5 no es lo mismo que 0 de 5', () => {
  assert.equal(accuracyOf({ hits: 5, expected: 5 }), 1);
  assert.equal(accuracyOf({ hits: 3, expected: 5 }), 0.6);
  assert.equal(accuracyOf({ hits: 0, expected: 5 }), 0);
});

test('AC-PRG-02: los falsos positivos restan, pero no anulan el acierto real', () => {
  assert.equal(accuracyOf({ hits: 4, expected: 4, falsePositives: 2 }), 0.75);
  assert.equal(accuracyOf({ hits: 4, expected: 4, falsePositives: 0 }), 1);
  assert.ok(accuracyOf({ hits: 0, expected: 4, falsePositives: 3 }) === 0, 'nunca baja de 0');
});

test('AC-PRG-03: la racha solo cuenta respuestas PERFECTAS', () => {
  assert.equal(isPerfect({ hits: 4, expected: 4, falsePositives: 0 }), true);
  assert.equal(isPerfect({ hits: 4, expected: 4, falsePositives: 1 }), false, 'sobro una');
  assert.equal(isPerfect({ hits: 3, expected: 4, falsePositives: 0 }), false, 'falto una');
});

test('AC-PRG-04: el nivel NO se mueve con la ventana a medio llenar', () => {
  assert.equal(nextLevel(1, [1, 1, 1]), 1, 'con 3 respuestas no se sabe nada');
  assert.equal(nextLevel(1, Array(WINDOW).fill(1)), 2);
});

test('AC-PRG-05: sube de nivel con precision >= 84%', () => {
  assert.equal(nextLevel(1, Array(WINDOW).fill(1)), 2, '100% sube');
  const justoDebajo = Array(WINDOW).fill(UP_AT - 0.01);
  assert.equal(nextLevel(1, justoDebajo), 1, '83% NO sube');
  const justo = Array(WINDOW).fill(UP_AT);
  assert.equal(nextLevel(1, justo), 2, '84% clavado sube');
});

test('AC-PRG-06: baja de nivel con precision < 34%', () => {
  assert.equal(nextLevel(3, Array(WINDOW).fill(0.2)), 2);
  assert.equal(nextLevel(3, Array(WINDOW).fill(DOWN_AT)), 3, '34% clavado NO baja');
  assert.equal(nextLevel(3, Array(WINDOW).fill(0.5)), 3, 'la zona del medio no mueve nada');
});

test('AC-PRG-07: el nivel se capa entre 1 y 4', () => {
  assert.equal(nextLevel(4, Array(WINDOW).fill(1)), 4, 'no hay nivel 5');
  assert.equal(nextLevel(1, Array(WINDOW).fill(0)), 1, 'no hay nivel 0');
});

test('AC-PRG-08: al cambiar de nivel la ventana se vacia — si no, el nivel oscila', () => {
  const s = feed(emptyState(), Array(WINDOW).fill(answer()));
  assert.equal(s.level, 2, 'subio');
  assert.equal(s.window.length, 0, 'y arranca a medir de cero en el nivel nuevo');
});

test('AC-PRG-09: COLA DE REPASO — lo que fallo vuelve; lo que acierto sale', () => {
  let s = record(emptyState(), answer({ seed: 777, hits: 1, expected: 4 }));
  assert.deepEqual(s.reviewQueue, [777], 'el seed fallado queda en la cola');

  s = record(s, answer({ seed: 777, hits: 4, expected: 4 }));
  assert.deepEqual(s.reviewQueue, [], 'acertarlo perfecto lo saca');
});

test('AC-PRG-10: un repaso fallado de nuevo NO se duplica en la cola', () => {
  let s = record(emptyState(), answer({ seed: 5, hits: 0, expected: 3 }));
  s = record(s, answer({ seed: 5, hits: 1, expected: 3 }));
  assert.deepEqual(s.reviewQueue, [5], 'sigue una sola vez');
});

test('AC-PRG-11: uno de cada cuatro escenarios es repaso', () => {
  let s = { ...emptyState(), reviewQueue: [42], answered: 0 };
  const toca = [];
  for (let i = 0; i < 8; i++) {
    toca.push(shouldReview({ ...s, answered: i }));
  }
  assert.deepEqual(toca, [false, false, false, true, false, false, false, true]);
});

test('AC-PRG-12: sin cola no hay repaso, y el seed nuevo sale del rand inyectado', () => {
  const vacia = { ...emptyState(), answered: 3 };
  assert.equal(shouldReview(vacia), false, 'cola vacia: nunca repaso');
  const { seed, isReview } = nextSeed(vacia, () => 0.5);
  assert.equal(isReview, false);
  assert.equal(seed, Math.floor(0.5 * 0xffffffff) >>> 0);

  const conCola = { ...emptyState(), reviewQueue: [99], answered: 3 };
  assert.deepEqual(nextSeed(conCola, () => 0.5), { seed: 99, isReview: true });
});

test('AC-PRG-13: los dos errores se cuentan POR SEPARADO', () => {
  const s = record(emptyState(), answer({
    hits: 1, expected: 3, falsePositives: 1,
    missedIds: ['a', 'b'], falsePositiveIds: ['z'],
  }));
  assert.deepEqual(s.missedCards, { a: 1, b: 1 });
  assert.deepEqual(s.falsePositives, { z: 1 });
});

test('AC-PRG-14: detecta el punto debil, pero no con muestra chica', () => {
  let s = emptyState();
  // 5 respuestas malas en combo-count, 5 buenas en playable
  for (let i = 0; i < 5; i++) s = record(s, answer({ seed: i, question: 'combo-count', hits: 0, expected: 4 }));
  for (let i = 0; i < 5; i++) s = record(s, answer({ seed: 100 + i, question: 'playable', hits: 4, expected: 4 }));

  const st = stats(s);
  assert.equal(st.weakest.key, 'combo-count');
  assert.equal(st.weakest.dim, 'pregunta');

  const casiVacio = record(emptyState(), answer({ hits: 0, expected: 4 }));
  assert.equal(stats(casiVacio).weakest, null, 'con 1 respuesta no se declara una debilidad');
});

test('AC-PRG-15: record no muta el estado anterior', () => {
  const s0 = emptyState();
  const copia = JSON.stringify(s0);
  record(s0, answer({ hits: 0, expected: 3, missedIds: ['x'] }));
  assert.equal(JSON.stringify(s0), copia);
});

test('AC-PRG-16: mejor racha se conserva aunque la actual se corte', () => {
  let s = feed(emptyState(), [answer({ seed: 1 }), answer({ seed: 2 }), answer({ seed: 3 })]);
  assert.equal(s.streak, 3);
  s = record(s, answer({ seed: 4, hits: 0, expected: 3 }));
  assert.equal(s.streak, 0, 'se corto');
  assert.equal(s.bestStreak, 3, 'pero queda el record');
});
