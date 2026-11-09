/**
 * El festejo de fin de nivel: un cartel y confetti. Es lo unico que celebra en toda la ronda
 * (cada acierto se ve en la carta que se da vuelta); aparece una vez, cuando el motor cierra completo.
 * Capa fija sobre la ventana: no toca la grilla, no recibe clics y recorta lo que cae (sin scroll).
 */
const HUES = [45, 280, 200, 340, 140];   // oro, violeta, celeste, rosa, verde

export function mountCelebration(root, { reducedMotion = false, pieces = 36 } = {}) {
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

  /** Posicion, color y giro salen del indice: mismo festejo siempre, sin azar ni reloj. */
  function piece(i) {
    const item = document.createElement('span');
    item.className = 'celebration__piece';
    item.style.setProperty('--x', `${((i * 37) % 100)}%`);
    item.style.setProperty('--delay', `${(i % 9) * 70}ms`);
    item.style.setProperty('--hue', String(HUES[i % HUES.length]));
    item.style.setProperty('--spin', `${(i % 2 ? 1 : -1) * (360 + (i * 53) % 540)}deg`);
    item.style.setProperty('--drift', `${((i * 29) % 80) - 40}px`);
    return item;
  }

  return {
    show(text) {
      hide();
      banner.textContent = text;
      banner.hidden = false;
      layer.hidden = false;
      if (reducedMotion) return;
      const items = Array.from({ length: pieces }, (_, i) => piece(i));
      confetti.append(...items);
      // Cuando cae la ultima, el confetti se va solo. El cartel se desvanece por CSS a los 2.6s;
      // lo que queda fijo es el mensaje de estado de la pantalla.
      items.at(-1)?.addEventListener('animationend', () => confetti.replaceChildren(), { once: true });
    },
    hide,
    destroy() { layer.remove(); },
  };
}
