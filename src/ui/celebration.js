/**
 * El festejo de fin de nivel: un cartel y confetti. Es lo unico que celebra en toda la ronda
 * (cada acierto se ve en la carta que se da vuelta); aparece una vez, cuando el motor cierra completo.
 * Capa fija sobre la ventana: no toca la grilla, no recibe clics y recorta lo que cae (sin scroll).
 * El confetti es un <canvas> a pantalla completa: dos cañones disparan papelitos de los seis colores
 * de runa desde las esquinas de abajo. La fisica vive en confetti.js (pura); aca solo se dibuja.
 */
import { mulberry32 } from '../engine/rng.js';
import { spawnConfetti, stepConfetti } from './confetti.js';

const SEED = 0x51f7;   // mismo festejo siempre: sin azar ni reloj

export function mountCelebration(root, { reducedMotion = false } = {}) {
  const layer = document.createElement('div');
  layer.className = reducedMotion ? 'celebration celebration--reduced' : 'celebration';
  layer.hidden = true;
  const banner = document.createElement('p');
  banner.className = 'celebration__banner';
  // El anuncio accesible lo hace el mensaje de estado de la pantalla: el cartel no se lee dos veces.
  banner.setAttribute('aria-hidden', 'true');
  banner.hidden = true;
  const canvas = document.createElement('canvas');
  canvas.className = 'celebration__confetti';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.pieces = '0';
  layer.append(canvas, banner);
  root.appendChild(layer);

  let pieces = [];
  let frame = 0;

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    pieces = [];
    canvas.dataset.pieces = '0';
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function hide() {
    stop();
    layer.hidden = true;
    banner.hidden = true;
  }

  /** Un papelito: un rectangulo que gira y se achata al balancearse (de frente / de canto). */
  function paint(ctx, p, dpr) {
    ctx.save();
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;
    ctx.translate(p.x * dpr, p.y * dpr);
    ctx.rotate(p.rotation);
    ctx.scale(1, Math.cos(p.wobble));
    const w = p.size * dpr;
    ctx.fillRect(-w / 2, -w * 0.3, w, w * 0.6);
    ctx.restore();
  }

  function tick() {
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) paint(ctx, p, dpr);
    pieces = stepConfetti(pieces);
    canvas.dataset.pieces = String(pieces.length);
    frame = pieces.length ? requestAnimationFrame(tick) : 0;
    if (!pieces.length) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return {
    show(text) {
      hide();
      banner.textContent = text;
      banner.hidden = false;
      layer.hidden = false;
      if (reducedMotion) return;
      // El canvas toma el tamaño de la ventana (en pixeles reales: nitido en pantallas densas).
      const width = layer.clientWidth || globalThis.innerWidth;
      const height = layer.clientHeight || globalThis.innerHeight;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      pieces = spawnConfetti({ width, height, rand: mulberry32(SEED) });
      canvas.dataset.pieces = String(pieces.length);
      frame = requestAnimationFrame(tick);
      // El cartel se desvanece por CSS a los 2.6s; lo que queda fijo es el mensaje de estado.
    },
    hide,
    destroy() { stop(); layer.remove(); },
  };
}
