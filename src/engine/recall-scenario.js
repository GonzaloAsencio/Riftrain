/** Recall-specific deterministic snapshot; never reinterprets legacy scenario seeds. */
import { DOMAINS, RUNE_DECK_SIZE } from './runes.js';
import { makeRng } from './rng.js';

export const RECALL_VERSION = 2;
const fail = (reason) => ({ ok: false, reason });

function runeDeck(deck) {
  const metadata = deck?.runes;
  if (!metadata || typeof metadata !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(metadata))) return null;
  if (Object.keys(metadata).some((domain) => !DOMAINS.includes(domain))) return null;
  const expanded = [];
  for (const domain of DOMAINS) {
    const qty = Object.hasOwn(metadata, domain) ? metadata[domain] : 0;
    if (!Number.isSafeInteger(qty) || qty < 0) return null;
    for (let i = 0; i < qty && expanded.length <= RUNE_DECK_SIZE; i++) expanded.push(domain);
  }
  return expanded.length === RUNE_DECK_SIZE ? expanded : null;
}

/** Versioned, canonical data+resource identity, not the legacy PRNG/queue ID. */
export function recallIdentity(deck, index, seed, level, runes) {
  const main = (index.policy === 'positive-energy' ? index.fullCards : index.cards)
    .map(({ id, qty, energy, power }) => [id, qty, energy,
    Object.entries(power).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
  return JSON.stringify(['recall', RECALL_VERSION, 'rng-v1', 'floating-v1', seed, level,
    main, ...(index.policy === 'positive-energy' ? ['positive-energy-v1'] : []),
    DOMAINS.map((d) => [d, deck.runes[d] ?? 0]), runes.map(({ domain, ready }) => [domain, ready])]);
}

export function createRecallScenario(deck, index, seed, level) {
  const pool = runeDeck(deck);
  if (!pool) return fail('Datos del Mazo de Runas ausentes o inválidos (se requieren 12)');
  if (!Array.isArray(index?.cards) || !Array.isArray(deck?.cards)) return fail('Índice del mazo inválido');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isSafeInteger(level) || level < 1 || level > RUNE_DECK_SIZE) return fail('Seed o nivel inválido');
  const rng = makeRng((seed ^ Math.imul(level, 0x9e3779b9) ^ RECALL_VERSION) >>> 0);
  const shuffled = rng.shuffle(pool);
  const exhausted = rng.range(0, RUNE_DECK_SIZE - level);
  const runes = shuffled.slice(0, level + exhausted)
    .map((domain, i) => ({ domain, ready: i < level }));
  const scenario = { seed, level, runes, deckRemaining: RUNE_DECK_SIZE - runes.length };
  scenario.identity = recallIdentity(deck, index, seed, level, runes);
  return { ok: true, scenario };
}
