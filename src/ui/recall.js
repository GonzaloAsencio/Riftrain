/** Mountable controller for the deck wall; the engine alone decides validity. */
import { normalizeDeck } from '../engine/deck-combos.js';
import { createRecallScenario } from '../engine/recall-scenario.js';
import { startRecall, reduceRecall, advanceRecall, levelCardOutcomes } from '../engine/recall-progress.js';
import * as defaultStore from '../store.js';
import { renderCard } from './card.js';
import { renderRune } from './rune.js';
import { mountComposer } from './composer.js';
import { mountDeckWall } from './deck-wall.js';
import { mountRecallFeedback } from './recall-feedback.js';

const node = (tag, cls, text) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text != null) item.textContent = text;
  return item;
};

const HAND_SIZE = 7;
const CLOSED =['review', 'next', 'complete', 'omitted'];
const MESSAGES = {
  empty: 'Con esta mesa el rival no puede pagar ninguna carta; podés saltar el nivel',
  next: 'Nombraste todas las cartas que se podían jugar',
  review: 'Las que faltaron están en gris. Podés repetir el nivel.',
  complete: 'Entrenamiento completado',
  omitted: 'Recorrido terminado con nivel omitido',
};

export function mountRecall(root, { deck, cards, seed, initialLevel = 1,
  storage = defaultStore, feedbackOptions }) {
  let disposed = false;
  let state = null;
  let runSeed = seed;
  let composer = null;
  let wall = null;
  const normalized = normalizeDeck(deck, cards, { policy: 'positive-energy' });
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const panel = node('section', 'recall');
  const head = node('header', 'recall__head');
  const title = node('h1', null, 'Recordá las cartas');
  const levelText = node('span', 'recall__level');
  head.append(levelText, title);
  const table = node('section', 'table recall__table recall-band');
  table.setAttribute('aria-label', 'Mesa del rival');
  const tableHead = node('div', 'table__head');
  tableHead.appendChild(node('span', 'table__deck', deck?.name ?? 'Mazo'));
  const board = node('div', 'board');
  const publicCards = node('div', 'legend');
  publicCards.setAttribute('aria-label', 'Leyenda y campeón');
  const runes = node('div', 'runes');
  runes.setAttribute('aria-label', 'Runas en mesa');
  board.append(publicCards, runes);
  // La mano del rival: siete dorsos, puro contexto. El abanico lo da el CSS con --i.
  const hand = node('div', 'recall-hand');
  hand.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < HAND_SIZE; i++) {
    const back = node('span', 'recall-hand__back');
    back.style.setProperty('--i', String(i));
    hand.appendChild(back);
  }
  table.append(tableHead, board, hand);
  const prompt = node('p', 'ask', '¿Qué cartas del mazo puede pagar el rival con esta mesa?');
  prompt.appendChild(node('span', 'ask__hint', 'Las cartas de Energía 0 no cuentan en este entrenamiento.'));
  const feedbackHost = node('div', 'recall__feedback');
  const feedback = mountRecallFeedback(feedbackHost, feedbackOptions);
  const message = node('p', 'recall__message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const notice = node('p', 'recall__notice');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  const wallHost = node('div', 'recall__wall');
  const inputHost = node('div', 'recall__input');
  const controls = node('div', 'recall__controls');
  const button = (label, action, ghost) => {
    const item = node('button', ghost ? 'btn btn--ghost' : 'btn', label);
    item.type = 'button';
    item.dataset.action = action;
    item.hidden = true;
    return item;
  };
  const skip = button('Saltar este nivel', 'skip', true);
  const finish = button('Terminé', 'finish', true);
  const repeat = button('Repetir nivel', 'repeat');
  const next = button('Siguiente nivel', 'next');
  controls.append(skip, finish, repeat, next);
  // Cuatro zonas: encabezado, banda, muro, dock. El dock junta lo que se contesta y lo que avisa.
  const info = node('div', 'recall__info');
  info.append(feedbackHost, notice, message);
  const dock = node('div', 'recall-dock');
  dock.append(prompt, inputHost, controls, info);
  panel.append(head, table, wallHost, dock);
  root.replaceChildren(panel);
  const wallCards = normalized.ok ? normalized.index.cards.map(({ id }) => cardsById.get(id)) : [];
  const searchCards = normalized.ok ? normalized.index.fullCards.map(({ id }) => cardsById.get(id)) : [];

  function showBoard(scenario) {
    levelText.textContent = `Nivel ${scenario.level}`;
    publicCards.replaceChildren();
    for (const id of [deck.legend, deck.champion]) {
      const card = cardsById.get(id);
      if (card) publicCards.appendChild(renderCard(card, { faceUp: true }));
    }
    runes.replaceChildren();
    const open = scenario.runes.filter((r) => r.ready).length;
    const exhausted = scenario.runes.length - open;
    runes.appendChild(node('span', 'runes__meta',
      `${open} ${open === 1 ? 'abierta' : 'abiertas'} · ${exhausted} ${exhausted === 1 ? 'agotada' : 'agotadas'} · ${scenario.deckRemaining} en el Mazo de Runas`));
    for (const rune of scenario.runes) runes.appendChild(renderRune(rune));
  }

  function save() {
    try {
      const result = storage.saveRecallSnapshot(state);
      if (!result.ok) message.textContent = result.reason ?? 'No se pudo guardar este avance';
      else if (!result.persisted) message.textContent = result.warning ?? 'Sólo en memoria; no se garantiza continuidad';
      else notice.hidden = true;
    } catch {
      message.textContent = 'No se pudo guardar; este avance podría perderse al cerrar';
    }
  }

  /** Muro nuevo para el nivel en curso: lo hallado queda a la vista, sin brillo. */
  function mountWall() {
    wall?.destroy();
    wall = mountDeckWall(wallHost, { cards: wallCards });
    wall.setFound(state.found);
  }

  function draw() {
    if (!state || disposed) return;
    showBoard(state.scenario);
    const playable = ['active', 'empty'].includes(state.status);
    if (!composer && normalized.ok) composer = mountComposer(inputHost, {
      cards: searchCards, onName: name, onUserEdit: () => feedback.reset(),
    });
    composer?.setDisabled(!playable);
    skip.hidden = state.status !== 'empty';
    next.hidden = state.status !== 'next';
    finish.hidden = state.status !== 'active';
    repeat.hidden = state.status !== 'review';
    message.textContent = MESSAGES[state.status] ?? '';
    if (CLOSED.includes(state.status)) {
      wall.showOutcomes(levelCardOutcomes(normalized.index, state.scenario, state.found, state.misses).cards);
    }
  }

  function name(cardId) {
    if (disposed || !state || !['active', 'empty'].includes(state.status)) return;
    if (cardId == null) { feedback.notify('Nombrá una carta antes de seguir'); return; }
    const answer = reduceRecall(state, { type: 'name', cardId }, normalized.index);
    if (answer.kind === 'accepted') {
      state = answer.state;
      feedback.reset();
      wall.reveal(cardId, { fresh: true });
      composer.clear();
      draw();
      save();
    } else if (answer.kind === 'false-positive') {
      state = answer.state;
      feedback.reject(answer.reason);
    } else feedback.notify(answer.reason);
  }
  skip.addEventListener('click', () => {
    if (disposed || state?.status !== 'empty') return;
    const answer = reduceRecall(state, { type: 'skip' }, normalized.index);
    if (answer.kind !== 'skipped') { message.textContent = answer.reason; return; }
    state = answer.state;
    feedback.reset();
    composer.clear();
    draw();
    save();
  });
  finish.addEventListener('click', () => {
    if (disposed || state?.status !== 'active') return;
    const answer = reduceRecall(state, { type: 'finish' }, normalized.index);
    if (!['review', 'finished'].includes(answer.kind)) { message.textContent = answer.reason; return; }
    state = answer.state;
    feedback.reset();
    composer.clear();
    draw();
    save();
  });
  repeat.addEventListener('click', () => {
    if (disposed || state?.status !== 'review') return;
    const answer = reduceRecall(state, { type: 'repeat' }, normalized.index);
    if (answer.kind !== 'repeated') { message.textContent = answer.reason; return; }
    state = answer.state;
    feedback.reset();
    wall.setFound(state.found);
    draw();
    save();
    composer.focus();
  });
  next.addEventListener('click', () => {
    if (disposed || state?.status !== 'next') return;
    prepare(state.nextLevel, state);
  });

  /** Arranca (o avanza a) un nivel: todo es sincrono, no hay objetivo que calcular aparte. */
  function prepare(level, previous = null) {
    if (disposed) return;
    feedback.reset();
    const created = createRecallScenario(deck, normalized.index, runSeed, level);
    if (!created.ok) { message.textContent = created.reason; return; }
    const started = previous ? advanceRecall(previous, created.scenario, normalized.index) :
      startRecall(created.scenario, normalized.index);
    if (!started.ok) { message.textContent = started.reason; return; }
    state = started.state;
    mountWall();
    draw();
    if (previous) save();
  }

  if (!normalized.ok) {
    message.textContent = normalized.reason;
  } else {
    let restored;
    try { restored = storage.loadRecallSnapshot(deck, normalized.index); } catch { restored = { ok: false }; }
    if (restored?.ok) {
      state = restored.state;
      runSeed = state.scenario.seed;
      mountWall();
      draw();
    } else {
      try {
        if (typeof storage.load === 'function' && Object.hasOwn(storage.load({}), 'recall')) {
          notice.textContent = `No pudimos recuperar el progreso anterior: ${restored?.reason ?? 'datos incompatibles'}. Empezamos de nuevo; el registro anterior se reemplaza con tu primer avance.`;
          notice.hidden = false;
        }
      } catch { /* storage bloqueado: el aviso de fallback lo maneja el store */ }
      prepare(initialLevel);
    }
  }
  return {
    ready: Promise.resolve(),
    destroy() { disposed = true; feedback.destroy(); composer?.destroy(); wall?.destroy(); root.replaceChildren(); },
  };
}
