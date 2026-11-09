/**
 * Codigos de mazo de Piltover Archive. PURO: no sabe que existe la red ni un input.
 *
 * El formato es el de los deck codes de Legends of Runeterra adaptado a Riftbound:
 * bytes en base32 (RFC 4648, sin padding). El primer byte es formato (4 bits) y
 * version (4 bits); despues, grupos por cantidad de copias -> listas por set y
 * variante -> numeros de carta. Las cantidades y los numeros son varints LEB128;
 * el set, la variante y los flags de prefijo son bytes sueltos.
 *
 *   v1 mazo principal           v4 flag de runa (R) antes de cada numero
 *   v2 + sideboard (3, 2, 1)    v5 bit de prefijo de mazo, conteos dispersos, SP
 *   v3 + campeon elegido        v6 + leyendas adicionales
 *
 * La especificacion es la de @piltoverarchive/riftbound-deck-codes 1.5.0. Lo que no
 * se conoce (un set, una variante, un prefijo, una version futura) se RECHAZA con su
 * motivo: caer en la carta base seria entrenar contra una mano que no es.
 */

const FORMAT = 1;
const MAX_VERSION = 6;
const SETS = ['OGN', 'OGS', 'ARC', 'SFD', 'UNL', 'VEN', 'RAD'];
const VARIANTS = ['', 'a', 's', 'b'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

class Malformed extends Error {}

function base32(text) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Malformed(`Eso no parece un código de mazo: tiene un carácter que no va ('${char}')`);
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); }
  }
  return bytes;
}

/** Lector secuencial: cada lectura avanza; quedarse sin bytes es un codigo truncado. */
function reader(bytes) {
  let at = 0;
  const byte = () => {
    if (at >= bytes.length) throw new Malformed('El código está incompleto: se cortó antes de terminar');
    return bytes[at++];
  };
  const varint = () => {
    let result = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = byte();
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
    }
    throw new Malformed('El código tiene un número demasiado largo');
  };
  return { byte, varint };
}

const setOf = (id) => {
  if (!(id in SETS)) throw new Malformed(`El código nombra un set desconocido (${id})`);
  return SETS[id];
};
const variantOf = (id) => {
  if (!(id in VARIANTS)) throw new Malformed(`El código nombra una variante desconocida (${id})`);
  return VARIANTS[id];
};

/** Numero de carta con su prefijo: sin flag (v1-v3), o 0x00 normal, 0x01 runa, 0x02 especial. */
function cardNumber(read, flagged) {
  if (!flagged) return String(read.varint()).padStart(3, '0');
  const flag = read.byte();
  const n = read.varint();
  if (flag === 0x00) return String(n).padStart(3, '0');
  if (flag === 0x01) return `R${String(n).padStart(2, '0')}`;
  if (flag === 0x02) return `SP${n}`;
  throw new Malformed(`El código usa un prefijo de número desconocido (${flag})`);
}

function group(read, count, flagged, out) {
  if (count < 1) throw new Malformed('El código trae una carta con 0 copias');
  const cards = read.varint();
  const set = setOf(read.byte());
  const variant = variantOf(read.byte());
  for (let i = 0; i < cards; i++) out.push({ code: `${set}-${cardNumber(read, flagged)}${variant}`, count });
}

/** v1-v4: se recorre cada cantidad de max a 1, aunque no haya cartas con esa cantidad. */
function denseSection(read, max, flagged) {
  const out = [];
  for (let count = max; count >= 1; count--) {
    const groups = read.varint();
    for (let g = 0; g < groups; g++) group(read, count, flagged, out);
  }
  return out;
}

/** v5+: solo las cantidades que aparecen, de mayor a menor. */
function sparseSection(read, flagged) {
  const out = [];
  const counts = read.varint();
  for (let c = 0; c < counts; c++) {
    const count = read.varint();
    const groups = read.varint();
    for (let g = 0; g < groups; g++) group(read, count, flagged, out);
  }
  return out;
}

function cardRef(read, flagged) {
  const set = setOf(read.byte());
  const variant = variantOf(read.byte());
  return `${set}-${cardNumber(read, flagged)}${variant}`;
}

/**
 * @returns {{ok: true, format, version, main: {code, count}[], sideboard: {code, count}[],
 *            champion: string|null, legends: string[]|null} | {ok: false, reason: string}}
 */
