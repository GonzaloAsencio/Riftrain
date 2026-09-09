/**
 * Progresion: dificultad adaptativa, cola de repaso y estadisticas.
 * Logica pura, sin DOM y sin localStorage: recibe y devuelve estado.
 * Asi se puede testear la regla de subir/bajar de nivel sin abrir un navegador.
 */

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 4;

/** Ventana y umbrales: los numeros son los que fijo el usuario, tal cual. */
export const WINDOW = 6;
export const UP_AT = 0.84;
export const DOWN_AT = 0.34;

/** Uno de cada N escenarios es un repaso de algo que falle. */
export const REVIEW_EVERY = 4;

export function emptyState() {
  return {
    level: 1,
    streak: 0,
    bestStreak: 0,
    window: [],          // ultimas WINDOW precisiones (0..1)
    reviewQueue: [],     // seeds de escenarios fallados
    answered: 0,
    history: [],         // resumen por respuesta, para las estadisticas
    missedCards: {},     // cardId -> veces que NO la vi
    falsePositives: {},  // cardId -> veces que la esperaba y no estaba
  };
}

/**
 * Precision de UNA respuesta del modo revelado.
 * No es binaria: nombrar 3 de 5 no es lo mismo que nombrar 0.
 * Los falsos positivos restan, porque anticipar una amenaza que no existe
 * tambien es un error - pero restan la mitad, para no anular el acierto real.
 */
export function accuracyOf({ hits, expected, falsePositives = 0 }) {
  if (expected <= 0) return falsePositives > 0 ? 0 : 1;
  const raw = (hits - falsePositives * 0.5) / expected;
  return Math.max(0, Math.min(1, raw));
}

/** Una respuesta cuenta para la racha solo si fue PERFECTA. */
export function isPerfect({ hits, expected, falsePositives = 0 }) {
  return hits === expected && falsePositives === 0;
}

/**
 * Ajuste de nivel sobre la ventana movil.
 * Solo se evalua con la ventana llena: con 2 respuestas no se sabe nada.
 */
export function nextLevel(level, windowArr) {
  if (windowArr.length < WINDOW) return level;
  const avg = windowArr.reduce((a, b) => a + b, 0) / windowArr.length;
  if (avg >= UP_AT) return Math.min(LEVEL_MAX, level + 1);
  if (avg < DOWN_AT) return Math.max(LEVEL_MIN, level - 1);
  return level;
}

/**
 * Registra una respuesta y devuelve el estado NUEVO (no muta el anterior).
 *
 * @param {object} state
 * @param {object} result { seed, question, deckId, turn, hits, expected,
 *                          falsePositives, missedIds, falsePositiveIds, ms }
 */
export function record(state, result) {
  const acc = accuracyOf(result);
  const perfect = isPerfect(result);

  const window = [...state.window, acc].slice(-WINDOW);
  const levelBefore = state.level;
  const level = nextLevel(levelBefore, window);
  // Al cambiar de nivel la ventana se vacia: si no, el nivel oscila solo.
  const windowAfter = level === levelBefore ? window : [];

  const streak = perfect ? state.streak + 1 : 0;

  // Cola de repaso: entra el seed si falle; sale si lo acerte perfecto.
  let reviewQueue = state.reviewQueue.filter((s) => s !== result.seed);
  if (!perfect) reviewQueue = [...reviewQueue, result.seed];

  const missedCards = { ...state.missedCards };
  for (const id of result.missedIds ?? []) missedCards[id] = (missedCards[id] ?? 0) + 1;

  const falsePositives = { ...state.falsePositives };
  for (const id of result.falsePositiveIds ?? []) falsePositives[id] = (falsePositives[id] ?? 0) + 1;

  return {
    ...state,
    level,
    window: windowAfter,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    reviewQueue,
    answered: state.answered + 1,
    missedCards,
    falsePositives,
    history: [
      ...state.history,
      {
        seed: result.seed, question: result.question, deckId: result.deckId,
        turn: result.turn, acc, perfect, ms: result.ms ?? null,
        levelBefore, levelAfter: level,
      },
    ].slice(-500),
  };
}

/** Toca repaso? Uno de cada REVIEW_EVERY, si hay algo en la cola. */
export function shouldReview(state) {
  return state.reviewQueue.length > 0 && state.answered % REVIEW_EVERY === REVIEW_EVERY - 1;
}

/** Proximo seed: el de la cola si toca repaso, si no uno nuevo. */
export function nextSeed(state, rand = Math.random) {
  if (shouldReview(state)) return { seed: state.reviewQueue[0], isReview: true };
  return { seed: Math.floor(rand() * 0xffffffff) >>> 0, isReview: false };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function groupAccuracy(history, key) {
  const buckets = {};
  for (const h of history) {
    const k = h[key];
    (buckets[k] ??= []).push(h.acc);
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([k, xs]) => [k, { acc: mean(xs), n: xs.length }])
  );
}

/** Horizonte de turnos, agrupado: los turnos tempranos y los tardios se leen distinto. */
function turnBuckets(history) {
  const label = (t) => (t <= 4 ? 'T3-4' : t <= 6 ? 'T5-6' : 'T7+');
  const buckets = {};
  for (const h of history) (buckets[label(h.turn)] ??= []).push(h.acc);
  return Object.fromEntries(
    Object.entries(buckets).map(([k, xs]) => [k, { acc: mean(xs), n: xs.length }])
  );
}

/**
 * Estadisticas + deteccion automatica del punto debil.
 * El punto debil es el grupo con peor precision entre los que tienen muestra
 * suficiente: con 2 respuestas no se declara una debilidad.
 */
export function stats(state, { minSample = 4 } = {}) {
  const h = state.history;
  const byQuestion = groupAccuracy(h, 'question');
  const byDeck = groupAccuracy(h, 'deckId');
  const byTurn = turnBuckets(h);

  const candidates = [
    ...Object.entries(byQuestion).map(([k, v]) => ({ dim: 'pregunta', key: k, ...v })),
    ...Object.entries(byDeck).map(([k, v]) => ({ dim: 'mazo', key: k, ...v })),
    ...Object.entries(byTurn).map(([k, v]) => ({ dim: 'turno', key: k, ...v })),
  ].filter((c) => c.n >= minSample);

  candidates.sort((a, b) => a.acc - b.acc);

  const times = h.map((x) => x.ms).filter((x) => typeof x === 'number');
  const topN = (obj, n = 5) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, count]) => ({ id, count }));

  return {
    answered: state.answered,
    accuracy: mean(h.map((x) => x.acc)),
    perfectRate: h.length ? h.filter((x) => x.perfect).length / h.length : 0,
    bestStreak: state.bestStreak,
    level: state.level,
    medianMs: times.length ? [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] : null,
    byQuestion, byDeck, byTurn,
    weakest: candidates[0] ?? null,
    reviewPending: state.reviewQueue.length,
    // Los dos errores se cuentan POR SEPARADO: no ver una amenaza y esperar una que no existe
    topMissed: topN(state.missedCards),
    topFalsePositives: topN(state.falsePositives),
  };
}
