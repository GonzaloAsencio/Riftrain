/**
 * El dock: un solo input para nombrar una carta del mazo.
 * Sugiere desde TODO el main (incluida la Energía 0) y nombrar es un acto: Enter o click
 * entregan la carta a `onName`. El input no decide nada, el motor responde.
 */
import { search } from '../engine/match.js';
import { renderCard } from './card.js';

let sequence = 0;
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export function mountComposer(root, { cards, onName, onUserEdit = () => {} }) {
  const id = `recall-list-${++sequence}`;
  const panel = el('section', 'recall-composer');
  const input = el('input', 'recall-composer__input');
  input.type = 'search';
  input.placeholder = 'Nombrá una carta que pueda jugar';
  input.setAttribute('aria-label', input.placeholder);
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');
  const list = el('div', 'recall-composer__list');
  list.id = id;
  list.setAttribute('role', 'listbox');
  const status = el('p', 'recall-composer__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let hits = [];
  let active = -1;

  function close() {
    list.replaceChildren();
    hits = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  }
  function name(cardId) {
    close();
    status.textContent = '';
    input.focus();
    onName(cardId);
  }
  function update() {
    close();
    if (!input.value.trim() || input.disabled) { status.textContent = ''; return; }
    hits = search(input.value, cards, { limit: 8 });
    if (!hits.length) { status.textContent = 'No hay coincidencias en este mazo'; return; }
    status.textContent = `${hits.length} coincidencia${hits.length === 1 ? '' : 's'}`;
    hits.forEach((card, i) => {
      const option = el('button', 'recall-composer__option');
      option.type = 'button';
      option.id = `${id}-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const thumb = el('span', 'recall-composer__thumb');
      thumb.appendChild(renderCard(card, { faceUp: true }));
      option.append(thumb, el('span', 'recall-composer__name', card.name));
      option.addEventListener('click', () => name(card.id));
      list.appendChild(option);
    });
    input.setAttribute('aria-expanded', 'true');
  }
  /** Enter nombra la sugerencia marcada o la primera; sin coincidencias entrega el texto crudo. */
  function submit() {
    const text = input.value.trim();
    if (!text) { name(null); return; }
    const pool = hits.length ? hits : search(text, cards, { limit: 8 });
    const choice = pool[active >= 0 ? active : 0];
    name(choice ? choice.id : text);
  }
  input.addEventListener('input', () => { onUserEdit(); update(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!hits.length) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', `${id}-${active}`);
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      submit();
    }
  });
  panel.append(input, list, status);
  root.replaceChildren(panel);
  return {
    clear() { input.value = ''; close(); status.textContent = ''; },
    focus() { input.focus(); },
    setDisabled(value) { input.disabled = value; if (value) close(); },
    destroy() { root.replaceChildren(); },
  };
}
