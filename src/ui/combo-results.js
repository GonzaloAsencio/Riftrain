/** Render only the discovered groups. Pagination bounds DOM, never the target. */
import { renderCard } from './card.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export function mountComboResults(root, { cardsById, found = [], pageSize = 8,
  title = 'Jugadas descubiertas', result = 'hit', total = null, onPage = null }) {
  let groups = found;
  let page = 0;
  let remoteTotal = total;
  const section = el('section', 'recall-results');
  const heading = el('h2', null, title);
  const list = el('div', 'recall-results__list');
  const nav = el('nav', 'recall-results__nav');
  nav.setAttribute('aria-label', 'Páginas de jugadas descubiertas');
  const previous = el('button', null, 'Anteriores');
  previous.type = 'button'; previous.dataset.page = 'previous';
  const indicator = el('span', 'num');
  const next = el('button', null, 'Siguientes');
  next.type = 'button'; next.dataset.page = 'next';
  nav.append(previous, indicator, next);
  section.append(heading, list, nav);
  root.replaceChildren(section);

  function render() {
    list.replaceChildren();
    if (!groups.length) {
      list.appendChild(el('p', 'recall-results__empty', 'Las cartas que recuerdes van a aparecer acá.'));
    }
    const start = page * pageSize;
    const visible = onPage ? groups : groups.slice(start, start + pageSize);
    for (const foundGroup of visible) {
      const row = el('article', 'recall-results__group');
      row.dataset.result = result;
      row.appendChild(el('h3', null,
        `${foundGroup.level ? `Nivel ${foundGroup.level} · ` : ''}Jugada ${start + [...list.children].length + 1}`));
      const hand = el('div', 'recall-results__cards');
      for (const { cardId, qty } of foundGroup.group) {
        const card = cardsById.get(cardId);
        const slot = el('div', 'recall-results__card');
        if (card) slot.appendChild(renderCard(card, { faceUp: true, result }));
        slot.appendChild(el('span', 'recall-results__label', card?.name ?? cardId));
        slot.appendChild(el('span', 'recall-results__badge num', `×${qty}`));
        hand.appendChild(slot);
      }
      row.appendChild(hand);
      list.appendChild(row);
    }
    const count = remoteTotal ?? BigInt(groups.length);
    indicator.textContent = count ? `${start + 1}–${start + visible.length} de ${count}` : '0 descubiertas';
    previous.disabled = page === 0;
    next.disabled = BigInt(start + pageSize) >= count;
    nav.hidden = count <= BigInt(pageSize);
  }
  previous.addEventListener('click', () => { if (page > 0) { if (onPage) onPage(page - 1); else { page--; render(); } } });
  next.addEventListener('click', () => {
    if (BigInt((page + 1) * pageSize) < (remoteTotal ?? BigInt(groups.length))) {
      if (onPage) onPage(page + 1);
      else { page++; render(); }
    }
  });
  render();
  return {
    setFound(value) {
      if (value.length > groups.length) page = Math.floor((value.length - 1) / pageSize);
      else page = Math.min(page, Math.max(0, Math.ceil(value.length / pageSize) - 1));
      groups = value;
      render();
    },
    setRemotePage(value, number, exactTotal) {
      groups = value;
      page = number;
      remoteTotal = exactTotal;
      render();
    },
    destroy: () => root.replaceChildren(),
  };
}
