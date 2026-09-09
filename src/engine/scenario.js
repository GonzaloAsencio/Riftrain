/**
 * Generacion de escenarios. TODO sale del seed: mismo seed, mismo escenario,
 * hasta el ultimo detalle. Eso es lo que permite la cola de repaso: guardo el
 * seed de lo que falle y lo vuelvo a enfrentar identico.
 *
 * INFORMACION OCULTA: el escenario tiene todo adentro, pero el jugador solo ve
 * lo que veria en una partida real (cartas jugadas, runas en mesa, cantidad de
 * cartas en mano). Lo desconocido se dibuja boca abajo, NUNCA como texto.
 */

import { makeRng } from './rng.js';
import { projectRunes, DOMAINS } from './runes.js';
import { playableCards, mostExpensiveCombo, countCombos, sneakyCombo } from './combos.js';

export const QUESTION = {
  PLAYABLE: 'playable',        // A: que cartas puede jugar
  COMBO_VERIFY: 'combo-verify',// B1: puede jugar estas dos juntas?
  COMBO_MAX: 'combo-max',      // B2: cual es el conjunto que mas gasta
  COMBO_COUNT: 'combo-count',  // B3: cuantas combinaciones distintas
};

/** El nivel controla la escalera de reconocimiento -> evocacion (seccion 1). */
export const INPUT_MODE = {
  1: 'pick-5',      // 5 cartas visibles, marco las jugables
  2: 'pick-12',     // 12 visibles, la mitad no son del mazo
  3: 'autocomplete',// campo con autocompletado sobre el mazo
  4: 'freetext',    // campo sin ayuda, coincidencia difusa al confirmar
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Expande un deck a la lista de instancias jugables (respetando qty). */
export function expandDeck(deck, cardsById) {
  const out = [];
  for (const { cardId, qty } of deck.cards) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    for (let i = 0; i < qty; i++) out.push(card);
  }
  return out;
}

/** Mesa de runas realista para el turno N: proyectada, no inventada. */
function buildBoard(rng, turn, domains) {
  const onTheDraw = rng.chance(0.5);
  // Reciclados plausibles: los mazos reciclan de a poco, no siempre.
  const recycles = Array.from({ length: turn }, () => (rng.chance(0.45) ? rng.range(1, 2) : 0));
  const { steps } = projectRunes({
    startBoard: 0,
    turns: turn,
    recycles,
    firstTurnOnTheDraw: onTheDraw,
  });
  const boardSize = steps[steps.length - 1].after;

  // Los dominios de la mesa salen de los dominios del mazo, con algo de sesgo
  // para que no queden siempre repartidos parejo.
  const pool = domains.length ? domains : DOMAINS;
  const runeDomains = Array.from({ length: boardSize }, () => rng.pick(pool));

  // Si ya jugo algo este turno, tiene runas agotadas. "Abiertas" != "en mesa".
  const exhausted = rng.chance(0.35) ? rng.range(1, Math.max(1, Math.floor(boardSize / 3))) : 0;
  const runes = runeDomains.map((domain, i) => ({ domain, ready: i >= exhausted }));

  return { runes, boardSize, exhausted, onTheDraw, recycles, steps };
}

/** Un escenario sirve si hay algo que decidir: cartas jugables Y cartas que no. */
function isInteresting(hand, runes) {
  const verdict = playableCards(hand, runes);
  const yes = verdict.filter((v) => v.ok).length;
  return yes >= 1 && yes < hand.length;
}

/**
 * @param {number} seed
 * @param {object} ctx  { decks, cardsById, level }
 * @returns {object} escenario completo, con la solucion ya resuelta por el motor
 */
export function generateScenario(seed, { decks, cardsById, level = 1, questionType = null } = {}) {
  // Hasta 24 intentos derivados del seed para caer en un escenario que enseñe algo.
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = makeRng((seed + attempt * 0x9e3779b9) >>> 0);
    const deck = rng.pick(decks);
    const pool = expandDeck(deck, cardsById);
    if (pool.length < 7) continue;

    const turn = rng.range(3, 8);
    const { runes, boardSize, exhausted, onTheDraw, steps } = buildBoard(rng, turn, deck.domains);
    if (boardSize < 2) continue;

    const shuffled = rng.shuffle(pool);
    const handSize = rng.range(5, 7);
    const hand = shuffled.slice(0, handSize);
    const playedCount = rng.range(0, 3);
    const played = shuffled.slice(handSize, handSize + playedCount);

    if (!isInteresting(hand, runes)) continue;

    const qType = questionType ?? pickQuestion(rng, hand, runes);
    const scenario = {
      seed,
      attempt,
      turn,
      deckId: deck.id,
      deckName: deck.name,
      runes,
      hand,
      played,
      hiddenCount: hand.length,
      onTheDraw,
      exhausted,
      projection: steps,
      question: qType,
      inputMode: INPUT_MODE[clamp(level, 1, 4)],
      level: clamp(level, 1, 4),
    };
    scenario.solution = solve(scenario);
    return scenario;
  }
  throw new Error(`No se pudo generar un escenario jugable con seed ${seed}`);
}

function pickQuestion(rng, hand, runes) {
  const weights = [
    [QUESTION.PLAYABLE, 0.55],
    [QUESTION.COMBO_VERIFY, 0.2],
    [QUESTION.COMBO_MAX, 0.15],
    [QUESTION.COMBO_COUNT, 0.1],
  ];
  const roll = rng.next();
  let acc = 0;
  for (const [q, w] of weights) {
    acc += w;
    if (roll < acc) return q;
  }
  return QUESTION.PLAYABLE;
}

/** Resuelve el escenario con el motor. La UI nunca calcula nada por su cuenta. */
export function solve(scenario) {
  const { hand, runes, question } = scenario;
  const verdicts = playableCards(hand, runes);
  const playable = verdicts.filter((v) => v.ok).map((v) => v.card);

  const base = {
    verdicts,
    playableIds: playable.map((c) => c.id),
    sneaky: sneakyCombo(hand, runes),
  };

  switch (question) {
    case QUESTION.COMBO_MAX: {
      const { best, spend, ties } = mostExpensiveCombo(hand, runes);
      return { ...base, kind: question, best, spend, ties };
    }
    case QUESTION.COMBO_COUNT:
      return { ...base, kind: question, count: countCombos(hand, runes) };
    case QUESTION.COMBO_VERIFY:
    case QUESTION.PLAYABLE:
    default:
      return { ...base, kind: question };
  }
}

/** Lo que el jugador PUEDE ver. El resto se dibuja boca abajo. */
export function visibleState(scenario) {
  return {
    turn: scenario.turn,
    deckName: scenario.deckName,
    runes: scenario.runes,
    played: scenario.played,
    handCount: scenario.hand.length,
    question: scenario.question,
    inputMode: scenario.inputMode,
  };
}
