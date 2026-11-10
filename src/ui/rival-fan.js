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

const MAX_SPREAD = 110;    // grados: mas abierto deja de leerse como una mano
const STEP = 14;           // grados por carta hasta el maximo: con menos, la mano se ve como una pila y no un abanico

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

export function mountRivalFan(root, { size, deal = false }) {
  const zone = el('section', 'fan-zone');
  const fan = el('div', 'fan');
  // Reparto: los dorsos llegan desde el mazo, de a uno (la animacion la hace el CSS). La clase se
  // saca cuando termina (o con el primer revelado): si quedara, sacarle `data-fresh` a una carta
  // le devolveria la animacion de reparto y volveria a volar desde el mazo.
  fan.classList.toggle('fan--deal', deal);
  const endDeal = () => fan.classList.remove('fan--deal');
  fan.setAttribute('role', 'group');
  fan.setAttribute('aria-label', 'Mano del rival');
  const slots = fanAngles(size).map((angle, i) => {
    const slot = el('div', 'fan__card');
    slot.style.setProperty('--a', `${angle.toFixed(2)}deg`);
    slot.style.setProperty('--z', String(i + 1));
    slot.style.setProperty('--i', String(i));
    slot.dataset.slot = String(i);
    slot.dataset.state = 'down';
    slot.appendChild(back());
    fan.appendChild(slot);
    return slot;
  });
  if (deal) slots.at(-1)?.addEventListener('animationend', endDeal, { once: true });
  // Tres zonas que no se pisan: el arco, las extras (falsos positivos, al costado) y el motivo.
  const wrap = el('div', 'fan-wrap');
  const extras = el('div', 'fan__extras');
  // Siempre presente y vacia: una region live que aparece ya llena no siempre se anuncia.
  const why = el('p', 'fan__why');
  why.setAttribute('role', 'status');
  zone.append(fan);
  wrap.append(zone, extras, why);
  root.replaceChildren(wrap);

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
    // El grupo ya dice nombre y motivo: la carta y el rotulo de adentro no se leen dos veces.
    for (const inner of item.querySelectorAll('.card, .fan__tag')) inner.setAttribute('aria-hidden', 'true');
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
    endDeal();
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
      if (!slot) break;
      if (!card) continue;   // una carta sin datos no corta el resto del cierre
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
      // Entran una por una: el orden escalona la animacion (CSS).
      item.style.setProperty('--i', String(extras.children.length));
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
    /**
     * Fin del nivel: las cartas se dan vuelta, vuelven al mazo y se van las extras. Con `ms` > 0
     * resuelve cuando llega la ULTIMA carta (lo que dura depende de cuantas son: un tiempo fijo
     * cortaba las manos grandes a mitad de vuelo, AC-DEAL-04); `ms` es solo el tope por si una
     * animacion nunca termina. Con 0 resuelve en la proxima vuelta, sin esperar nada.
     */
    collect(ms = 0) {
      for (const node of fan.querySelectorAll('.card')) node.dataset.face = 'down';
      for (const slot of slots) glow(slot, false);   // boca abajo no hay brillo de dominio que mostrar
      extras.replaceChildren();
      why.textContent = '';
      fan.classList.remove('fan--deal');
      fan.classList.add('fan--collect');
      if (!ms) return new Promise((resolve) => setTimeout(resolve, 0));
      // getAnimations() ya ve las animaciones nuevas (incluido su delay): sin animacion, resuelve ya.
      const landed = Promise.allSettled(fan.getAnimations({ subtree: true }).map((a) => a.finished));
      return Promise.race([landed, new Promise((resolve) => setTimeout(resolve, ms))]).then(() => {});
    },
    /** Si el nivel siguiente no se pudo armar, las cartas vuelven del mazo a la mano. */
    uncollect() { fan.classList.remove('fan--collect'); },
    destroy() { root.replaceChildren(); },
  };
}
