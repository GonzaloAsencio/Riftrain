/** Seven reusable backs: a visual acknowledgment, never an opponent hand. */
import { renderCard, flipUp } from './card.js';

const makeBack = () => {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.face = 'down';
  const back = document.createElement('div');
  back.className = 'card__face card__face--back';
  card.appendChild(back);
  return card;
};

export function mountRecallFeedback(root, {
  schedule = (callback) => setTimeout(callback, 2500),
  cancel = clearTimeout,
  frame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
} = {}) {
  const container = document.createElement('div');
  container.className = 'recall-feedback';
  if (reducedMotion()) container.classList.add('recall-feedback--reduced');
  const caption = document.createElement('span');
  caption.className = 'recall-feedback__caption';
  caption.textContent = 'Recuerdo visual';
  const fan = document.createElement('div');
  fan.className = 'recall-feedback__fan';
  fan.setAttribute('aria-hidden', 'true');
  let slots = [];
  function showBacks(count = 7) {
    fan.replaceChildren();
    fan.style.setProperty('--fan-slots', String(count));
    slots = Array.from({ length: count }, () => {
      const slot = document.createElement('div');
      slot.className = 'recall-feedback__slot';
      slot.appendChild(makeBack());
      fan.appendChild(slot);
      return slot;
    });
  }
  showBacks();
  const status = document.createElement('div');
  status.className = 'recall-feedback__status';
  const toast = document.createElement('span');
  toast.className = 'recall-feedback__toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = '¡Correcto!';
  toast.hidden = true;
  status.appendChild(toast);
  container.append(caption, fan, status);
  root.replaceChildren(container);
  let token = 0;
  let timer = null;
  let destroyed = false;
  const frames = new Set();

  function dismiss() {
    token++;
    if (timer !== null) cancel(timer);
    timer = null;
    toast.hidden = true;
  }

  function cancelFrames() {
    for (const id of frames) cancelFrame(id);
    frames.clear();
  }

  function notify(message, tone = 'warning') {
    if (destroyed) return;
    dismiss();
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    const current = token;
    timer = schedule(() => {
      if (!destroyed && current === token) { toast.hidden = true; timer = null; }
    });
  }

  function revealGroup(group, cardsById, index) {
    if (destroyed || !Array.isArray(group) || !group.length) return false;
    const faces = [];
    for (const { cardId, qty } of group) {
      const card = cardsById.get(cardId);
      const maximum = index.byId.get(cardId)?.qty;
      if (!card || !Number.isSafeInteger(maximum) || !Number.isSafeInteger(qty) || qty < 1 || qty > maximum) return false;
      for (let copy = 0; copy < qty; copy++) faces.push(card);
    }
    notify('¡Correcto!', 'ok');
    cancelFrames();
    showBacks(Math.max(7, faces.length));
    const cards = faces.map((card, i) => {
      const face = renderCard(card, { faceUp: false });
      slots[i].replaceChildren(face);
      return { face, card };
    });
    if (reducedMotion()) for (const { face, card } of cards) flipUp(face, card);
    else {
      const current = token;
      const frameId = frame(() => {
        frames.delete(frameId);
        if (!destroyed && current === token) {
          for (const { face, card } of cards) if (face.isConnected) flipUp(face, card);
        }
      });
      frames.add(frameId);
    }
    return true;
  }

  return {
    revealGroup,
    notify,
    dismiss,
    reset() {
      dismiss();
      cancelFrames();
      showBacks();
    },
    destroy() {
      destroyed = true;
      dismiss();
      cancelFrames();
      root.replaceChildren();
    },
  };
}
