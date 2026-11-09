/** Mountable controller: la mano del rival en abanico; sólo el motor decide qué vale. */
import { normalizeDeck } from '../engine/deck-combos.js';
import { createRecallScenario } from '../engine/recall-scenario.js';
import { rejectionRunes } from '../engine/cost.js';
import { DOMAIN_LABEL } from '../engine/runes.js';
import { startRecall, reduceRecall, advanceRecall, levelCardOutcomes } from '../engine/recall-progress.js';
import * as defaultStore from '../store.js';
import { renderCard } from './card.js';
import { renderRune } from './rune.js';
import { mountComposer } from './composer.js';
import { mountRivalFan } from './rival-fan.js';
import { mountRecallFeedback } from './recall-feedback.js';
import { mountCelebration } from './celebration.js';

const node = (tag, cls, text) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text != null) item.textContent = text;
  return item;
};

const CLOSED =['review', 'next', 'complete', 'omitted'];
const MESSAGES = {
  empty: 'Con esta mesa el rival no puede pagar ninguna carta; podés saltar el nivel',
  next: 'Nombraste todas las cartas que se podían jugar',
  review: 'Las que faltaron están en gris. Podés repetir el nivel.',
  complete: 'Entrenamiento completado',
  omitted: 'Recorrido terminado con nivel omitido',
};

