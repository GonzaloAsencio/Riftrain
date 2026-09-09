/**
 * Coincidencia de nombres de carta.
 *
 * Nivel 3 (autocompletado) usa `search`. Nivel 4 (evocacion en frio, sin ayuda)
 * usa `resolve` al confirmar: escribo de memoria, y si le pegue cerca cuenta.
 *
 * Si el nivel 4 exigiera el nombre exacto letra por letra, estaria entrenando
 * ortografia en vez de memoria. Pero si fuera demasiado permisivo, cualquier
 * cosa acertaria. El umbral esta calibrado para aceptar un typo o dos en un
 * nombre largo, y ser estricto en los cortos.
 */

/** Sin acentos, sin puntuacion, minusculas, espacios normalizados. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de Levenshtein, dos filas. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Cuantos typos se le perdonan a un nombre de largo n. */
export function tolerance(n) {
  if (n <= 4) return 0;   // nombres cortos: exacto
  if (n <= 7) return 1;
  if (n <= 12) return 2;
  return 3;
}

/**
 * Puntaje de 0 a 1 de que `query` refiera a `name`. 0 = no coincide.
 * Se prioriza: exacto > prefijo > prefijo de palabra > difuso.
 */
export function score(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q) return 0;
  if (q === n) return 1;

  if (n.startsWith(q)) return 0.9 - Math.min(0.2, (n.length - q.length) / 100);

  const words = n.split(' ');
  if (words.some((w) => w.startsWith(q))) return 0.75;
  if (n.includes(q) && q.length >= 3) return 0.6;

  const d = levenshtein(q, n);
  if (d <= tolerance(n.length)) return 0.55 - d * 0.05;

  // Ultimo recurso: le pego a una palabra sola de un nombre compuesto.
  for (const w of words) {
    if (w.length < 4) continue;
    if (levenshtein(q, w) <= tolerance(w.length)) return 0.45;
  }
  return 0;
}

/** Autocompletado (nivel 3): las mejores coincidencias, ordenadas. */
export function search(query, cards, { limit = 8, min = 0.3 } = {}) {
  if (!normalize(query)) return [];
  return cards
    .map((card) => ({ card, s: score(query, card.name) }))
    .filter((r) => r.s >= min)
    .sort((a, b) => b.s - a.s || a.card.name.localeCompare(b.card.name))
    .slice(0, limit)
    .map((r) => r.card);
}

/**
 * Evocacion en frio (nivel 4): resuelve un texto libre a UNA carta, o a nada.
 * Exige que la mejor gane con claridad: si dos cartas empatan, es ambiguo y
 * no resolvemos - mejor pedir que lo escriba mejor que acreditarle la equivocada.
 */
export function resolve(query, cards, { min = 0.45, margin = 0.08 } = {}) {
  const ranked = cards
    .map((card) => ({ card, s: score(query, card.name) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!ranked.length || ranked[0].s < min) return { card: null, reason: 'no-match' };
  if (ranked[1] && ranked[0].s - ranked[1].s < margin && ranked[0].s < 1) {
    return { card: null, reason: 'ambiguous', candidates: ranked.slice(0, 3).map((r) => r.card) };
  }
  return { card: ranked[0].card, reason: 'ok', score: ranked[0].s };
}
