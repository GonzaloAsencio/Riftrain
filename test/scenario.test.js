import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateScenario, visibleState, expandDeck, QUESTION } from '../src/engine/scenario.js';
import { playableCards } from '../src/engine/combos.js';
import { makeRng } from '../src/engine/rng.js';
import { RUNE_DECK_SIZE } from '../src/engine/runes.js';

const data = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'));
const cardsById = new Map(data.cards.map((c) => [c.id, c]));
const ctx = { decks: data.decks, cardsById };

const fingerprint = (s) => JSON.stringify({
  turn: s.turn, deck: s.deckId, question: s.question,
  runes: s.runes, hand: s.hand.map((c) => c.id), played: s.played.map((c) => c.id),
});

test('AC-SCN-01: DETERMINISMO — mismo seed, mismo escenario exacto', () => {
  for (const seed of [1, 42, 1337, 999999, 0]) {
    const a = generateScenario(seed, ctx);
    const b = generateScenario(seed, ctx);
    assert.equal(fingerprint(a), fingerprint(b), `seed ${seed} no es reproducible`);
  }
});

test('AC-SCN-02: seeds distintos dan escenarios distintos', () => {
  const vistos = new Set();
  for (let seed = 1; seed <= 40; seed++) vistos.add(fingerprint(generateScenario(seed, ctx)));
  assert.ok(vistos.size >= 35, `solo ${vistos.size}/40 distintos: el generador se repite demasiado`);
});

test('AC-SCN-03: todo escenario ENSENIA algo — hay jugables y hay no jugables', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const s = generateScenario(seed, ctx);
    const ok = playableCards(s.hand, s.runes).filter((v) => v.ok).length;
    assert.ok(ok >= 1, `seed ${seed}: no puede jugar NADA, no hay nada que anticipar`);
    assert.ok(ok < s.hand.length, `seed ${seed}: puede jugar TODO, la pregunta es trivial`);
  }
});

test('AC-SCN-04: la mesa nunca viola el invariante de 12', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const s = generateScenario(seed, ctx);
    assert.ok(s.runes.length <= RUNE_DECK_SIZE, `seed ${seed}: ${s.runes.length} runas en mesa`);
    assert.ok(s.runes.length >= 2);
  }
});

test('AC-SCN-05: la mano es de 5 a 7 cartas y sale del mazo del escenario', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = generateScenario(seed, ctx);
    assert.ok(s.hand.length >= 5 && s.hand.length <= 7, `mano de ${s.hand.length}`);
    const deck = data.decks.find((d) => d.id === s.deckId);
    const idsDelMazo = new Set(deck.cards.map((c) => c.cardId));
    for (const c of s.hand) assert.ok(idsDelMazo.has(c.id), `${c.id} no es del mazo ${s.deckId}`);
  }
});

test('AC-SCN-06: la mano respeta las copias del mazo — no inventa una 4ta de una x3', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const s = generateScenario(seed, ctx);
    const deck = data.decks.find((d) => d.id === s.deckId);
    const maxQty = new Map(deck.cards.map((c) => [c.cardId, c.qty]));
    const enMano = new Map();
    for (const c of [...s.hand, ...s.played]) enMano.set(c.id, (enMano.get(c.id) ?? 0) + 1);
    for (const [id, n] of enMano) {
      assert.ok(n <= maxQty.get(id), `seed ${seed}: ${n} copias de ${id} y el mazo trae ${maxQty.get(id)}`);
    }
  }
});

test('AC-SCN-07: INFORMACION OCULTA — el estado visible no filtra la mano', () => {
  const s = generateScenario(7, ctx);
  const visible = visibleState(s);
  assert.equal(visible.handCount, s.hand.length, 'se ve CUANTAS son');
  assert.ok(!('hand' in visible), 'pero NO cuales son');
  const serializado = JSON.stringify(visible);
  for (const c of s.hand) {
    assert.ok(!serializado.includes(c.name), `se filtro "${c.name}" al estado visible`);
  }
});

test('AC-SCN-08: la solucion la calcula el motor, no la UI', () => {
  const s = generateScenario(21, ctx);
  assert.ok(Array.isArray(s.solution.verdicts));
  assert.equal(s.solution.verdicts.length, s.hand.length);
  for (const v of s.solution.verdicts) {
    if (!v.ok) assert.ok(v.reason && v.reason.length > 0, 'todo rechazo trae motivo mostrable');
  }
});

test('AC-SCN-09: las preguntas de combinacion traen su respuesta resuelta', () => {
  const max = generateScenario(5, { ...ctx, questionType: QUESTION.COMBO_MAX });
  assert.equal(max.solution.kind, QUESTION.COMBO_MAX);
  assert.ok(max.solution.spend > 0);
  assert.ok(Array.isArray(max.solution.ties));

  const count = generateScenario(5, { ...ctx, questionType: QUESTION.COMBO_COUNT });
  assert.ok(count.solution.count >= 1);
});

test('AC-SCN-10: el nivel elige el modo de input de la escalera', () => {
  assert.equal(generateScenario(3, { ...ctx, level: 1 }).inputMode, 'pick-5');
  assert.equal(generateScenario(3, { ...ctx, level: 2 }).inputMode, 'pick-12');
  assert.equal(generateScenario(3, { ...ctx, level: 3 }).inputMode, 'autocomplete');
  assert.equal(generateScenario(3, { ...ctx, level: 4 }).inputMode, 'freetext');
  assert.equal(generateScenario(3, { ...ctx, level: 99 }).inputMode, 'freetext', 'se capa');
});

test('AC-SCN-11: el PRNG es estable — si cambia, se rompe toda la cola de repaso', () => {
  const rng = makeRng(12345);
  const muestra = [rng.int(100), rng.int(100), rng.int(100), rng.int(100), rng.int(100)];
  assert.deepEqual(muestra, [97, 30, 48, 81, 50], 'mulberry32 cambio de comportamiento');
});

test('AC-SCN-12: expandDeck respeta qty', () => {
  const deck = data.decks[0];
  const total = deck.cards.reduce((a, c) => a + c.qty, 0);
  assert.equal(expandDeck(deck, cardsById).length, total);
});
