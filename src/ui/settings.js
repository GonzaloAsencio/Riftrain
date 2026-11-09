/**
 * La configuracion: hasta que nivel se juega y el mazo del rival, pegado como codigo o como lista de
 * texto de Piltover Archive (el mismo campo acepta las dos: lo distingue el motor).
 * Un <dialog> nativo: showModal() atrapa el foco, Escape lo cierra, el fondo no se toca.
 * No decide nada: lo pegado lo lee el motor (deck-import.js) y lo cruza contra el catalogo, que se
 * descarga recien la primera vez que hace falta (loadCatalog), una sola vez.
 */
import { prepareDeckInput, importDeck } from '../engine/deck-import.js';
import { DOMAIN_LABEL } from '../engine/runes.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const button = (label, action, cls = 'btn') => {
  const item = el('button', cls, label);
  item.type = 'button';
  item.dataset.action = action;
  return item;
};

let sequence = 0;

/**
 * @param {HTMLElement} host  donde vive el dialog mientras esta abierto
 * @param {{maxLevel: number, deck: object|null, deckName: string, loadCatalog: () => Promise<object[]>,
 *          onSave: (settings: {maxLevel: number, deck: object|null}) => void, onClose?: () => void}} options
 */
export function openSettings(host, { maxLevel, deck, deckName, loadCatalog, onSave, onClose = () => {} }) {
  const id = `settings-${++sequence}`;
  let level = maxLevel;
  let pending = null;          // mazo leido y resuelto, todavia sin guardar
  let catalog = null;          // promesa: el catalogo se pide una sola vez por apertura
  let readSeq = 0;             // turno de lectura: una lectura vieja no pisa a una nueva

  const dialog = el('dialog', 'settings');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const head = el('header', 'settings__head');
  const title = el('h2', 'settings__title', 'Configuración');
  title.id = `${id}-title`;
  const close = button('', 'close', 'settings__close');
  close.setAttribute('aria-label', 'Cerrar');
  close.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(title, close);

  const levels = el('fieldset', 'settings__group');
  levels.appendChild(el('legend', 'settings__label', 'Hasta qué nivel se juega'));
  const grid = el('div', 'settings__levels');
  const pills = Array.from({ length: 12 }, (_, i) => {
    const pill = button(String(i + 1), 'level', 'settings__level');
    pill.dataset.level = String(i + 1);
    pill.addEventListener('click', () => { level = i + 1; paintLevels(); });
    return pill;
  });
  grid.append(...pills);
  const levelHint = el('p', 'settings__hint');
  levels.append(grid, levelHint);

  const deckGroup = el('div', 'settings__group');
  const label = el('label', 'settings__label', 'Mazo del rival ');
  label.htmlFor = `${id}-code`;
  label.appendChild(el('span', 'settings__muted', '· código o lista de texto de Piltover Archive'));
  const row = el('div', 'settings__row');
  const input = el('textarea', 'settings__code');
  input.id = `${id}-code`;
  input.rows = 3;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = `Hoy: ${deckName}. Pegá el código o la lista (Export → Text). Ctrl+Enter lee.`;
  input.setAttribute('aria-describedby', `${id}-preview`);
  const read = button('Leer mazo', 'read', 'btn btn--ghost settings__read');
  row.append(input, read);
  const preview = el('div', 'settings__preview');
  preview.id = `${id}-preview`;
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  const restart = el('p', 'settings__restart', 'Cambiar de mazo empieza el recorrido de nuevo desde el nivel 1.');
  restart.hidden = true;
  deckGroup.append(label, row, preview, restart);

  const foot = el('footer', 'settings__foot');
  const cancel = button('Cancelar', 'cancel', 'btn btn--ghost');
  const save = button('Guardar', 'save');
  foot.append(cancel, save);
  dialog.append(head, levels, deckGroup, foot);

  function paintLevels() {
    pills.forEach((pill, i) => {
      pill.setAttribute('aria-pressed', String(i + 1 === level));
      pill.classList.toggle('settings__level--out', i + 1 > level);
    });
    levelHint.textContent = `El recorrido termina al completar el nivel ${level}. Cada nivel es una runa abierta más en la mesa del rival.`;
  }

  /** Guardar se puede si no hay codigo a medio leer: o el input esta vacio, o el mazo ya se leyo bien. */
  function paintSave() { save.disabled = input.value.trim() !== '' && !pending; }

  function showError(reason, missing = []) {
    pending = null;
    input.setAttribute('aria-invalid', 'true');
    restart.hidden = true;
    const box = el('div', 'settings__error');
    box.appendChild(el('strong', null, reason));
    if (missing.length) {
      const list = el('ul');
      for (const item of missing) list.appendChild(el('li', null, `${item.label}${item.qty ? ` ×${item.qty}` : ''}: ${item.reason}`));
      box.appendChild(list);
      box.appendChild(el('span', 'settings__muted', 'Un mazo al que le faltan cartas entrena una mano que no existe.'));
    }
    preview.replaceChildren(box);
    paintSave();
  }

  function showDeck(resolved) {
    pending = resolved;
    input.removeAttribute('aria-invalid');
    const byId = new Map(resolved.cards.map((card) => [card.id, card]));
    const { deck: next } = resolved;
    const total = next.cards.reduce((sum, card) => sum + card.qty, 0);
    const runes = Object.entries(next.runes).sort((a, b) => b[1] - a[1])
      .map(([domain, n]) => `${n} ${DOMAIN_LABEL[domain] ?? domain}`).join(', ');
    const box = el('div', 'settings__deck');
    box.appendChild(el('strong', null, byId.get(next.legend)?.name ?? 'Leyenda'));
    if (next.champion) box.appendChild(el('span', null, `Campeón: ${byId.get(next.champion)?.name ?? next.champion}`));
    box.appendChild(el('span', null, `${total} cartas en el mazo principal · 12 runas: ${runes}`));
    preview.replaceChildren(box);
    restart.hidden = false;
    paintSave();
  }

  async function readCode() {
    if (read.disabled) return;
    const run = ++readSeq;
    const prepared = prepareDeckInput(input.value);
    if (!prepared.ok) { showError(prepared.reason); return; }
    read.disabled = true;
    preview.replaceChildren(el('span', 'settings__muted', 'Leyendo el catálogo…'));
    try {
      catalog ??= loadCatalog();
      const cards = await catalog;
      // Mientras bajaba el catalogo se edito el codigo, se leyo otro o se cerro: este resultado ya no vale.
      if (run !== readSeq) return;
      const resolved = importDeck(prepared, cards);
      if (resolved.ok) showDeck(resolved); else showError(resolved.reason, resolved.missing);
    } catch {
      catalog = null;          // un fallo de red no queda cacheado: se puede reintentar
      if (run === readSeq) showError('No se pudo descargar el catálogo de cartas. Revisá la conexión y probá de nuevo.');
    } finally {
      read.disabled = false;
    }
  }

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    readSeq++;
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose();
  }

  input.addEventListener('input', () => {
    readSeq++;
    pending = null;
    input.removeAttribute('aria-invalid');
    preview.replaceChildren();
    restart.hidden = true;
    paintSave();
  });
  // En una lista Enter es un salto de linea: leer es Ctrl/Cmd+Enter (o el boton).
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); readCode(); }
  });
  read.addEventListener('click', readCode);
  close.addEventListener('click', finish);
  cancel.addEventListener('click', finish);
  save.addEventListener('click', () => {
    if (save.disabled) return;
    // onSave devuelve false si no pudo guardar: el modal queda abierto con lo elegido.
    if (onSave({ maxLevel: level, deck: pending ? { deck: pending.deck, cards: pending.cards } : deck }) === false) return;
    finish();
  });
  // Escape cierra el dialog nativo; esto deja todo como Cancelar.
  dialog.addEventListener('close', finish);

  paintLevels();
  paintSave();
  host.appendChild(dialog);
  dialog.showModal();
  pills[level - 1].focus();
  return { dialog, close: finish };
}
