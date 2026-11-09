/**
 * El festejo de fin de nivel: un cartel y confetti. Es lo unico que celebra en toda la ronda
 * (cada acierto se ve en la carta que se da vuelta); aparece una vez, cuando el motor cierra completo.
 * Capa fija sobre la ventana: no toca la grilla, no recibe clics y recorta lo que cae (sin scroll).
 */
const HUES = [45, 280, 200, 340, 140];   // oro, violeta, celeste, rosa, verde
// Fuegos artificiales: centros de estallido (en % de la pantalla), lejos del cartel y de la mano.
const BURSTS = [[18, 30], [82, 26], [30, 70], [72, 66], [88, 50]];
const SPARKS = 12;                       // chispas por estallido, en circulo

export function mountCelebration(root, { reducedMotion = false } = {}) {
  const layer = document.createElement('div');
  layer.className = reducedMotion ? 'celebration celebration--reduced' : 'celebration';
  layer.hidden = true;
  const banner = document.createElement('p');
  banner.className = 'celebration__banner';
  // El anuncio accesible lo hace el mensaje de estado de la pantalla: el cartel no se lee dos veces.
  banner.setAttribute('aria-hidden', 'true');
  banner.hidden = true;
  const confetti = document.createElement('div');
  confetti.className = 'celebration__confetti';
  layer.append(confetti, banner);
  root.appendChild(layer);

  function hide() {
    layer.hidden = true;
    banner.hidden = true;
    confetti.replaceChildren();
  }

  /**
   * Una chispa del estallido b: sale del centro y se abre en circulo, a distancias alternadas.
   * Todo sale del indice: mismo festejo siempre, sin azar ni reloj.
   */
  function spark(b, j) {
    const [x, y] = BURSTS[b];
    const angle = (2 * Math.PI * j) / SPARKS + b * 0.3;
    // En pantallas angostas el estallido se achica: en 320 px no se corta contra el borde.
    const scale = Math.min(1, (globalThis.innerWidth || 1280) / 900);
    const reach = Math.round((70 + (j % 3) * 28) * Math.max(scale, 0.45));
    const item = document.createElement('span');
    item.className = 'celebration__piece';
    item.style.setProperty('--x', `${x}%`);
    item.style.setProperty('--y', `${y}%`);
    item.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
    item.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach)}px`);
    item.style.setProperty('--delay', `${b * 220}ms`);
    item.style.setProperty('--hue', String(HUES[b % HUES.length]));
    return item;
  }

  return {
    show(text) {
      hide();
      banner.textContent = text;
      banner.hidden = false;
      layer.hidden = false;
      if (reducedMotion) return;
      const items = BURSTS.flatMap((_, b) => Array.from({ length: SPARKS }, (__, j) => spark(b, j)));
      confetti.append(...items);
      // Cuando cae la ultima, el confetti se va solo. El cartel se desvanece por CSS a los 2.6s;
      // lo que queda fijo es el mensaje de estado de la pantalla.
      items.at(-1)?.addEventListener('animationend', () => confetti.replaceChildren(), { once: true });
    },
    hide,
    destroy() { layer.remove(); },
  };
}
