import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecklist } from '../src/engine/decklist.js';

/**
 * El parser de decklists pegadas. PURO: no sabe que existe un textarea.
 *
 * No inventa cartas NUNCA. Si una linea no trae el costo, la carta queda
 * marcada como incompleta y alguien la va a tener que completar: el motor
 * necesita energia y poder por dominio para decidir si algo se puede pagar,
 * y adivinarlos seria entrenar con datos falsos.
 */

const byName = (r, name) => r.cards.find((c) => c.name === name);

test('AC-DCK-01: lee cantidad y nombre en las tres formas que usan los exports', () => {
  const r = parseDecklist('3 Chispa\n2x Descarga\nGranada x4');
  assert.equal(r.errors.length, 0);
  assert.equal(byName(r, 'Chispa').qty, 3);
  assert.equal(byName(r, 'Descarga').qty, 2);
  assert.equal(byName(r, 'Granada').qty, 4);
});

test('AC-DCK-02: sin cantidad, es una copia', () => {
  const r = parseDecklist('Tratado');
  assert.equal(byName(r, 'Tratado').qty, 1);
});

test('AC-DCK-03: el costo se lee cuando viene, con energia y poder por dominio', () => {
  const r = parseDecklist('3 Descarga | 2 + 1 fury\n1 Sello | 5 + 1 calm + 1 order\n2 Motin | 1 chaos');
  assert.deepEqual(byName(r, 'Descarga').power, { fury: 1 });
  assert.equal(byName(r, 'Descarga').energy, 2);
  assert.deepEqual(byName(r, 'Sello').power, { calm: 1, order: 1 });
  assert.equal(byName(r, 'Sello').energy, 5);
  assert.equal(byName(r, 'Motin').energy, 0, 'solo poder: la energia es cero, no se inventa');
  assert.deepEqual(byName(r, 'Motin').power, { chaos: 1 });
});

test('AC-DCK-04: sin costo NO se inventa nada: la carta queda incompleta', () => {
  const r = parseDecklist('2 Bastion');
  const c = byName(r, 'Bastion');
  assert.equal(c.needsCost, true);
  assert.equal(c.energy, null, 'null es "no se", 0 seria una mentira barata');
  assert.deepEqual(r.needsCost, [c.id]);
  assert.equal(r.errors.length, 0, 'no traer costo no es un error de formato');
});

test('AC-DCK-05: un costo con energia queda completo', () => {
  const r = parseDecklist('2 Bastion | 3');
  assert.equal(byName(r, 'Bastion').needsCost, false);
  assert.equal(byName(r, 'Bastion').energy, 3);
  assert.deepEqual(r.needsCost, []);
});

test('AC-DCK-06: todo rechazo devuelve su motivo', () => {
  const r = parseDecklist('0 Chispa\n3 \n2 Augurio | 1 lunar\n2 Motin | abc');
  assert.equal(r.cards.length, 0);
  assert.equal(r.errors.length, 4);
  for (const e of r.errors) {
    assert.ok(e.reason && e.reason.length > 5, `sin motivo: ${JSON.stringify(e)}`);
    assert.ok(Number.isInteger(e.line), 'el motivo tiene que decir en que linea');
  }
  assert.match(r.errors[2].reason, /lunar/, 'el dominio desconocido se nombra');
});

test('AC-DCK-07: comentarios y lineas vacias se ignoran sin ensuciar los errores', () => {
  const r = parseDecklist('# Aggro Fury\n\n// esto es una nota\n3 Chispa | 1\n\n');
  assert.equal(r.errors.length, 0);
  assert.equal(r.cards.length, 1);
});

test('AC-DCK-08: el nombre del mazo sale del encabezado', () => {
  const r = parseDecklist('# Aggro Fury/Chaos\n3 Chispa | 1');
  assert.equal(r.deck.name, 'Aggro Fury/Chaos');
});

test('AC-DCK-09: la misma carta repetida suma copias en vez de duplicarse', () => {
  const r = parseDecklist('2 Chispa | 1\n1 Chispa | 1');
  assert.equal(r.cards.length, 1);
  assert.equal(byName(r, 'Chispa').qty, 3);
  assert.equal(r.deck.cards.length, 1);
  assert.equal(r.deck.cards[0].qty, 3);
});

test('AC-DCK-10: los dominios del mazo salen de los costos, no de una lista aparte', () => {
  const r = parseDecklist('3 Descarga | 2 + 1 fury\n2 Motin | 1 chaos\n2 Bastion');
  assert.deepEqual([...r.deck.domains].sort(), ['chaos', 'fury']);
});

test('AC-DCK-11: el resultado entra tal cual en el motor de escenarios', () => {
  const r = parseDecklist('3 Chispa | 1\n2 Descarga | 2 + 1 fury');
  // El contrato que ya exige expandDeck(): deck.cards con { cardId, qty }.
  for (const entry of r.deck.cards) {
    assert.ok(entry.cardId, 'cada entrada del mazo tiene cardId');
    assert.ok(entry.qty >= 1);
    assert.ok(r.cards.some((c) => c.id === entry.cardId), 'y ese cardId existe en cards');
  }
});

test('AC-DCK-12: entradas invalidas explotan, no devuelven basura', () => {
  assert.throws(() => parseDecklist(null), TypeError);
  assert.throws(() => parseDecklist(42), TypeError);
  assert.throws(() => parseDecklist(), TypeError);
});
