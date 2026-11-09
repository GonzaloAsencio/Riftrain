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
 * EL PODER DE DOS DOMINIOS (regla fijada por el usuario, 2026-11-09): una carta de
 * dos dominios trae el Poder como UN numero (`powerAny: {amount, domains}`) y cada
 * punto se paga reciclando una runa de CUALQUIERA de esos dominios. Blade of the
 * Exile (3 + 1, Calm y Chaos) se paga con una Calm o con una Chaos.
 *
 * La asignacion: el Poder de dominio fijo se reserva primero (esas runas no tienen
 * alternativa). Lo que queda se reparte entre los requisitos "de cualquiera" con la
 * condicion de Hall: para todo subconjunto de requisitos, lo pedido no supera las
 * runas libres de la union de sus dominios. Con 6 dominios son pocos subconjuntos,
 * y asi nunca se rechaza una jugada que en la mesa real se hace.
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
  const choices = [];
  const any = card.powerAny;
  if (any && any.amount > 0) {
    choices.push({ amount: any.amount, domains: [...any.domains].sort() });
    powerTotal += any.amount;
  }
  const energy = card.energy ?? 0;
  return { energy, power, choices, powerTotal, runes: runesNeeded(energy, powerTotal) };
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
  const byDomains = new Map();   // requisitos "de cualquiera" con los mismos dominios se suman
  let energy = 0;
  let powerTotal = 0;
  for (const c of costs) {
    energy += c.energy;
    for (const [d, n] of Object.entries(c.power)) {
      power[d] = (power[d] ?? 0) + n;
      powerTotal += n;
    }
    for (const { amount, domains } of c.choices ?? []) {
      const key = domains.join('+');
      byDomains.set(key, { amount: (byDomains.get(key)?.amount ?? 0) + amount, domains });
      powerTotal += amount;
    }
  }
  return { energy, power, choices: [...byDomains.values()], powerTotal, runes: runesNeeded(energy, powerTotal) };
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
  for (const { amount, domains } of cost.choices ?? []) {
    parts.push(`${amount} ${domains.map((d) => DOMAIN_LABEL[d]).join('/')}`);
  }
  return parts.join(' + ');
}

/**
 * El primer grupo de requisitos "de cualquiera" que no se puede cubrir con las runas libres
 * (condicion de Hall), o null si todos se cubren.
 */
function uncoveredChoice(choices, free) {
  const k = choices.length;
  for (let mask = 1; mask < 2 ** k; mask++) {
    let need = 0;
    const domains = new Set();
    choices.forEach((choice, i) => {
      if (!(mask & (1 << i))) return;
      need += choice.amount;
      choice.domains.forEach((d) => domains.add(d));
    });
    const have = [...domains].reduce((sum, d) => sum + Math.max(0, free[d] ?? 0), 0);
    if (have < need) return { domains: [...domains].sort(), need, have };
  }
  return null;
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

  // 1b. El Poder de dos dominios, con las runas en mesa que el dominio fijo dejo libres.
  if (cost.choices?.length) {
    const free = {};
    for (const [d, n] of Object.entries(avail.onBoardByDomain ?? {})) free[d] = n - (cost.power[d] ?? 0);
    const gap = uncoveredChoice(cost.choices, free);
    if (gap) {
      const labels = gap.domains.map((d) => DOMAIN_LABEL[d]);
      const reason = gap.have === 0
        ? `Pide ${gap.need} de Poder ${labels.join(' o ')} y no hay runas ${labels.join(' ni ')} en mesa`
        : `Pide ${gap.need} de Poder ${labels.join(' o ')} y solo hay ${plural(gap.have, 'runa', 'runas')} ${labels.join(' o ')} libres en mesa`;
      return {
        ok: false,
        reason,
        needed: cost.runes,
        available: avail.total,
        detail: { kind: 'domain', domains: gap.domains, need: gap.need, have: gap.have },
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

/**
 * Que runas de la mesa explican un rechazo de canPay.
 * Devuelve `{ indices, missingDomain }`:
 *   - Dominio -> los indices de las runas de ese dominio en mesa, abiertas o agotadas
 *     (para reciclar no hace falta que esten abiertas). Si no hay ninguna, `indices`
 *     queda vacio y `missingDomain` nombra el dominio que falta.
 *   - Energia -> los indices de las runas abiertas.
 *   - Cualquier otro detail (null, ok, desconocido) -> nada que resaltar.
 */
export function rejectionRunes(detail, runes) {
  const none = { indices: [], missingDomain: null };
  if (!Array.isArray(runes)) return none;
  if (detail?.kind === 'domain' && Array.isArray(detail.domains)) {
    // Dos dominios: se resaltan las runas de cualquiera de los dos; si no hay ninguna, se nombran los dos.
    const indices = runes.flatMap((r, i) => (detail.domains.includes(r?.domain) ? [i] : []));
    return { indices, missingDomain: null, missingDomains: indices.length ? [] : [...detail.domains] };
  }
  if (detail?.kind === 'domain') {
    const indices = runes.flatMap((r, i) => (r?.domain === detail.domain ? [i] : []));
    return { indices, missingDomain: indices.length ? null : detail.domain };
  }
  if (detail?.kind === 'energy') return { indices: runes.flatMap((r, i) => (r?.ready ? [i] : [])), missingDomain: null };
  return none;
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
