/**
 * Avisos de la ronda: el sello cuando una carta NO entra (con el motivo exacto del motor) y
 * un toast para lo que no es una respuesta (repetida, fuera del mazo, vacío). Nada celebra:
 * el acierto se ve en la carta que se da vuelta, no en un cartel.
 */
export function mountRecallFeedback(root, {
  schedule = (callback) => setTimeout(callback, 2500),
  cancel = clearTimeout,
} = {}) {
  const container = document.createElement('div');
  container.className = 'recall-feedback';
  // La region live es el contenedor, siempre presente: sello y toast aparecen DENTRO de ella.
  // Una region que se muestra junto con su texto no siempre se anuncia.
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  const stamp = document.createElement('p');
  stamp.className = 'recall-stamp';
  stamp.hidden = true;
  const stampLabel = document.createElement('strong');
  stampLabel.textContent = 'NO ENTRA';
  const stampReason = document.createElement('span');
  stamp.append(stampLabel, stampReason);
  const toast = document.createElement('span');
  toast.className = 'recall-feedback__toast';
  toast.hidden = true;
  container.append(stamp, toast);
  root.replaceChildren(container);
  let token = 0;
  let timer = null;
  let destroyed = false;

  function dismiss() {
    token++;
    if (timer !== null) cancel(timer);
    timer = null;
    toast.hidden = true;
  }

  function clearStamp() {
    stamp.hidden = true;
    stampReason.textContent = '';
  }

  function notify(message, tone = 'warning') {
    if (destroyed) return;
    dismiss();
    clearStamp();
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    const current = token;
    timer = schedule(() => {
      if (!destroyed && current === token) { toast.hidden = true; timer = null; }
    });
  }

  return {
    /** La carta no se paga sola: el sello lleva el motivo EXACTO que dio el motor. */
    reject(reason) {
      if (destroyed) return;
      dismiss();
      stampReason.textContent = reason;
      stamp.hidden = false;
    },
    notify,
    dismiss,
    reset() { dismiss(); clearStamp(); },
    destroy() {
      destroyed = true;
      dismiss();
      root.replaceChildren();
    },
  };
}
