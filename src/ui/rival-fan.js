/**
 * La mano del rival en abanico: tantos dorsos como cartas puede pagar el rival en este nivel.
 * Los dorsos no tienen identidad: cada acierto da vuelta el PROXIMO, con la carta nombrada.
 * Al cerrar, los que quedaron muestran en gris las que se pasaron; los falsos positivos van
 * al costado. No calcula reglas: quien la monta le dice el tamaño y que mostrar.
 */

import { DOMAIN_COLOR } from '../engine/runes.js';
import { renderCard, flipUp } from './card.js';

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
  // Los falsos positivos no son parte de la mano: al cerrar aparecen al costado del arco.
  const extras = el('div', 'fan__extras');
  // Siempre presente y vacia: una region live que aparece ya llena no siempre se anuncia.
  const why = el('p', 'fan__why');
  why.setAttribute('role', 'status');
  zone.append(fan, extras, why);
  root.replaceChildren(zone);

  /** Explica ESTA carta; sin motivo, vacia: nunca queda el motivo de otra a la vista. */
  function inspect(item) {
    const text = item.dataset.reason ?? '';
    if (why.textContent !== text) why.textContent = text;
  }
  function listen(item) {
    for (const type of ['pointerenter', 'focusin', 'click']) item.addEventListener(type, () => inspect(item));
  }
  function explain(item, card, reason) {
    item.tabIndex = 0;
    item.setAttribute('role', 'group');
    item.setAttribute('aria-label', `${card.name}: ${reason}`);
    item.dataset.reason = reason;
  }
  function unexplain(item) {
    for (const name of ['tabindex', 'role', 'aria-label', 'data-reason']) item.removeAttribute(name);
  }
  slots.forEach(listen);

  /** Da vuelta un slot con esta carta: la carta real reemplaza al dorso anonimo y gira. */
  function lift(slot, card, state) {
    const node = renderCard(card, { faceUp: false });
    slot.replaceChildren(node);
    void node.offsetWidth;   // que el giro arranque desde el dorso, no aparezca ya dado vuelta
    flipUp(node, card);
    slot.dataset.cardId = card.id;
    slot.dataset.state = state;
  }
  function lower(slot) {
    slot.replaceChildren(back());
    slot.dataset.state = 'down';
    delete slot.dataset.cardId;
    glow(slot, false);
    unexplain(slot);
  }
  function glow(slot, on, fresh = false) {
    slot.toggleAttribute('data-fresh', on && fresh);
    if (on) {
      slot.dataset.glow = slot.card?.domain ?? 'none';
      slot.style.setProperty('--glow', DOMAIN_COLOR[slot.card?.domain] ?? '#797f8b');
    } else {
      delete slot.dataset.glow;
      slot.style.removeProperty('--glow');
    }
  }
  const nextDown = () => slots.find((slot) => slot.dataset.state === 'down');

  function reveal(card, { fresh = false } = {}) {
    const slot = nextDown();
    if (!slot || !card) return;
    if (fresh) for (const other of slots) glow(other, false);
    slot.card = card;
    lift(slot, card, 'found');
    glow(slot, fresh, true);
  }
  function reset() {
    for (const slot of slots) { slot.card = null; lower(slot); }
    extras.replaceChildren();
    why.textContent = '';
  }

  /**
   * Cierre: lo que se paso ocupa los dorsos que quedaron, en gris y con su motivo; cada
   * falso positivo es una carta mas al costado, inclinada, con NO ENTRABA. La lista y el
   * orden los decide quien llama (levelCardOutcomes).
   */
  function showOutcomes({ missed = [], falsePositives = [] } = {}) {
    for (const { card, reason } of missed) {
      const slot = nextDown();
      if (!slot || !card) break;
      slot.card = card;
      lift(slot, card, 'missed');
      if (reason) explain(slot, card, reason);
    }
    extras.replaceChildren();
    for (const { card, reason } of falsePositives) {
      if (!card) continue;
      const item = el('div', 'fan__extra');
      const node = renderCard(card, { faceUp: true });
      item.append(node, el('span', 'fan__tag', 'NO ENTRABA'));
      item.dataset.cardId = card.id;
      item.dataset.state = 'false-positive';
      if (reason) explain(item, card, reason);
      listen(item);
      extras.appendChild(item);
    }
  }

  return {
    reveal,
    /** Restaurar o repetir: lo hallado en los primeros slots, en orden, sin brillo. */
    setFound(cards) {
      reset();
      for (const card of cards) reveal(card);
    },
    showOutcomes,
    reset,
    destroy() { root.replaceChildren(); },
  };
}
