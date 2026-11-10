/**
 * Fisica del confetti del festejo, sin DOM: se testea en Node. Dos cañones en las esquinas de abajo
 * disparan papelitos en diagonal hacia el centro; el aire los frena, la gravedad los baja, se
 * balancean y se desvanecen. Un paso = un cuadro (~1/60 s). El azar se inyecta (rand): mismo
 * generador, mismo festejo. Los colores son los de las seis runas.
 */
import { DOMAIN_COLOR } from '../engine/runes.js';

const COLORS = Object.values(DOMAIN_COLOR);
const DRAG = 0.92;      // lo que conserva la velocidad por cuadro (el aire)
const GRAVITY = 0.005;  // en fracciones de la velocidad inicial maxima: escala con la pantalla
const LIFE = 260;       // cuadros hasta desaparecer
const PER_CANNON = 130;

/** Papelitos recien disparados. `rand` devuelve [0, 1). */
export function spawnConfetti({ width, height, rand, count = PER_CANNON }) {
  // Velocidad proporcional al alto: en cualquier pantalla llegan hasta arriba.
  const speed = height * 0.13;
  const pieces = [];
  for (const side of [0, 1]) {
    for (let i = 0; i < count; i++) {
      // Izquierda apunta a 55° (arriba-derecha), derecha a 125° (arriba-izquierda), con ±35° de abanico.
      const deg = (side ? 125 : 55) + (rand() - 0.5) * 70;
      const angle = (deg * Math.PI) / 180;
      const v = speed * (0.3 + rand() * 0.7);   // unos quedan cerca, otros cruzan la pantalla
      pieces.push({
        x: side ? width : 0,
        y: height,
        vx: Math.cos(angle) * v,
        vy: -Math.sin(angle) * v,
        gravity: speed * GRAVITY,
        size: 10 + rand() * 8,
        color: COLORS[(side * 3 + i) % COLORS.length],
        wobble: rand() * Math.PI * 2,
        wobbleSpeed: 0.08 + rand() * 0.12,
        spin: (rand() - 0.5) * 0.3,
        rotation: rand() * Math.PI * 2,
        age: 0,
        life: LIFE - Math.floor(rand() * 60),
        opacity: 1,
      });
    }
  }
  return pieces;
}

/** Un cuadro mas. Devuelve un arreglo nuevo, sin los que ya se desvanecieron; no muta la entrada. */
export function stepConfetti(pieces) {
  const next = [];
  for (const p of pieces) {
    const age = p.age + 1;
    if (age >= p.life) continue;
    const vx = p.vx * DRAG;
    const vy = p.vy * DRAG + p.gravity;
    const wobble = p.wobble + p.wobbleSpeed;
    next.push({
      ...p,
      // El balanceo lo corre de costado, como un papel que cae planeando.
      x: p.x + vx + Math.cos(wobble) * 0.6,
      y: p.y + vy,
      vx,
      vy,
      wobble,
      rotation: p.rotation + p.spin,
      age,
      opacity: Math.min(1, (p.life - age) / 50),
    });
  }
  return next;
}
