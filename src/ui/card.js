/**
 * Componente de carta. Dibujado con CSS desde los datos.
 * Requisito no negociable: las cartas se ven como CARTAS, no como una lista de texto.
 *
 * - Proporcion 63:88, fijada con aspect-ratio para que el layout no salte al cargar el arte.
 * - Pip de Energia arriba a la izquierda, NEGRO (la energia es incolora).
 * - Pips de Poder al lado, cada uno con el color de su dominio.
 * - Ventana de ilustracion ~47% superior.
 * - Banda del color del dominio en el borde superior.
 * - Might abajo a la derecha si es unidad.
 * - Dorso distinto y reconocible.
 *
 * Si falta el arte, la carta se dibuja igual con su marco y sigue siendo legible.
 * NUNCA un hueco vacio ni un spinner.
 */

import { DOMAIN_COLOR, DOMAIN_LABEL, DOMAINS } from '../engine/runes.js';

const TYPE_LABEL = {
  unit: 'Unidad',
  spell: 'Hechizo',
  gear: 'Equipo',
  battlefield: 'Campo',
  legend: 'Leyenda',
  champion: 'Campeon',
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Los pips de coste: energia negra primero, despues un pip por dominio. */
function costPips(card) {
  const wrap = el('div', 'card__costs');

  const energy = card.energy ?? 0;
  const powerTotal = DOMAINS.reduce((a, d) => a + (card.power?.[d] ?? 0), 0);

  // Mostramos el pip de energia siempre que haya energia, o si la carta no cuesta nada.
  if (energy > 0 || powerTotal === 0) {
    wrap.appendChild(el('span', 'pip pip--energy num', String(energy)));
  }
  for (const d of DOMAINS) {
    const n = card.power?.[d] ?? 0;
    if (n <= 0) continue;
    const pip = el('span', 'pip pip--power num', String(n));
    pip.style.setProperty('--pip', DOMAIN_COLOR[d]);
    pip.title = `${n} de Poder ${DOMAIN_LABEL[d]}`;
    wrap.appendChild(pip);
  }
  return wrap;
}

function frontFace(card) {
  const face = el('div', 'card__face card__face--front');
  face.style.setProperty('--dom', DOMAIN_COLOR[card.domain] ?? '#797f8b');

  face.appendChild(el('div', 'card__band'));
  face.appendChild(costPips(card));

  const art = el('div', 'card__art');
  if (card.img) {
    // La imagen oficial ya trae coste, nombre y texto: la carta ES la imagen.
    face.classList.add('card__face--image');
    const img = el('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = card.img;
    // Si el arte falla, la carta NO se rompe: vuelve al marco dibujado.
    img.addEventListener('error', () => {
      img.remove();
      face.classList.remove('card__face--image');
      art.classList.add('card__art--empty');
    }, { once: true });
    art.appendChild(img);
  } else {
    art.classList.add('card__art--empty');
  }
  face.appendChild(art);

  const body = el('div', 'card__body');
  body.appendChild(el('div', 'card__name', card.name));

  const typeLine = [TYPE_LABEL[card.type] ?? card.type, card.subtype].filter(Boolean).join(' · ');
  body.appendChild(el('div', 'card__type', typeLine));

  if (card.text) body.appendChild(el('div', 'card__text', card.text));

  if (card.type === 'unit' && card.might != null) {
    body.appendChild(el('div', 'might num', String(card.might)));
  }
  face.appendChild(body);

  return face;
}

/** El dorso real de la carta: la imagen la pone el CSS (assets/card-back.png). */
function backFace() {
  return el('div', 'card__face card__face--back');
}

/**
 * @param {object} card
 * @param {object} o
 * @param {boolean} o.faceUp   arranca dada vuelta?
 * @returns {HTMLElement}
 */
export function renderCard(card, { faceUp = false } = {}) {
  const node = el('div', 'card');
  node.dataset.face = faceUp ? 'up' : 'down';
  node.dataset.cardId = card.id;

  node.appendChild(backFace());
  node.appendChild(frontFace(card));

  // El lector de pantalla no ve un abanico: le decimos el estado en palabras.
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', faceUp ? describeCard(card) : 'Carta boca abajo');

  return node;
}

/** Da vuelta una carta ya montada. El CSS hace el rotateY en 280ms. */
export function flipUp(node, card) {
  node.dataset.face = 'up';
  node.setAttribute('aria-label', describeCard(card));
}

function describeCard(card) {
  const parts = [card.name];
  const cost = [];
  if (card.energy) cost.push(`${card.energy} de energia`);
  for (const d of DOMAINS) {
    const n = card.power?.[d] ?? 0;
    if (n > 0) cost.push(`${n} de poder ${DOMAIN_LABEL[d]}`);
  }
  if (cost.length) parts.push(`cuesta ${cost.join(' y ')}`);
  return parts.join(', ');
}
