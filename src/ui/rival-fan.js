/**
 * La mano del rival en abanico: tantos dorsos como cartas puede pagar el rival en este nivel.
 * Los dorsos no tienen identidad: cada acierto da vuelta el PROXIMO, con la carta nombrada.
 * Al cerrar, los que quedaron muestran en gris las que se pasaron; los falsos positivos van
 * al costado. No calcula reglas: quien la monta le dice el tamaño y que mostrar.
 */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const MAX_SPREAD = 96;     // grados: mas abierto deja de leerse como una mano
const STEP = 4.4;          // grados por carta hasta llegar al maximo

/** Angulos del abanico, simetricos y crecientes. Puro: sin DOM. */
export function fanAngles(n) {
  if (!Number.isSafeInteger(n) || n <= 0) return [];
  if (n === 1) return [0];
  const spread = Math.min(MAX_SPREAD, STEP * n);
  return Array.from({ length: n }, (_, i) => -spread / 2 + (spread * i) / (n - 1));
}

/** Un dorso sin carta detras: el abanico no sabe cual es hasta que se nombra. */
function back() {
  const node = el('div', 'card');
  node.dataset.face = 'down';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', 'Carta boca abajo');
  node.appendChild(el('div', 'card__face card__face--back'));
  return node;
}

export function mountRivalFan(root, { size }) {
  const zone = el('section', 'fan-zone');
  const fan = el('div', 'fan');
  fan.setAttribute('role', 'group');
  fan.setAttribute('aria-label', 'Mano del rival');
  const slots = fanAngles(size).map((angle, i) => {
    const slot = el('div', 'fan__card');
    slot.style.setProperty('--a', `${angle.toFixed(2)}deg`);
    slot.style.setProperty('--z', String(i + 1));
    slot.dataset.slot = String(i);
    slot.dataset.state = 'down';
    slot.appendChild(back());
    fan.appendChild(slot);
    return slot;
  });
  zone.append(fan);
  root.replaceChildren(zone);

  return {
    slots,
    destroy() { root.replaceChildren(); },
  };
}
