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

export function mountRecall(root, { deck, cards, seed, initialLevel = 1, maxLevel = 12,
  storage = defaultStore, feedbackOptions, onOpenSettings = null,
  // Al seguir despues del maximo se guarda el maximo nuevo; empezar de nuevo pide otra mesa.
  onMaxLevelChange = () => {}, newSeed = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
  // Inyectable para testear: el navegador headless no deja emular prefers-reduced-motion.
  reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  // Cuanto dura la vuelta de las cartas al mazo entre niveles. Sin movimiento, nada: se reparte al toque.
  transitionMs = reducedMotion ? 0 : 1000 }) {
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
  // Sin encabezado visible: el titulo queda para el lector de pantalla y el nivel va en la banda.
  const title = node('h1', 'sr-only', 'Recordá las cartas');
  const levelText = node('span', 'table__level');
  const table = node('section', 'table recall__table recall-band');
  table.setAttribute('aria-label', 'Mesa del rival');
  const tableHead = node('div', 'table__head');
  // Al rival se lo nombra como en la mesa: "Kai'Sa, Daughter of the Void". La leyenda trae sólo el
  // título; el nombre del campeón sale de su carta. Sin alguna de las dos, el nombre del mazo.
  const legendCard = cardsById.get(deck?.legend);
  const champName = cardsById.get(deck?.champion)?.baseName;
  const rivalName = legendCard && champName ? `${champName}, ${legendCard.name}` : (deck?.name ?? 'Mazo');
  tableHead.append(node('span', 'table__deck', rivalName), levelText);
  if (onOpenSettings) {
    const gear = node('button', 'table__settings');
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Configuración');
    gear.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    gear.addEventListener('click', () => onOpenSettings(gear));
    tableHead.appendChild(gear);
  }
  const board = node('div', 'board');
  const publicCards = node('div', 'legend');
  publicCards.setAttribute('aria-label', 'Leyenda y campeón');
  const runes = node('div', 'runes');
  runes.setAttribute('aria-label', 'Runas en mesa');
  board.append(publicCards, runes);
  const missing = node('span', 'runes__missing');
  missing.setAttribute('role', 'note');
  missing.hidden = true;
  table.append(title, tableHead, board);
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
  // Empezar de nuevo: un icono de reinicio (como el engranaje), con su nombre para el lector.
  const restart = button('', 'restart', true);
  restart.classList.add('btn--icon');
  restart.setAttribute('aria-label', 'Empezar de nuevo');
  restart.title = 'Empezar de nuevo';
  restart.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  controls.append(skip, finish, repeat, restart, next);
  // Tres zonas: banda, mano, dock. El dock junta lo que se contesta y lo que avisa.
  const info = node('div', 'recall__info');
  info.append(feedbackHost, notice, message);
  const dock = node('div', 'recall-dock');
  dock.append(prompt, inputHost, controls, info);
  panel.append(table, fanHost, dock);
  root.replaceChildren(panel);
  // Fuera del panel: la grilla de la pantalla son tres zonas y el festejo no es una de ellas.
  const celebration = mountCelebration(root, { reducedMotion });
  const searchCards = normalized.ok ? normalized.index.fullCards.map(({ id }) => cardsById.get(id)) : [];

  function showBoard(scenario) {
    // Sin "de N": el maximo sólo se nombra al llegar (o si se bajo por debajo del nivel en curso).
    const atMax = scenario.level >= (state?.maxLevel ?? maxLevel);
    levelText.textContent = atMax ? 'Nivel Max' : `Nivel ${scenario.level}`;
    levelText.classList.toggle('table__level--max', atMax);
    publicCards.replaceChildren();
    for (const id of [deck.legend, deck.champion]) {
      const card = cardsById.get(id);
      if (card) publicCards.appendChild(renderCard(card, { faceUp: true }));
    }
    runes.replaceChildren();
    const open = scenario.runes.filter((r) => r.ready).length;
    const exhausted = scenario.runes.length - open;
    // El resumen no se ve (las runas ya lo muestran): lo lee el lector de pantalla con el grupo.
    runes.setAttribute('aria-label',
      `Runas en mesa: ${open} ${open === 1 ? 'abierta' : 'abiertas'} · ${exhausted} ${exhausted === 1 ? 'agotada' : 'agotadas'} · ${scenario.deckRemaining} en el Mazo de Runas`);
    const meta = node('span', 'runes__meta');
    // La marca del dominio ausente vive en una linea propia: nunca empuja las runas a otra fila.
    missing.hidden = true;
    meta.appendChild(missing);
    runes.appendChild(meta);
    for (const rune of scenario.runes) runes.appendChild(renderRune(rune));
  }

  /** Rechazo visible: las runas que lo explican, o el dominio que falta. El motor decide cuales. */
  function markRejection(detail) {
    const { indices, missingDomain, missingDomains = [] } = rejectionRunes(detail, state.scenario.runes);
    const nodes = runes.querySelectorAll('.rune');
    for (const i of indices) nodes[i]?.setAttribute('data-highlight', 'true');
    // Un dominio (Pide 1 Fury) o los dos de una carta de dos dominios (Calm o Chaos).
    const absent = missingDomain ? [missingDomain] : missingDomains;
    if (absent.length) {
      missing.dataset.domain = absent.join(' ');
      missing.textContent = `Sin runas ${absent.map((d) => DOMAIN_LABEL[d] ?? d).join(' ni ')} en mesa`;
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
    // Cada mano nueva se reparte desde el mazo (sin movimiento, aparece quieta).
    fan = mountRivalFan(fanHost, { size: state.payable.length, deal: !reducedMotion });
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
    // Terminar no es un callejon sin salida: antes del 12 se puede seguir, y siempre empezar de nuevo.
    const terminal = ['complete', 'omitted'].includes(state.status);
    skip.hidden = state.status !== 'empty';
    next.hidden = !(state.status === 'next' || (terminal && state.scenario.level < 12));
    restart.hidden = !terminal;
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
    // Lo que sigue: repetir, el siguiente nivel o empezar de nuevo. Sin nada, el mensaje final.
    ([repeat, next, restart].find((item) => !item.hidden) ?? message).focus();
  }

  /** Cierre completo: el unico festejo de la ronda. El anuncio accesible es el mensaje de estado. */
  function celebrate() {
    const text = state.status === 'complete' ? MESSAGES.complete : 'Nivel terminado';
    celebration.show(text);
    if (state.status === 'next') {
      message.textContent = state.payable.length
        ? `${text}: ${MESSAGES.next.toLowerCase()}`
        : `${text}: con esta mesa el rival no podía pagar ninguna carta`;
    }
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
      // La ultima pagable cierra sola (lo decide el motor). Terminar un nivel siempre se festeja,
      // tambien en revision (decision del usuario, 2026-11-09).
      if (answer.closed) celebrate();
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
    celebrate();
    save();
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
    celebrate();
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
    // Si sólo fallaron falsos positivos no queda nada por nombrar: el motor ya cerró completo.
    if (answer.closed) celebrate();
    else composer.focus();
    save();
  });
  next.addEventListener('click', () => {
    if (disposed || !state) return;
    if (['complete', 'omitted'].includes(state.status)) {
      // Despues del maximo: se sube en uno, se guarda y se sigue (nunca se juega por encima del maximo).
      const answer = reduceRecall(state, { type: 'extend', maxLevel: state.scenario.level + 1 }, normalized.index);
      if (answer.kind !== 'extended') { message.textContent = answer.reason; return; }
      state = answer.state;
      maxLevel = state.maxLevel;
      onMaxLevelChange(maxLevel);
    }
    if (state.status !== 'next') return;
    const previous = state;
    transition(() => prepare(previous.nextLevel, previous));
  });
  restart.addEventListener('click', () => {
    if (disposed || !['complete', 'omitted'].includes(state?.status)) return;
    // Otra mesa desde el nivel de inicio, con el mismo maximo; el recorrido anterior se reemplaza.
    // La semilla nueva se adopta solo si la mesa se puede crear: si no, sigue todo como estaba.
    const seedNext = newSeed();
    const created = createRecallScenario(deck, normalized.index, seedNext, initialLevel);
    if (!created.ok) { message.textContent = created.reason; return; }
    const seedBefore = runSeed;
    runSeed = seedNext;
    transition(() => {
      if (!prepare(initialLevel)) { runSeed = seedBefore; return false; }
      save();
      // Un nivel sin pagables no tiene input activo: el foco va a Saltar, no al <body>.
      if (state.status === 'empty') skip.focus(); else composer?.focus();
      return true;
    });
  });

  /**
   * Entre niveles las cartas se dan vuelta y vuelven al mazo; recien despues se reparte la mano
   * nueva. Un segundo clic durante la vuelta no hace nada.
   */
  let pending = Promise.resolve();
  let busy = false;
  function transition(then) {
    if (busy) return;
    busy = true;
    celebration.hide();
    // El boton tocado se deshabilita: el foco espera en el mensaje en vez de caer al <body>.
    message.focus();
    for (const item of [next, restart]) item.disabled = true;
    pending = fan.collect(transitionMs).then(() => {
      busy = false;
      for (const item of [next, restart]) item.disabled = false;
      if (disposed) return;
      // Si el nivel siguiente no se pudo armar, la mano vuelve del mazo y se sigue como estaba.
      if (then() === false) { fan.uncollect(); focusNextAction(); }
    });
  }

  /** Arranca (o avanza a) un nivel: todo es sincrono, no hay objetivo que calcular aparte. */
  function prepare(level, previous = null) {
    if (disposed) return false;
    clearRejection();
    celebration.hide();
    const created = createRecallScenario(deck, normalized.index, runSeed, level);
    if (!created.ok) { message.textContent = created.reason; return false; }
    const started = previous ? advanceRecall(previous, created.scenario, normalized.index) :
      startRecall(created.scenario, normalized.index, { maxLevel });
    if (!started.ok) { message.textContent = started.reason; return false; }
    state = started.state;
    mountHand();
    draw();
    if (previous) { save(); composer?.focus(); }
    return true;
  }

  if (!normalized.ok) {
    message.textContent = normalized.reason;
  } else {
    let restored;
    try { restored = storage.loadRecallSnapshot(deck, normalized.index, { maxLevel, startLevel: initialLevel }); } catch { restored = { ok: false }; }
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
    /** Termina cuando termina la vuelta al mazo en curso (o enseguida si no hay ninguna). */
    idle: () => pending,
    destroy() { disposed = true; celebration.destroy(); feedback.destroy(); composer?.destroy(); fan?.destroy(); root.replaceChildren(); },
  };
}
