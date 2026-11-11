/** Recall index: main deck plus the chosen champion (playable from its zone); other zones are out. */
import { DOMAINS } from './runes.js';
import { canPay, availableRunes, cardCost } from './cost.js';

const fail = (reason) => ({ ok: false, reason });
const quantity = (n) => Number.isSafeInteger(n) && n > 0;
const plainPower = (power) => power && typeof power === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(power));
// Poder de dos dominios: cada punto se paga con una runa de cualquiera de ellos (ver cost.js).
const validPowerAny = (any) => any === undefined || (any !== null && typeof any === 'object' &&
  Number.isSafeInteger(any.amount) && any.amount > 0 && Array.isArray(any.domains) && any.domains.length >= 2 &&
  new Set(any.domains).size === any.domains.length && any.domains.every((d) => DOMAINS.includes(d)));
const validCost = (card) => Number.isSafeInteger(card?.energy) && card.energy >= 0 &&
  plainPower(card.power) && Object.entries(card.power).every(([d, n]) =>
    DOMAINS.includes(d) && Number.isSafeInteger(n) && n >= 0) && validPowerAny(card.powerAny);
const validIndex = (index) => Array.isArray(index?.cards) && index.byId instanceof Map &&
  (index.cards.length > 0 || (index.policy === 'positive-energy' && index.fullCards?.length > 0)) &&
  index.byId.size === index.cards.length &&
  new Set(index.cards.map((card) => card.id)).size === index.cards.length &&
  index.cards.every((card) => quantity(card.qty) &&
    validCost(card) && index.byId.get(card.id) === card) &&
  (index.policy !== 'positive-energy' || (Array.isArray(index.fullCards) &&
    index.excludedEnergyZero instanceof Map &&
    index.fullCards.every((card) => quantity(card.qty) && validCost(card) &&
      (card.energy === 0 ? index.excludedEnergyZero.get(card.id) === card : index.byId.get(card.id) === card)) &&
    index.fullCards.length === index.cards.length + index.excludedEnergyZero.size));

export function normalizeDeck(deck, cards, { policy = 'all' } = {}) {
  if (!['all', 'positive-energy'].includes(policy)) return fail('Política de mazo desconocida');
  if (!Array.isArray(deck?.cards) || !deck.cards.length || !Array.isArray(cards)) {
    return fail('Falta el mazo principal o el catálogo de cartas');
  }
  const catalog = new Map();
  for (const card of cards) {
    if (typeof card?.id !== 'string' || !card.id) return fail('Carta del catálogo sin ID');
    if (catalog.has(card.id)) return fail(`ID duplicado en catálogo: ${card.id}`);
    catalog.set(card.id, card);
  }
  const byId = new Map();
  // El campeón no se roba: se juega desde su zona, así que siempre está disponible. Entra como una
  // copia más; si el main ya tiene copias suyas, se fusiona por id.
  const entries = [...deck.cards, ...(deck.champion ? [{ cardId: deck.champion, qty: 1, champion: true }] : [])];
  for (const entry of entries) {
    const id = entry?.cardId;
    const card = catalog.get(id);
    if (!card) return fail(entry?.champion ? `Campeón desconocido: ${String(id)}` : `ID de carta desconocido: ${String(id)}`);
    if (!quantity(entry.qty)) return fail(`Cantidad inválida para ${id}: ${String(entry.qty)}`);
    if (card.needsCost === true || !plainPower(card.power) ||
        !Number.isSafeInteger(card.energy) || card.energy < 0) {
      return fail(entry.champion ? `Coste desconocido o inválido para el campeón ${id}` : `Coste desconocido o inválido para ${id}`);
    }
    for (const [domain, n] of Object.entries(card.power)) {
      if (!DOMAINS.includes(domain) || !Number.isSafeInteger(n) || n < 0) {
        return fail(`Poder o dominio inválido para ${id}: ${domain}`);
      }
    }
    if (!validPowerAny(card.powerAny)) return fail(`Poder de dos dominios inválido para ${id}`);
    const qty = (byId.get(id)?.qty ?? 0) + entry.qty;
    if (!Number.isSafeInteger(qty)) return fail(`Cantidad inválida para ${id}: desborde`);
    byId.set(id, { id, qty, energy: card.energy, power: { ...card.power },
      ...(card.powerAny ? { powerAny: { amount: card.powerAny.amount, domains: [...card.powerAny.domains].sort() } } : {}) });
  }
  const normalized = [...byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (policy === 'positive-energy') {
    const included = normalized.filter((card) => card.energy > 0);
    const excluded = normalized.filter((card) => card.energy === 0);
    return { ok: true, index: { policy, cards: included,
      byId: new Map(included.map((card) => [card.id, card])),
      fullCards: normalized, excludedEnergyZero: new Map(excluded.map((card) => [card.id, card])) } };
  }
  return { ok: true, index: { cards: normalized, byId: new Map(normalized.map((c) => [c.id, c])) } };
}

function budget(runes) {
  if (!Array.isArray(runes) || runes.length > 12 ||
      runes.some((r) => !DOMAINS.includes(r?.domain) || typeof r.ready !== 'boolean')) {
    return fail('Estado de runas inválido');
  }
  return { ok: true, available: availableRunes(runes) };
}

/**
 * Puede el rival pagar ESTA carta sola con las runas del escenario?
 * Devuelve siempre el motivo; `detail` es el de canPay y es null cuando el rechazo
 * es previo a la pagabilidad (id vacio, fuera del mazo, Energia 0, runas invalidas).
 */
export function checkCard(cardId, scenario, index) {
  const reject = (reason) => ({ ok: false, cardId, cost: null, reason, detail: null });
  if (!(index?.byId instanceof Map)) return reject('Índice de mazo inválido');
  if (typeof cardId !== 'string' || !cardId) return reject('Falta el nombre de la carta');
  const card = index.byId.get(cardId);
  if (!card) {
    return reject(index.excludedEnergyZero?.has(cardId)
      ? 'Las cartas de Energía 0 no cuentan en este entrenamiento'
      : `La carta ${cardId} no está en el mazo principal`);
  }
  if (!validCost(card)) return reject(`Coste desconocido o inválido para ${cardId}`);
  const resources = budget(scenario?.runes);
  if (!resources.ok) return reject(resources.reason);
  const cost = cardCost(card);
  const check = canPay(cost, resources.available);
  return { ok: check.ok, cardId, cost, reason: check.reason, detail: check.detail };
}

/**
 * Cartas DISTINTAS del mazo principal que el rival paga solas con estas runas, en el
 * orden del indice. Las copias no cuentan y la Energia 0 queda fuera del indice.
 * Sincrono: son a lo sumo ~21 llamadas a checkCard, no hace falta contar combinaciones.
 */
export function payableCards(index, scenario) {
  if (!validIndex(index)) return fail('Índice de mazo inválido');
  const resources = budget(scenario?.runes);
  if (!resources.ok) return resources;
  return { ok: true, cardIds: index.cards.filter(({ id }) => checkCard(id, scenario, index).ok).map(({ id }) => id) };
}
