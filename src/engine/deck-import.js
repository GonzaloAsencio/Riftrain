/**
 * Un solo campo para el mazo del rival. PURO: no sabe que existe un textarea.
 *
 * Acepta las dos cosas que exporta Piltover Archive:
 *   - el codigo de mazo (una sola tira base32): deck-code.js
 *   - la lista de texto ("Legend: / Champion: / MainDeck: / Runes: ..."): decklist.js + catalog.js
 * Los dos caminos terminan en la MISMA forma, con las mismas reglas: 12 runas, una leyenda, y
 * todas las cartas que faltan en el catalogo listadas (nunca solo la primera).
 *
 * Se hace en dos pasos porque el catalogo es pesado: prepareDeckInput() valida sin catalogo
 * (un codigo roto o una linea que no se entiende se avisan al toque) e importDeck() cruza.
 */
import { decodeDeckCode, resolveDeckCode } from './deck-code.js';
import { parseDecklist } from './decklist.js';
import { resolveDeck } from './catalog.js';

/** Una lista tiene saltos de linea o encabezados ("MainDeck:"); un codigo es una sola tira. */
export function looksLikeList(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return /\n/.test(trimmed) || /:/.test(trimmed);
}

/** @returns {{ok: true, kind: 'code'|'list', decoded?, parsed?} | {ok: false, reason: string}} */
export function prepareDeckInput(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'Pegá el código o la lista de texto del mazo' };
  if (!looksLikeList(text)) {
    const decoded = decodeDeckCode(text);
    return decoded.ok ? { ok: true, kind: 'code', decoded } : { ok: false, reason: decoded.reason };
  }
  const parsed = parseDecklist(text);
  if (parsed.errors.length) {
    const [first] = parsed.errors;
    const more = parsed.errors.length > 1 ? ` (y ${parsed.errors.length - 1} línea${parsed.errors.length > 2 ? 's' : ''} más)` : '';
    return { ok: false, reason: `No entiendo la línea ${first.line}: ${first.reason}${more}` };
  }
  if (!parsed.cards.length) return { ok: false, reason: 'La lista no trae cartas en el mazo principal' };
  return { ok: true, kind: 'list', parsed };
}

/**
 * @returns {{ok: true, deck, cards} | {ok: false, reason: string, missing?: {label, qty?, reason}[]}}
 *   deck tiene la forma que consume normalizeDeck: {id, name, domains, legend, champion, runes, cards}.
 */
export function importDeck(prepared, catalogCards) {
  if (!prepared?.ok) return { ok: false, reason: prepared?.reason ?? 'Mazo inválido' };
  if (prepared.kind === 'code') {
    const result = resolveDeckCode(prepared.decoded, catalogCards);
    if (result.ok) return result;
    return { ...result, ...(result.missing ? { missing: result.missing.map(({ code, qty, reason }) => ({ label: code, qty, reason })) } : {}) };
  }

  const { parsed } = prepared;
  const resolved = resolveDeck(parsed, catalogCards);
  if (resolved.missing.length) {
    const qtyOf = new Map(parsed.cards.map((c) => [c.name, c.qty]));
    return { ok: false, reason: `Faltan ${resolved.missing.length} cartas en el catálogo`,
      missing: resolved.missing.map(({ name, reason }) => ({ label: name, qty: qtyOf.get(name), reason })) };
  }
  const { legend, champion, runes = {} } = resolved.deck;
  const runeTotal = Object.values(runes).reduce((a, b) => a + b, 0);
  if (runeTotal !== 12) return { ok: false, reason: `El Mazo de Runas tiene que tener 12 runas y esta lista trae ${runeTotal}` };
  if (!legend) return { ok: false, reason: 'La lista no trae una leyenda (sección "Legend:")' };

  const byId = new Map();
  for (const card of [legend, champion, ...resolved.cards]) if (card) byId.set(card.id, card);
  const deck = {
    id: `list-${legend.id}`,
    name: legend.name,
    domains: Object.keys(runes).sort(),
    legend: legend.id,
    champion: champion?.id ?? null,
    runes,
    cards: resolved.deck.cards,
  };
  return { ok: true, deck, cards: [...byId.values()] };
}
