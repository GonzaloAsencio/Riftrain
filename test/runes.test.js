import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectRunes, channelAmount, runesAtTurn, turnReaching,
  invariantHolds, RUNE_DECK_SIZE,
} from '../src/engine/runes.js';

test('AC-RUN-01: sin reciclar, jugando primero, la mesa sube de a 2', () => {
  const { steps } = projectRunes({ startBoard: 0, turns: 5 });
  assert.deepEqual(steps.map((s) => s.after), [2, 4, 6, 8, 10]);
});

test('AC-RUN-02: la mesa se topea en 12 y ahi deja de canalizar', () => {
  const { steps, final, max } = projectRunes({ startBoard: 0, turns: 9 });
  assert.equal(final, RUNE_DECK_SIZE);
  assert.equal(max, RUNE_DECK_SIZE);
  assert.equal(steps[5].after, 12, 'llega a 12 en T6');
  assert.equal(steps[6].channeled, 0, 'en T7 ya no canaliza nada');
  assert.equal(steps[8].after, 12, 'y se queda ahi');
});

test('AC-RUN-03: INVARIANTE mesa + mazo = 12 en cada paso', () => {
  for (const recycles of [[], [1, 1, 1, 1, 1, 1], [3, 0, 2, 0, 4, 1], [12, 12, 12]]) {
    const { steps } = projectRunes({ startBoard: 0, turns: 6, recycles });
    for (const s of steps) {
      assert.ok(invariantHolds(s), `roto en ${s.formula} (mazo ${s.deck})`);
    }
  }
});

test('AC-RUN-04: jugando segundo, el primer turno canaliza 3', () => {
  const { steps } = projectRunes({ startBoard: 0, turns: 3, firstTurnOnTheDraw: true });
  assert.deepEqual(steps.map((s) => s.after), [3, 5, 7]);
  assert.equal(steps[0].channeled, 3);
  assert.equal(steps[1].channeled, 2, 'el 3 es SOLO el primer turno');
});

test('AC-RUN-05: la cadena aritmetica se muestra tal cual el ejemplo del usuario', () => {
  const { steps } = projectRunes({ startBoard: 9, startTurn: 5, turns: 1, recycles: [2] });
  assert.equal(steps[0].formula, 'T5: 9 − 2 + 2 = 9');
});

test('AC-RUN-06: reciclar reduce la mesa y el turno siguiente lo paga', () => {
  const sinReciclar = projectRunes({ startBoard: 6, turns: 2 });
  const conReciclar = projectRunes({ startBoard: 6, turns: 2, recycles: [2, 0] });
  assert.equal(sinReciclar.final, 10);
  assert.equal(conReciclar.final, 8, 'dos recicladas cuestan dos runas para siempre');
});

test('AC-RUN-07: no se puede reciclar mas runas de las que hay en mesa', () => {
  const { steps } = projectRunes({ startBoard: 3, turns: 1, recycles: [7] });
  assert.equal(steps[0].recycled, 3, 'se capa a lo que hay');
  assert.equal(steps[0].requestedRecycle, 7, 'pero queda registrado lo que se pidio');
  assert.equal(steps[0].after, 2, '3 - 3 + 2');
});

test('AC-RUN-08: canalizar nunca pasa de 12 aunque haya lugar de sobra', () => {
  assert.equal(channelAmount(11), 1, 'con 11 en mesa solo entra 1');
  assert.equal(channelAmount(12), 0);
  assert.equal(channelAmount(0), 2);
  assert.equal(channelAmount(0, { firstTurnOnTheDraw: true }), 3);
  assert.equal(channelAmount(10, { firstTurnOnTheDraw: true }), 2, 'el cap de 3 no rompe el techo de 12');
});

test('AC-RUN-09: runesAtTurn y turnReaching', () => {
  assert.equal(runesAtTurn(5, { startBoard: 0, turns: 99 }), 10);
  assert.equal(turnReaching(8, { startBoard: 0, turns: 10 }), 4);
  assert.equal(turnReaching(12, { startBoard: 0, turns: 10 }), 6);
  assert.equal(turnReaching(13, { startBoard: 0, turns: 10 }), null, '13 es imposible: el mazo tiene 12');
});

test('AC-RUN-10: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => projectRunes({ startBoard: 13, turns: 1 }), RangeError);
  assert.throws(() => projectRunes({ startBoard: -1, turns: 1 }), RangeError);
  assert.throws(() => projectRunes({ startBoard: 0, turns: 0 }), RangeError);
});