export function mountRecall(root, { deck, cards, seed, initialLevel = 1,
  storage = defaultStore, feedbackOptions,
  // Inyectable para testear: el navegador headless no deja emular prefers-reduced-motion.
  reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches }) {
  let disposed = false;
  let state = null;
  let runSeed = seed;
  let composer = null;
  let fan = null;
  let outcomes = [];
  const normalized = normalizeDeck(deck, cards, { policy: 'positive-energy' });
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const panel = node('section', 'recall');
  panel.classList.toggle('recall--reduced', reducedMotion);
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
  const missing = node('span', 'runes__missing');
  missing.setAttribute('role', 'note');
  missing.hidden = true;
  table.append(tableHead, board);
  const prompt = node('p', 'ask', '¿Qué cartas del mazo puede pagar el rival con esta mesa?');
  prompt.appendChild(node('span', 'ask__hint', 'Las cartas de Energía 0 no cuentan en este entrenamiento.'));
  const feedbackHost = node('div', 'recall__feedback');
  const feedback = mountRecallFeedback(feedbackHost, feedbackOptions);
  const message = node('p', 'recall__message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.tabIndex = -1;   // enfocable por codigo: destino del foco cuando no queda ningun boton
  const notice = node('p', 'recall__notice');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');   // nunca hidden: vacio cuando no hay nada que avisar
  const fanHost = node('div', 'recall__fan');
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
  panel.append(head, table, fanHost, dock);
  root.replaceChildren(panel);
  // Fuera del panel: la grilla de la pantalla son cuatro zonas y el festejo no es una de ellas.
  const celebration = mountCelebration(root, { reducedMotion });
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
    const meta = node('span', 'runes__meta',
      `${open} ${open === 1 ? 'abierta' : 'abiertas'} · ${exhausted} ${exhausted === 1 ? 'agotada' : 'agotadas'} · ${scenario.deckRemaining} en el Mazo de Runas`);
    // La marca del dominio ausente vive en la linea de resumen: nunca empuja las runas a otra fila.
    missing.hidden = true;
    meta.appendChild(missing);
    runes.appendChild(meta);
    for (const rune of scenario.runes) runes.appendChild(renderRune(rune));
  }

  /** Rechazo visible: las runas que lo explican, o el dominio que falta. El motor decide cuales. */
  function markRejection(detail) {
    const { indices, missingDomain } = rejectionRunes(detail, state.scenario.runes);
    const nodes = runes.querySelectorAll('.rune');
    for (const i of indices) nodes[i]?.setAttribute('data-highlight', 'true');
    if (missingDomain) {
      missing.dataset.domain = missingDomain;
      missing.textContent = `Sin runas ${DOMAIN_LABEL[missingDomain] ?? missingDomain} en mesa`;
      missing.hidden = false;
    }
    composer?.flagRejected(true);
  }

  /** Sello, aviso, runas resaltadas y marca del input se van juntos. */
  function clearRejection() {
    feedback.reset();
    for (const rune of runes.querySelectorAll('[data-highlight]')) rune.removeAttribute('data-highlight');
    missing.hidden = true;
    composer?.flagRejected(false);
  }

  function save() {
    try {
      const result = storage.saveRecallSnapshot(state);
      if (!result.ok) message.textContent = result.reason ?? 'No se pudo guardar este avance';
      else if (!result.persisted) message.textContent = result.warning ?? 'Sólo en memoria; no se garantiza continuidad';
      else notice.textContent = '';
    } catch {
      message.textContent = 'No se pudo guardar; este avance podría perderse al cerrar';
    }
  }

  const cardsOf = (ids) => ids.map((id) => cardsById.get(id)).filter(Boolean);

  /** Mano nueva para el nivel: tantos dorsos como pagables (lo dice el motor); lo hallado, a la vista. */
  function mountHand() {
    fan?.destroy();
    fan = mountRivalFan(fanHost, { size: state.payable.length });
    fan.setFound(cardsOf(state.found));
  }

  function draw() {
    if (!state || disposed) return;
    showBoard(state.scenario);
    const playable = ['active', 'empty'].includes(state.status);
    panel.dataset.phase = CLOSED.includes(state.status) ? 'closed' : 'round';
    if (!composer && normalized.ok) composer = mountComposer(inputHost, {
      cards: searchCards, onName: name, onUserEdit: clearRejection,
    });
    composer?.setDisabled(!playable);
    skip.hidden = state.status !== 'empty';
    next.hidden = state.status !== 'next';
    finish.hidden = state.status !== 'active';
    repeat.hidden = state.status !== 'review';
    message.textContent = MESSAGES[state.status] ?? '';
    if (CLOSED.includes(state.status)) {
      outcomes = levelCardOutcomes(normalized.index, state.scenario, state.found, state.misses).cards;
      const pick = (kind) => outcomes.filter((item) => item.outcome === kind)
        .map((item) => ({ card: cardsById.get(item.cardId), reason: item.reason }));
      fan.showOutcomes({ missed: pick('missed'), falsePositives: pick('false-positive') });
    }
  }

  /** El boton que se toco se oculta: el foco pasa a lo que sigue en vez de caer al <body>. */
  function focusNextAction() {
    // Sin boton que siga (nivel 12 completo u omitido): el mensaje final, que es lo que hay para leer.
    ([repeat, next].find((item) => !item.hidden) ?? message).focus();
  }

  /** Cierre completo: el unico festejo de la ronda. El anuncio accesible es el mensaje de estado. */
  function celebrate() {
    const text = state.status === 'complete' ? MESSAGES.complete : 'Nivel terminado';
    celebration.show(text);
    if (state.status === 'next') message.textContent = `${text}: ${MESSAGES.next.toLowerCase()}`;
    focusNextAction();
  }

  function name(cardId) {
    if (disposed || !state || !['active', 'empty'].includes(state.status)) return;
    clearRejection();
    if (cardId == null) { feedback.notify('Nombrá una carta antes de seguir'); return; }
    const answer = reduceRecall(state, { type: 'name', cardId }, normalized.index);
    if (answer.kind === 'accepted') {
      state = answer.state;
      fan.reveal(cardsById.get(cardId), { fresh: true });
      composer.clear();
      draw();
      // La ultima pagable cierra sola (lo decide el motor): completo festeja, con falsos positivos revisa.
      if (answer.closed) {
        if (['next', 'complete'].includes(state.status)) celebrate();
        else focusNextAction();
      }
      save();   // despues del festejo: un aviso de guardado pisa al mensaje, nunca al reves
    } else if (answer.kind === 'false-positive') {
      state = answer.state;
      feedback.reject(answer.reason);
      markRejection(answer.detail);
    } else feedback.notify(answer.reason);
  }
  skip.addEventListener('click', () => {
    if (disposed || state?.status !== 'empty') return;
    const answer = reduceRecall(state, { type: 'skip' }, normalized.index);
    if (answer.kind !== 'skipped') { message.textContent = answer.reason; return; }
    state = answer.state;
    clearRejection();
    composer.clear();
    draw();
    save();
    focusNextAction();
  });
  finish.addEventListener('click', () => {
    if (disposed || state?.status !== 'active') return;
    const answer = reduceRecall(state, { type: 'finish' }, normalized.index);
    if (!['review', 'finished'].includes(answer.kind)) { message.textContent = answer.reason; return; }
    state = answer.state;
    clearRejection();
    composer.clear();
    draw();
    // Las que faltaron las marca el motor (missed); un falso positivo solo no es "faltar".
    if (outcomes.some((card) => card.outcome === 'missed')) feedback.notify('Te faltaron cartas. Revisá las que están en gris');
    // Terminé tambien completa: tras Repetir con todo hallado no queda nada por nombrar.
    if (answer.kind === 'finished') celebrate();
    else focusNextAction();
    save();
  });
  repeat.addEventListener('click', () => {
    if (disposed || state?.status !== 'review') return;
    const answer = reduceRecall(state, { type: 'repeat' }, normalized.index);
    if (answer.kind !== 'repeated') { message.textContent = answer.reason; return; }
    state = answer.state;
    clearRejection();
    celebration.hide();
    fan.setFound(cardsOf(state.found));
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
    clearRejection();
    celebration.hide();
    const created = createRecallScenario(deck, normalized.index, runSeed, level);
    if (!created.ok) { message.textContent = created.reason; return; }
    const started = previous ? advanceRecall(previous, created.scenario, normalized.index) :
      startRecall(created.scenario, normalized.index);
    if (!started.ok) { message.textContent = started.reason; return; }
    state = started.state;
    mountHand();
    draw();
    if (previous) { save(); composer?.focus(); }
  }

  if (!normalized.ok) {
    message.textContent = normalized.reason;
  } else {
    let restored;
    try { restored = storage.loadRecallSnapshot(deck, normalized.index); } catch { restored = { ok: false }; }
    if (restored?.ok) {
      state = restored.state;
      runSeed = state.scenario.seed;
      mountHand();
      draw();
    } else {
      try {
        if (typeof storage.load === 'function' && Object.hasOwn(storage.load({}), 'recall')) {
          notice.textContent = `No pudimos recuperar el progreso anterior: ${restored?.reason ?? 'datos incompatibles'}. Empezamos de nuevo; el registro anterior se reemplaza con tu primer avance.`;
        }
      } catch { /* storage bloqueado: el aviso de fallback lo maneja el store */ }
      prepare(initialLevel);
    }
  }
  return {
    ready: Promise.resolve(),
    destroy() { disposed = true; celebration.destroy(); feedback.destroy(); composer?.destroy(); fan?.destroy(); root.replaceChildren(); },
  };
}
