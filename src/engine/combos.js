/**
 * Combinaciones jugables en un mismo turno.
 *
 * La mano concreta es de 5 a 7 cartas, asi que enumerar los 2^7 = 128 subconjuntos
 * es gratis. NO calculamos sobre el mazo entero: si tiene una sola copia, no puede
 * jugar dos.
 *
 * Cartas repetidas en la mano son instancias distintas en el abanico, pero la misma
 * COMBINACION: {copia A} y {copia B} de la misma carta cuentan una sola vez. Por eso
 * cada subconjunto se canonicaliza por multiset de cardId antes de contar.
 */

import { cardCost, sumCosts, availableRunes, canPay } from './cost.js';

const MAX_HAND_FOR_ENUMERATION = 12; // 4096 subconjuntos, tope de seguridad

/** Clave canonica de un subconjunto: multiset de ids ordenado. */
function comboKey(cards) {
  return cards
    .map((c) => c.id)
    .sort()
    .join('|');
}

/** Pregunta A: que cartas puede jugar, una por una. */
export function playableCards(hand, runes) {
  const avail = availableRunes(runes);
  return hand.map((card) => {
    const cost = cardCost(card);
    const check = canPay(cost, avail);
    return { card, cost, ...check };
  });
}

/**
 * Verificacion puntual: "puede jugar esta unidad Y ademas este hechizo?"
 * Es lo que uno piensa de verdad en la mesa: no enumeras todo, verificas
 * la amenaza que te preocupa.
 */
export function verifyCombo(cards, runes) {
  const avail = availableRunes(runes);
  const cost = cards.length ? sumCosts(cards.map(cardCost)) : { energy: 0, power: {}, powerTotal: 0, runes: 0 };
  const check = canPay(cost, avail);
  return { cards, cost, ...check };
}

/**
 * Enumera todas las combinaciones jugables distintas.
 * @param {object} o
 * @param {number} o.minSize  tamanio minimo del conjunto (default 1: una sola carta
 *                            tambien es una opcion del turno)
 */
export function enumerateCombos(hand, runes, { minSize = 1 } = {}) {
  if (hand.length > MAX_HAND_FOR_ENUMERATION) {
    throw new RangeError(`Mano de ${hand.length} cartas: demasiado para enumerar`);
  }
  const avail = availableRunes(runes);
  const seen = new Set();
  const combos = [];

  const total = 1 << hand.length;
  for (let mask = 1; mask < total; mask++) {
    const picked = [];
    for (let i = 0; i < hand.length; i++) {
      if (mask & (1 << i)) picked.push(hand[i]);
    }
    if (picked.length < minSize) continue;

    const key = comboKey(picked);
    if (seen.has(key)) continue;

    const cost = sumCosts(picked.map(cardCost));
    const check = canPay(cost, avail);
    if (!check.ok) continue;

    seen.add(key);
    combos.push({ cards: picked, cost, key, spend: cost.runes });
  }

  return combos;
}

/** Cuantas combinaciones distintas puede jugar. */
export function countCombos(hand, runes, opts) {
  return enumerateCombos(hand, runes, opts).length;
}

/**
 * La combinacion que MAS runas gasta.
 * Devuelve los empates aparte: si hay dos conjuntos que gastan lo mismo,
 * la pregunta de seleccion tiene que aceptar cualquiera de los dos.
 */
export function mostExpensiveCombo(hand, runes, opts) {
  const combos = enumerateCombos(hand, runes, opts);
  if (combos.length === 0) return { best: null, spend: 0, ties: [] };

  let spend = -1;
  for (const c of combos) if (c.spend > spend) spend = c.spend;

  const ties = combos.filter((c) => c.spend === spend);
  // Desempate estable: primero la que usa MENOS cartas, despues por clave.
  ties.sort((a, b) => a.cards.length - b.cards.length || a.key.localeCompare(b.key));
  return { best: ties[0], spend, ties };
}

/**
 * La trampa que el usuario quiere entrenar: "es facil ver que puede jugar la carta
 * de 5 y olvidarse de que tambien puede jugar dos de 2 mas una de 1".
 * Devuelve la combinacion multi-carta mas cara cuando SUPERA a la mejor carta sola.
 */
export function sneakyCombo(hand, runes) {
  const singles = enumerateCombos(hand, runes, { minSize: 1 }).filter((c) => c.cards.length === 1);
  const bestSingle = singles.reduce((max, c) => (c.spend > max ? c.spend : max), 0);
  const multi = enumerateCombos(hand, runes, { minSize: 2 });
  if (multi.length === 0) return null;
  const best = multi.reduce((a, b) => (b.spend > a.spend ? b : a));
  return best.spend > bestSingle ? { combo: best, bestSingle } : null;
}
