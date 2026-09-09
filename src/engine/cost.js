/**
 * Validacion de pagabilidad. Sumar costes NO alcanza.
 *
 * EL CONCEPTO CRITICO:
 *   Una carta de 3 de Energia + 1 de Poder Fury NO cuesta 3 runas: cuesta 4.
 *   Tres agotadas mas una reciclada. Y esa reciclada le resta una runa al turno siguiente.
 *
 * El Poder es especifico de dominio: para pagar 1 de Poder Fury hace falta que una
 * runa DISPONIBLE sea de dominio Fury. No alcanza con tener runas.
 *
 * Por que la asignacion es trivial y no hace falta un matching bipartito:
 *   no hay comodines. Cada punto de Poder de dominio D solo puede pagarse con una
 *   runa de dominio D, y una runa de dominio D no sirve para ningun otro requisito
 *   de Poder. Los conjuntos son DISJUNTOS. Asi que alcanza con, por cada dominio,
 *   comparar disponibles contra requeridos; y despues chequear el total, porque la
 *   Energia (incolora) se paga con cualquier runa que haya sobrado.
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
  return { energy, power, powerTotal, runes: energy + powerTotal };
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
  return { energy, power, powerTotal, runes: energy + powerTotal };
}

/**
 * Runas DISPONIBLES, que no es lo mismo que runas en mesa:
 * una runa ya agotada este turno no puede volver a pagar nada.
 */
export function availableRunes(runes) {
  const byDomain = {};
  let total = 0;
  for (const r of runes) {
    if (!r.ready) continue;
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    total += 1;
  }
  return { total, byDomain, onBoard: runes.length };
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
  for (const [d, need] of Object.entries(cost.power)) {
    const have = avail.byDomain[d] ?? 0;
    if (have < need) {
      const label = DOMAIN_LABEL[d];
      const reason =
        have === 0
          ? `Pide ${plural(need, `${label}`, `${label}`)} y no hay runas ${label} disponibles`
          : `Pide ${need} ${label} y solo hay ${plural(have, 'runa', 'runas')} ${label} disponible${have === 1 ? '' : 's'}`;
      return {
        ok: false,
        reason,
        needed: cost.runes,
        available: avail.total,
        detail: { kind: 'domain', domain: d, need, have },
      };
    }
  }

  // 2. Total: la Energia es incolora, la paga cualquier runa que haya sobrado.
  if (cost.runes > avail.total) {
    const breakdown = costLabel(cost);
    return {
      ok: false,
      reason: `Cuesta ${plural(cost.runes, 'runa', 'runas')} (${breakdown}) y solo hay ${plural(avail.total, 'disponible', 'disponibles')}`,
      needed: cost.runes,
      available: avail.total,
      detail: { kind: 'total', need: cost.runes, have: avail.total },
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
