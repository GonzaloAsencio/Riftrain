import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/engine/rng.js';
import { DOMAIN_COLOR } from '../src/engine/runes.js';
import { spawnConfetti, stepConfetti } from '../src/ui/confetti.js';

const W = 1920;
const H = 1080;
const spawn = (seed = 1) => spawnConfetti({ width: W, height: H, rand: mulberry32(seed) });
const run = (pieces, frames) => { let p = pieces; for (let i = 0; i < frames; i++) p = stepConfetti(p); return p; };

test('AC-CEL-26: salen de los dos cañones de abajo, disparados hacia arriba y hacia el centro', () => {
  const pieces = spawn();
  assert.ok(pieces.length >= 120, `${pieces.length}`);
  const left = pieces.filter((p) => p.x < W / 2);
  const right = pieces.filter((p) => p.x >= W / 2);
  assert.ok(left.length > 0 && right.length > 0);
  assert.ok(pieces.every((p) => p.y >= H * 0.9), 'arrancan abajo');
  assert.ok(pieces.every((p) => p.vy < 0), 'todos suben al salir');
  assert.ok(left.every((p) => p.vx > 0) && right.every((p) => p.vx < 0), 'los dos cañones apuntan hacia el centro');
});

test('AC-CEL-27: cubren la pantalla: suben hasta la mitad de arriba y se reparten a lo ancho', () => {
  let pieces = spawn();
  let top = H;
  const xs = new Set();
  for (let i = 0; i < 90; i++) {
    pieces = stepConfetti(pieces);
    for (const p of pieces) { top = Math.min(top, p.y); xs.add(Math.floor(p.x / (W / 4))); }
  }
  assert.ok(top < H * 0.35, `el más alto llegó a ${Math.round(top)}`);
  assert.deepEqual([...xs].filter((q) => q >= 0 && q < 4).sort(), [0, 1, 2, 3], 'pasan por los cuatro cuartos de ancho');
});

test('AC-CEL-28: el aire los frena y la gravedad los baja: después de subir, caen', () => {
  const pieces = run(spawn(), 60);
  assert.ok(pieces.length > 0);
  assert.ok(pieces.filter((p) => p.vy > 0).length > pieces.length / 2, 'a los 60 cuadros la mayoría ya cae');
  const speed0 = Math.hypot(spawn()[0].vx, spawn()[0].vy);
  assert.ok(Math.abs(pieces[0].vx) < speed0 / 4, 'la velocidad lateral se frenó');
});

test('AC-CEL-29: son papelitos de los seis colores de runa, que se balancean y se desvanecen hasta desaparecer', () => {
  const pieces = spawn();
  assert.deepEqual(new Set(pieces.map((p) => p.color)), new Set(Object.values(DOMAIN_COLOR)));
  const later = run(pieces, 20);
  assert.ok(new Set(later.map((p) => Math.sign(Math.cos(p.wobble)))).size === 2, 'unos de canto y otros de frente');
  assert.ok(later.every((p) => p.opacity <= 1 && p.opacity > 0));
  assert.equal(run(spawn(), 400).length, 0, 'a los 400 cuadros no queda ninguno');
});

test('AC-CEL-30: mismo seed, mismo festejo; la entrada no se muta', () => {
  assert.deepEqual(spawn(9), spawn(9));
  const pieces = spawn(9);
  const copy = structuredClone(pieces);
  stepConfetti(pieces);
  assert.deepEqual(pieces, copy);
});
