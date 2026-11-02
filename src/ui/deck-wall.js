/**
 * Muro del mazo: una celda boca abajo por carta DISTINTA del mazo principal.
 * Nombrar una carta la da vuelta en su lugar; al cerrar, cada celda muestra su resultado.
 *
 * No calcula reglas: el estado de cada celda se lo dicen (reveal / setFound / showOutcomes).
 * El estado vive en el DOM (`data-state`), no en un porcentaje: el feedback es una imagen.
 */
import { DOMAIN_COLOR } from '../engine/runes.js';
import { renderCard, flipUp, flipDown } from './card.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

// Vocabulario de levelCardOutcomes -> data-state de la celda.
const STATE = { hit: 'found', missed: 'missed', 'false-positive': 'false-positive', irrelevant: 'irrelevant' };

export function mountDeckWall(root, { cards }) {
  const wall = el('section', 'wall');
  wall.setAttribute('aria-label', 'Cartas del mazo');
  const grid = el('div', 'wall__grid');
  grid.style.setProperty('--n', String(cards.length));
  const why = el('p', 'wall__why');
  why.setAttribute('role', 'status');
  why.hidden = true;
  const slots = new Map();

  function glow(slot, on, fresh = false) {
    slot.toggleAttribute('data-fresh', on && fresh);
    if (on) {
      slot.dataset.glow = slot.card.domain ?? 'none';
      slot.style.setProperty('--glow', DOMAIN_COLOR[slot.card.domain] ?? '#797f8b');
    } else {
      delete slot.dataset.glow;
      slot.style.removeProperty('--glow');
    }
  }
  function clearReason(slot) {
    slot.removeAttribute('tabindex');
    slot.removeAttribute('role');
    slot.removeAttribute('aria-label');
    delete slot.dataset.reason;
    slot.querySelector('.wall__tag')?.remove();
  }
  function lower(slot) {
    flipDown(slot.firstChild);
    slot.dataset.state = 'down';
    glow(slot, false);
    clearReason(slot);
  }
  function lift(slot, state) {
    flipUp(slot.firstChild, slot.card);
    slot.dataset.state = state;
  }
  function explain(slot, reason) {
    slot.tabIndex = 0;
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', `${slot.card.name}: ${reason}`);
    slot.dataset.reason = reason;
  }
  function inspect(slot) {
    if (!slot.dataset.reason) return;
    why.textContent = slot.dataset.reason;
    why.hidden = false;
  }

  for (const card of cards) {
    const slot = el('div', 'wall__slot');
    slot.card = card;
    slot.dataset.cardId = card.id;
    slot.dataset.state = 'down';
    slot.appendChild(renderCard(card, { faceUp: false }));
    for (const type of ['pointerenter', 'focusin', 'click']) slot.addEventListener(type, () => inspect(slot));
    slots.set(card.id, slot);
    grid.appendChild(slot);
  }
  wall.append(grid, why);
  root.replaceChildren(wall);

  function reveal(cardId, { fresh = false } = {}) {
    const slot = slots.get(cardId);
    if (!slot) return;
    if (fresh) for (const other of slots.values()) glow(other, false);
    lift(slot, 'found');
    glow(slot, fresh, true);
  }

  function reset() {
    for (const slot of slots.values()) lower(slot);
    why.hidden = true;
    why.textContent = '';
  }

  return {
    reveal,
    /** Deja levantadas sólo estas (sin brillo) y tapa el resto: restaurar o repetir un nivel. */
    setFound(cardIds) {
      const found = new Set(cardIds);
      reset();
      for (const id of found) reveal(id);
    },
    /** Resultado final por carta (levelCardOutcomes): cuatro estados, el motivo sólo si lo hay. */
    showOutcomes(outcomes) {
      reset();
      for (const { cardId, outcome, reason } of outcomes) {
        const slot = slots.get(cardId);
        const state = STATE[outcome];
        if (!slot || !state) continue;
        if (state === 'irrelevant') { slot.dataset.state = state; continue; }
        lift(slot, state);
        if (state === 'found') glow(slot, true);
        if (state === 'false-positive') slot.appendChild(el('span', 'wall__tag', 'NO ENTRABA'));
        if (reason) explain(slot, reason);
      }
    },
    reset,
    destroy() { root.replaceChildren(); },
  };
}
