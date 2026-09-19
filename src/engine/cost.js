/**
 * Validacion de pagabilidad.
 *
 * EL CONCEPTO CRITICO — "rune floating":
 *   Una runa tiene DOS usos y los dos se pueden gastar en el mismo turno.
 *     - AGOTARLA da 1 de Energia (incolora). Reversible: se endereza en el Awaken.
 *     - RECICLARLA da 1 de Poder de su dominio. Permanente: sale de la mesa.
 *   Primero se agota y despues se recicla; al reves no, porque reciclada ya no esta.
 *
 *   Por eso 3 de Energia + 1 de Poder Fury se paga con TRES runas Fury, no con
 *   cuatro: se agotan las tres y UNA DE ESAS MISMAS se recicla. Los costes NO
 *   se suman.
 *
 * LAS DOS MITADES MIRAN COSAS DISTINTAS, y es lo unico que hay que tener claro:
 *   - La ENERGIA necesita runas ABIERTAS. Una agotada ya no da energia.
 *   - El PODER necesita runas EN MESA del dominio pedido, abiertas o no: para
 *     reciclar una runa no hace falta que este abierta.
 *
 * Por que la asignacion es trivial y no hace falta un matching bipartito:
 *   no hay comodines. Cada punto de Poder de dominio D solo puede pagarse con una
 *   runa de dominio D, y una runa de dominio D no sirve para ningun otro requisito
 *   de Poder. Los conjuntos son DISJUNTOS. Asi que alcanza con comparar, por cada
 *   dominio, lo que hay en mesa contra lo que se pide.
 *
 * (Hasta 2026-09-19 este modulo cobraba energia + poder. Era un bug, y de los
 * caros: rechazaba jugadas que en la mesa real se hacen.)
 */

import { DOMAINS, DOMAIN_LABEL } from './runes.js';

/** Coste total de una carta, normalizado. */
export function cardCost(card) {
  const power = {};
  let powerTotal = 0;
  for (const d of DOMAINS) {
    const n = card.power?.[d] ?? 0;
    if (n > 0) {
      power[d] = n;
      powerTotal += n;
    }
  }
  const energy = card.energy ?? 0;
  return { energy, power, powerTotal, runes: runesNeeded(energy, powerTotal) };
}

/**
 * Cuantas runas distintas tienen que participar como minimo.
 * NO es la suma: una misma runa puede agotarse por Energia y despues reciclarse
 * por Poder, asi que manda la mitad mas grande.
 */
function runesNeeded(energy, powerTotal) {
  return Math.max(energy, powerTotal);
}

/** Suma los costes de varias cartas en un unico coste combinado. */
export function sumCosts(costs) {
  const power = {};
  let energy = 0;
  let powerTotal = 0;
  for (const c of costs) {
    energy += c.energy;
    for (const [d, n] of Object.entries(c.power)) {
      power[d] = (power[d] ?? 0) + n;
      powerTotal += n;
    }
  }
  return { energy, power, powerTotal, runes: runesNeeded(energy, powerTotal) };
}

/**
 * Lo que hay para pagar, separado en las dos cosas que NO son lo mismo:
 *
 *   total / byDomain        -> runas ABIERTAS. Es lo que paga ENERGIA.
 *   onBoard / onBoardByDomain -> runas EN MESA, abiertas o agotadas. Es lo que
 *                                se puede RECICLAR por Poder.
 */
export function availableRunes(runes) {
  const byDomain = {};
  const onBoardByDomain = {};
  let total = 0;
  for (const r of runes) {
    onBoardByDomain[r.domain] = (onBoardByDomain[r.domain] ?? 0) + 1;
    if (!r.ready) continue;
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    total += 1;
  }
  return { total, byDomain, onBoardByDomain, onBoard: runes.length };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Texto corto de un coste: "3 + 1 Fury". */
export function costLabel(cost) {
  const parts = [];
  if (cost.energy > 0 || cost.powerTotal === 0) parts.push(String(cost.energy));
  for (const [d, n] of Object.entries(cost.power)) {
    parts.push(`${n} ${DOMAIN_LABEL[d]}`);
  }
  return parts.join(' + ');
}

/**
 * Puede pagarse este coste con estas runas disponibles?
 * Devuelve SIEMPRE el motivo del rechazo, para mostrarlo al dar vuelta la carta.
 *
 * @returns {{ok: boolean, reason: string|null, needed: number, available: number, detail: object}}
 */
export function canPay(cost, avail) {
  // 1. Dominios primero: es el rechazo mas informativo y el que mas se olvida.
  //    Se mira la MESA, no las abiertas: una runa agotada igual se recicla.
  for (const [d, need] of Object.entries(cost.power)) {
    const have = avail.onBoardByDomain?.[d] ?? 0;
    if (have < need) {
      const label = DOMAIN_LABEL[d];
      const reason =
        have === 0
          ? `Pide ${need} ${label} y no hay runas ${label} en mesa`
          : `Pide ${need} ${label} y solo hay ${plural(have, 'runa', 'runas')} ${label} en mesa`;
      return {
        ok: false,
        reason,
        needed: cost.runes,
        available: avail.total,
        detail: { kind: 'domain', domain: d, need, have },
      };
    }
  }

  // 2. La Energia es incolora, pero SI necesita runas abiertas.
  if (cost.energy > avail.total) {
    return {
      ok: false,
      reason: `Pide ${cost.energy} de Energia y solo hay ${plural(avail.total, 'runa abierta', 'runas abiertas')}`,
      needed: cost.energy,
      available: avail.total,
      detail: { kind: 'energy', need: cost.energy, have: avail.total },
    };
  }

  return {
    ok: true,
    reason: null,
    needed: cost.runes,
    available: avail.total,
    detail: { kind: 'ok', recycled: cost.powerTotal, exhausted: cost.energy },
  };
}

/** Puede jugar ESTA carta con ESTAS runas? */
export function canPlayCard(card, runes) {
  return canPay(cardCost(card), availableRunes(runes));
}

/** Puede jugar TODAS estas cartas en el mismo turno? (pool comun de runas) */
export function canPlaySet(cards, runes) {
  if (cards.length === 0) {
    return { ok: true, reason: null, needed: 0, available: availableRunes(runes).total, detail: { kind: 'empty' } };
  }
  return canPay(sumCosts(cards.map(cardCost)), availableRunes(runes));
}

/**
 * Cuantas runas quedan en mesa el turno siguiente despues de pagar esto.
 * Solo el Poder (reciclado) reduce la mesa. La Energia (agotado) se endereza.
 */
export function boardAfterPaying(cost, boardSize) {
  return Math.max(0, boardSize - cost.powerTotal);
}
