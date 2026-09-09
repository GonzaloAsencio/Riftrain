/**
 * Parser de decklists pegadas. PURO: no sabe que existe un textarea.
 *
 * POR QUE ES TOLERANTE: los exports de decklists no se pusieron de acuerdo
 * nunca. "3 Carta", "3x Carta" y "Carta x3" son la misma frase escrita por tres
 * programas distintos, asi que las tres entran.
 *
 * POR QUE NO INVENTA NADA: el motor necesita energia y poder POR DOMINIO para
 * decidir si una carta se puede pagar — es literalmente la habilidad que el
 * entrenador entrena. Una lista pegada suele traer solo nombre y cantidad. Si
 * el costo no viene, la carta queda marcada `needsCost` y con `energy: null`.
 * Null es "no se". Un 0 seria una mentira barata que despues se entrena como
 * si fuera verdad.
 *
 * TODO RECHAZO DEVUELVE SU MOTIVO (regla 9 del dominio): la linea que no se
 * entendio se informa con numero de linea y explicacion, nunca se descarta en
 * silencio.
 *
 * FORMATO DEL COSTO (opcional, despues de "|"):
 *    | 3                    -> 3 de energia
 *    | 2 + 1 fury           -> 2 de energia y 1 de poder Fury
 *    | 1 chaos              -> 0 de energia y 1 de poder Chaos
 *    | 5 + 1 calm + 1 order -> 5 de energia y un poder de cada dominio
 */

import { DOMAINS } from './runes.js';

const COMMENT = /^\/\//;
const HEADER = /^#\s*(.*)$/;

/** Id estable a partir del nombre: sin acentos, sin espacios, minusculas. */
export function slug(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Separa la cantidad del nombre en las tres formas que usan los exports. */
function splitQty(text) {
  let m = /^(\d+)\s*[x*]?\s+(.+)$/i.exec(text);
  if (m) return { qty: Number(m[1]), name: m[2].trim() };

  m = /^(.+?)\s+[x*]\s*(\d+)$/i.exec(text);
  if (m) return { qty: Number(m[2]), name: m[1].trim() };

  return { qty: 1, name: text.trim() };
}

/** "2 + 1 fury" -> { energy: 2, power: { fury: 1 } }. Devuelve { error } si no se entiende. */
function parseCost(raw) {
  const parts = raw.split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'el costo esta vacio: poner "| 2 + 1 fury", o sacar la barra' };

  let energy = null;
  const power = {};

  for (const part of parts) {
    const m = /^(\d+)(?:\s+([a-zA-Z]+))?$/.exec(part);
    if (!m) {
      return { error: `no entiendo "${part}" como parte de un costo (se espera "2" o "1 fury")` };
    }
    const n = Number(m[1]);
    const domain = m[2]?.toLowerCase();

    if (!domain) {
      energy = (energy ?? 0) + n;
      continue;
    }
    if (!DOMAINS.includes(domain)) {
      return { error: `dominio desconocido: "${domain}" (los que hay son ${DOMAINS.join(', ')})` };
    }
    power[domain] = (power[domain] ?? 0) + n;
  }

  // Solo poder, sin numero suelto: la energia es cero de verdad, no un "no se".
  return { energy: energy ?? 0, power };
}

/**
 * @param {string} text  lo que el usuario pego
 * @param {object} o
 * @param {string} [o.name]  nombre del mazo si la lista no trae encabezado
 * @returns {{
 *   deck: { id: string, name: string, domains: string[], cards: {cardId: string, qty: number}[] },
 *   cards: object[],
 *   needsCost: string[],
 *   errors: { line: number, text: string, reason: string }[]
 * }}
 */
export function parseDecklist(text, { name } = {}) {
  if (typeof text !== 'string') {
    throw new TypeError(`parseDecklist espera un string, recibi: ${typeof text}`);
  }

  const errors = [];
  const byId = new Map();
  let deckName = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || COMMENT.test(trimmed)) return;

    const header = HEADER.exec(trimmed);
    if (header) {
      if (deckName === null && header[1].trim()) deckName = header[1].trim();
      return;
    }

    const fail = (reason) => errors.push({ line, text: trimmed, reason });

    const [left, ...costParts] = trimmed.split('|');
    const { qty, name: cardName } = splitQty(left.trim());

    if (!cardName || /^\d+$/.test(cardName)) {
      return fail('la linea no dice que carta es');
    }
    if (!Number.isInteger(qty) || qty < 1) {
      return fail(`la cantidad tiene que ser 1 o mas, y dice ${qty}`);
    }

    let cost = null;
    if (costParts.length) {
      const parsed = parseCost(costParts.join('|').trim());
      if (parsed.error) return fail(parsed.error);
      cost = parsed;
    }

    const id = slug(cardName);
    const existing = byId.get(id);

    if (existing) {
      // La misma carta escrita dos veces suma copias. Y si una de las dos trae
      // el costo, ese costo vale: saber es mejor que no saber.
      existing.qty += qty;
      if (cost && existing.needsCost) {
        existing.energy = cost.energy;
        existing.power = cost.power;
        existing.needsCost = false;
        existing.domain = Object.keys(cost.power)[0] ?? null;
      }
      return;
    }

    byId.set(id, {
      id,
      name: cardName,
      qty,
      energy: cost ? cost.energy : null,
      power: cost ? cost.power : {},
      needsCost: !cost,
      domain: cost ? (Object.keys(cost.power)[0] ?? null) : null,
      type: null,
      text: '',
      img: null,
      source: 'pasted',
    });
  });

  const cards = [...byId.values()];

  const domains = [...new Set(cards.flatMap((c) => Object.keys(c.power)))].sort();
  const finalName = deckName ?? name ?? 'Mazo pegado';

  return {
    deck: {
      id: slug(finalName) || 'mazo-pegado',
      name: finalName,
      domains,
      cards: cards.map((c) => ({ cardId: c.id, qty: c.qty })),
    },
    cards,
    needsCost: cards.filter((c) => c.needsCost).map((c) => c.id),
    errors,
  };
}
