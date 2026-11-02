/** Search the WHOLE active main, not the playable subset; selection is not discovery. */
import { search } from '../engine/match.js';
import { renderCard } from './card.js';

let sequence = 0;
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export function mountComposer(root, { cards, index, onConfirm, onUserEdit = () => {} }) {
  const id = `recall-list-${++sequence}`;
  const panel = el('section', 'recall-composer');
  const label = el('label', 'recall-composer__label', 'Buscá una carta del mazo');
  const input = el('input', 'recall-composer__input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  label.appendChild(input);
  const list = el('div', 'recall-composer__list');
  list.id = id;
  list.setAttribute('role', 'listbox');
  const status = el('p', 'recall-composer__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const preview = el('div', 'recall-composer__preview');
  const confirm = el('button', 'btn', 'Confirmar combinación');
  confirm.type = 'button';
  const chosen = new Map();
  let hits = [];
  let active = -1;
  let disabled = false;

  function renderPreview() {
    preview.replaceChildren();
    for (const [cardId, qty] of chosen) {
      const card = cards.find((c) => c.id === cardId);
      const row = el('div', 'recall-composer__choice');
      const art = el('div', 'recall-composer__chosen-card');
      art.appendChild(renderCard(card, { faceUp: true }));
      const name = el('span', 'recall-composer__name', card.name);
      const actions = el('span', 'recall-composer__quantity');
      const control = (action, label, text, handler, inactive = false) => {
        const button = el('button', null, text);
        button.type = 'button';
        button.dataset.action = action;
        button.setAttribute('aria-label', `${label} ${card.name}`);
        button.disabled = disabled || inactive;
        button.addEventListener('click', () => { onUserEdit(); handler(); });
        return button;
      };
      actions.append(
        control('dec', 'Quitar una copia de', '−', () => {
          if (qty === 1) chosen.delete(cardId);
          else chosen.set(cardId, qty - 1);
          renderPreview();
        }),
        el('span', 'num', String(qty)),
        control('inc', 'Agregar una copia de', '+', () => {
          chosen.set(cardId, qty + 1);
          renderPreview();
        }, qty >= index.byId.get(cardId).qty),
        control('remove', 'Retirar', 'Retirar', () => { chosen.delete(cardId); renderPreview(); }),
      );
      row.append(art, name, actions);
      preview.appendChild(row);
    }
  }
  function close() {
    list.replaceChildren();
    hits = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  }
  function choose(card) {
    onUserEdit();
    const qty = chosen.get(card.id) ?? 0;
    if (qty < index.byId.get(card.id).qty) chosen.set(card.id, qty + 1);
    renderPreview();
    input.value = '';
    close();
    status.textContent = '';
    input.focus();
  }
  function update() {
    close();
    if (!input.value.trim() || disabled) { status.textContent = ''; return; }
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
      option.addEventListener('click', () => choose(card));
      list.appendChild(option);
    });
    input.setAttribute('aria-expanded', 'true');
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
    if (event.key === 'Enter' && active >= 0 && hits[active]) {
      event.preventDefault();
      choose(hits[active]);
    }
  });
  confirm.addEventListener('click', () => onConfirm([...chosen].map(([cardId, qty]) => ({ cardId, qty }))));
  panel.append(label, list, status, preview, confirm);
  root.replaceChildren(panel);
  return {
    entries: () => [...chosen].map(([cardId, qty]) => ({ cardId, qty })),
    clear: () => { chosen.clear(); renderPreview(); },
    setDisabled: (value) => { disabled = value; input.disabled = value; confirm.disabled = value; renderPreview(); if (value) close(); },
    destroy: () => root.replaceChildren(),
  };
}
