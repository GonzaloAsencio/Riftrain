/**
 * PRNG determinista. Mismo seed -> misma secuencia, siempre.
 * mulberry32: 32 bits de estado, distribucion pareja, rapidisimo.
 * No usamos Math.random en NINGUN lado del motor: un escenario tiene que
 * poder repetirse exacto para la cola de repaso.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  const int = (maxExclusive) => Math.floor(next() * maxExclusive);
  const range = (min, maxInclusive) => min + int(maxInclusive - min + 1);
  const pick = (arr) => arr[int(arr.length)];
  const shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const chance = (p) => next() < p;
  return { next, int, range, pick, shuffle, chance };
}

/** Seed legible y estable para mostrar/compartir (base36, 6 chars). */
export function seedLabel(seed) {
  return (seed >>> 0).toString(36).padStart(6, '0').slice(-6).toUpperCase();
}
