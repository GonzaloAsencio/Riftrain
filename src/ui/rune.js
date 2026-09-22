/**
 * Runa en mesa, dibujada como la carta de runa oficial de su dominio.
 * Abierta: parada. Agotada: tumbada, como se ve en la mesa real.
 */

import { DOMAIN_COLOR, DOMAIN_LABEL } from '../engine/runes.js';

// Imagenes oficiales de las cartas de runa (data/catalog.json, galeria de Riot).
const CDN = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/';
const RUNE_IMG = {
  fury: 'f95ed6ba0c4d4d357c45bf5bdb1a8e540af1f85f',
  calm: '9b70aa1b334728a3e8beeea0c9154a2d0f79b1eb',
  mind: '33df1c56c6e76f9cb783c19161f16fcdbdc20f98',
  body: '3313c73c5b31daa482073bfefbf4d2255a89d7d0',
  order: '71e7d71ebadb81ccad7ca4cb8b3fb85d2f5fd4bf',
  chaos: '3861fc566891a70c21cf3d3075adec716deb7080',
};

const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

/**
 * @param {{domain: string, ready: boolean}} r
 * @returns {HTMLElement}
 */
export function renderRune(r) {
  const node = el('div', 'rune' + (r.ready ? '' : ' rune--spent'));
  const card = el('div', 'rune__card');
  // Si la imagen no carga, queda el color del dominio: nunca un hueco.
  card.style.background = DOMAIN_COLOR[r.domain] ?? '#797f8b';

  const hash = RUNE_IMG[r.domain];
  if (hash) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = `${CDN}${hash}-744x1039.png?accountingTag=RB`;
    img.addEventListener('error', () => img.remove(), { once: true });
    card.appendChild(img);
  }
  const seat = el('div', 'rune__seat');
  seat.appendChild(card);
  node.appendChild(seat);

  const domain = DOMAIN_LABEL[r.domain] ?? r.domain;
  const caption = el('span', 'rune__label');
  caption.textContent = r.ready ? domain : `${domain} · agotada`;
  node.appendChild(caption);

  const label = `${domain}${r.ready ? '' : ' agotada'}`;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}