export function decodeDeckCode(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'El código de mazo tiene que ser texto' };
  // Solo letras ASCII a mayúsculas: toUpperCase() convierte 'ß' en 'SS', que es base32 valido.
  const text = input.replace(/\s+/g, '').replace(/=+$/, '').replace(/[a-z]/g, (c) => c.toUpperCase());
  if (!text) return { ok: false, reason: 'Pegá un código de mazo para leerlo' };
  try {
    const read = reader(base32(text));
    const header = read.byte();
    const format = header >> 4;
    const version = header & 0x0f;
    if (format !== FORMAT) throw new Malformed(`Formato de código desconocido (${format}): no es un código de Riftbound`);
    if (version < 1 || version > MAX_VERSION) {
      throw new Malformed(`El código es de la versión ${version} y esta app lee hasta la ${MAX_VERSION}`);
    }
    let flagged = version >= 4;
    if (version >= 5) {
      const prefix = read.byte();
      if (prefix > 1) throw new Malformed(`El código tiene un bit de prefijo inválido (${prefix})`);
      flagged = prefix === 1;
    }
    const main = version >= 5 ? sparseSection(read, flagged) : denseSection(read, 12, flagged);
    const sideboard = version >= 5 ? sparseSection(read, flagged) : version >= 2 ? denseSection(read, 3, flagged) : [];
    let champion = null;
    if (version >= 3 && read.byte() === 0x01) champion = cardRef(read, flagged);
    let legends = null;
    if (version >= 6) {
      legends = [];
      const n = read.varint();
      for (let i = 0; i < n; i++) legends.push(cardRef(read, flagged));
    }
    return { ok: true, format, version, main, sideboard, champion, legends };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, reason: error.message };
    throw error;
  }
}

/** "OGN-119a" -> "OGN-119": la impresion base, como la guarda el catalogo en `printings`. */
const basePrinting = (code) => code.replace(/[abs*]$/, '');

/**
 * Codigo decodificado + catalogo -> el mazo con la forma que consume el motor (normalizeDeck).
 * La leyenda inicial va en el mazo principal; el campeon elegido es una ETIQUETA sobre una carta
 * del mazo principal (CHANGELOG de la referencia, v3), asi que esa copia sale del mazo repartible.
 * Runas -> runes por dominio; battlefields fuera (no se roban).
 *
 * @returns {{ok: true, deck, cards} | {ok: false, reason: string, missing?: {code, qty, reason}[]}}
 */
export function resolveDeckCode(decoded, catalogCards) {
  if (!decoded?.ok) return { ok: false, reason: decoded?.reason ?? 'Código de mazo inválido' };
  const byPrinting = new Map();
  for (const card of catalogCards ?? []) for (const p of card.printings ?? []) byPrinting.set(p, card);
  const find = (code) => byPrinting.get(basePrinting(code));

  const missing = [];
  for (const { code, count } of decoded.main) {
    if (!find(code)) missing.push({ code, qty: count, reason: `${code} no está en el catálogo: actualizalo con tools/fetch-cards.mjs` });
  }
  const championCard = decoded.champion ? find(decoded.champion) : null;
  if (decoded.champion && !championCard) {
    missing.push({ code: decoded.champion, qty: 1, reason: `El campeón ${decoded.champion} no está en el catálogo` });
  }
  if (missing.length) return { ok: false, reason: `Faltan ${missing.length} cartas en el catálogo`, missing };

  // La leyenda inicial va en el mazo principal. Las adicionales (v6, decoded.legends) viajan
  // aparte y NO se entrenan: el rival muestra una sola leyenda en la mesa.
  const legends = [];
  const runes = {};
  const qty = new Map();
  for (const { code, count } of decoded.main) {
    const card = find(code);
    if (card.type === 'legend') { if (!legends.includes(card)) legends.push(card); continue; }
    if (card.type === 'rune') {
      if (!card.domain) return { ok: false, reason: `La runa ${code} no tiene dominio en el catálogo` };
      runes[card.domain] = (runes[card.domain] ?? 0) + count;
      continue;
    }
    if (card.type === 'battlefield') continue;
    qty.set(card.id, (qty.get(card.id) ?? 0) + count);
  }
  if (legends.length > 1) {
    return { ok: false, reason: `El mazo principal trae ${legends.length} leyendas y no se sabe cuál es la inicial` };
  }
  const legend = legends[0] ?? null;
  if (championCard) {
    if (championCard.type === 'legend' || !qty.has(championCard.id)) {
      return { ok: false, reason: `El campeón ${decoded.champion} tiene que ser una carta del mazo principal` };
    }
    const left = qty.get(championCard.id) - 1;
    if (left > 0) qty.set(championCard.id, left); else qty.delete(championCard.id);
  }

  const runeTotal = Object.values(runes).reduce((a, b) => a + b, 0);
  if (runeTotal !== 12) return { ok: false, reason: `El Mazo de Runas tiene que tener 12 runas y este código trae ${runeTotal}` };
  if (!legend) return { ok: false, reason: 'El código no trae una leyenda' };

  const cards = [...qty].map(([cardId, n]) => ({ cardId, qty: n }));
  const byId = new Map(catalogCards.map((c) => [c.id, c]));
  const used = new Set([legend.id, championCard?.id, ...cards.map((c) => c.cardId)].filter(Boolean));
  const deck = {
    id: `code-${legend.id}`,
    name: legend.name,
    domains: Object.keys(runes).sort(),
    legend: legend.id,
    champion: championCard?.id ?? null,
    runes,
    cards,
  };
  return { ok: true, deck, cards: [...used].map((id) => byId.get(id)) };
}
