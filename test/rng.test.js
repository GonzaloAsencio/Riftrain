import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';

// Guarda directa del generador: AC-ARC-25 sólo ve shuffle (lo único que usa la mesa del recall).
// Si mulberry32 cambia, cambian todas las mesas y se invalida el progreso guardado.
test('AC-SCN-11: el PRNG es estable — si cambia, se rompe toda la cola de repaso', () => {
  const rng = makeRng(12345);
  const muestra = [rng.int(100), rng.int(100), rng.int(100), rng.int(100), rng.int(100)];
  assert.deepEqual(muestra, [97, 30, 48, 81, 50], 'mulberry32 cambio de comportamiento');
});
