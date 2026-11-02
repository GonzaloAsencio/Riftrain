/** Mountable controller for whole-main recall; the engine alone decides validity. */
import { normalizeDeck, countGroupsAsync, createMissingPager } from '../engine/deck-combos.js';
import { createRecallScenario } from '../engine/recall-scenario.js';
import { startRecall, reduceRecall, advanceRecall } from '../engine/recall-progress.js';
import * as defaultStore from '../store.js';
import { renderCard } from './card.js';
import { renderRune } from './rune.js';
import { mountComposer } from './composer.js';
import { mountComboResults } from './combo-results.js';
import { mountRecallFeedback } from './recall-feedback.js';

const node = (tag, cls, text) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text != null) item.textContent = text;
  return item;
};

export function mountRecall(root, { deck, cards, seed, initialLevel = 1,
  storage = defaultStore, scheduler = () => new Promise((done) => setTimeout(done, 0)), feedbackOptions }) {
  let disposed = false;
  let generation = 0;
  let abort = new AbortController();
  let state = null;
  let runSeed = seed;
  let composer = null;
  let gallery = null;
  let missingGallery = null;
  let missingAbort = null;
  let missingGeneration = 0;
  const normalized = normalizeDeck(deck, cards, { policy: 'positive-energy' });
  const panel = node('section', 'recall');
  const head = node('header', 'recall__head');
  const title = node('h1', null, 'Recordá las jugadas');
  const levelText = node('span', 'recall__level');
  head.append(title, levelText);
  const table = node('section', 'table recall__table');
  table.setAttribute('aria-label', 'Mesa del rival');
  const tableHead = node('div', 'table__head');
  const deckName = node('span', 'table__deck', deck?.name ?? 'Mazo');
  tableHead.appendChild(deckName);
  const board = node('div', 'board');
  const publicCards = node('div', 'legend');
  publicCards.setAttribute('aria-label', 'Leyenda y campeón');
  const runes = node('div', 'runes');
  runes.setAttribute('aria-label', 'Runas en mesa');
  board.append(publicCards, runes);
  table.append(tableHead, board);
  const prompt = node('p', 'ask', '¿Qué combinaciones puede pagar con esta mesa?');
  prompt.appendChild(node('span', 'ask__hint', 'Las cartas de Energía 0 no cuentan en este entrenamiento.'));
  const feedbackHost = node('div', 'recall__feedback');
  table.appendChild(feedbackHost);
  const feedback = mountRecallFeedback(feedbackHost, feedbackOptions);
  const message = node('p', 'recall__message', 'Calculando jugadas…');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const notice = node('p', 'recall__notice');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  const inputHost = node('div', 'recall__input');
  const controls = node('div', 'recall__controls');
  const skip = node('button', 'btn btn--ghost', 'Saltar este nivel');
  skip.type = 'button'; skip.dataset.action = 'skip';
  const next = node('button', 'btn', 'Siguiente nivel');
  next.type = 'button'; next.dataset.action = 'next';
  const finish = node('button', 'btn btn--ghost', 'Terminé');
  finish.type = 'button'; finish.dataset.action = 'finish';
  const repeat = node('button', 'btn', 'Repetir nivel (seguir buscando)');
  repeat.type = 'button'; repeat.dataset.action = 'repeat';
  skip.hidden = true;
  next.hidden = true;
  finish.hidden = true;
  repeat.hidden = true;
  controls.append(skip, finish, repeat, next);
  const results = node('div', 'recall__results');
  const missed = node('div', 'recall-missed');
  panel.append(head, table, prompt, notice, message, inputHost, controls, results, missed);
  root.replaceChildren(panel);
  const indexedCards = normalized.ok ? normalized.index.cards.map((entry) => cards.find((card) => card.id === entry.id)) : [];
  const cardsById = new Map(cards.map((card) => [card.id, card]));

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

  function cancelMissing() {
    missingAbort?.abort();
    missingGeneration++;
    missingGallery?.destroy();
    missingGallery = null;
    missed.replaceChildren();
  }

  async function showMissing() {
    cancelMissing();
    if (disposed || state?.status !== 'review') return;
    const signal = new AbortController();
    missingAbort = signal;
    const token = missingGeneration;
    const pager = createMissingPager(normalized.index, state.scenario, state.target, state.found,
      { signal: signal.signal, yieldTo: scheduler });
    if (!pager.ok) { message.textContent = pager.reason; return; }
    async function loadPage(number) {
      const result = await pager.page(number);
      if (disposed || token !== missingGeneration || state?.status !== 'review' || result.status === 'pending') return;
      if (result.status !== 'exact') { message.textContent = result.reason; return; }
      if (!missingGallery) missingGallery = mountComboResults(missed, {
        cardsById, found: result.groups, title: 'Jugadas que faltaron', result: 'missed',
        total: result.total, onPage: loadPage,
      });
      else missingGallery.setRemotePage(result.groups, number, result.total);
    }
    await loadPage(0);
  }

  function draw() {
    if (!state || disposed) return;
    showBoard(state.scenario);
    const exact = state.target.status === 'exact';
    const active = state.status === 'active' && exact;
    const searchable = exact && (active || state.status === 'empty');
    const waiting = state.status === 'active' && !exact;
    if (searchable && !composer) composer = mountComposer(inputHost, {
      cards: indexedCards, index: normalized.index, onConfirm: confirm,
      onUserEdit: () => feedback.reset(),
    });
    if (composer) composer.setDisabled(!searchable);
    const visible = [
      ...state.history.flatMap(({ level, found }) => found.map((group) => ({ ...group, level }))),
      ...state.found.map((group) => ({ ...group, level: state.scenario.level })),
    ];
    if (!gallery) gallery = mountComboResults(results, { cardsById, found: visible });
    else gallery.setFound(visible);
    skip.hidden = state.status !== 'empty';
    next.hidden = state.status !== 'next';
    finish.hidden = !(state.status === 'active' && exact && state.target.count > 0n);
    repeat.hidden = state.status !== 'review';
    if (state.status === 'empty' || state.status === 'complete' || state.status === 'omitted') {
      message.textContent = state.status === 'empty' ? 'No hay jugadas para este ejercicio; podés saltarlo' : state.message;
    } else if (waiting) message.textContent = 'Todavía no se pudo verificar el objetivo';
    else if (state.status === 'next') message.textContent = 'Encontraste todas las jugadas de este nivel';
    else if (state.status === 'review') message.textContent = 'Las que faltaron están en gris. Podés seguir buscando en esta mesa.';
    else message.textContent = `${state.found.length} ${state.found.length === 1 ? 'jugada descubierta' : 'jugadas descubiertas'}`;
    if (state.status === 'review' && !missingGallery) return showMissing();
  }

  function confirm(entries) {
    if (disposed || !state || !['active', 'empty'].includes(state.status) || state.target.status !== 'exact') return;
    const answer = reduceRecall(state, { type: 'confirm', entries }, normalized.index);
    if (answer.kind !== 'accepted') {
      feedback.dismiss();
      message.textContent = answer.reason;
      return;
    }
    state = answer.state;
    feedback.revealGroup(answer.state.found.at(-1).group, cardsById, normalized.index);
    composer.clear();
    draw();
    save();
  }
  skip.addEventListener('click', () => {
    if (disposed || state?.status !== 'empty') return;
    const answer = reduceRecall(state, { type: 'skip' }, normalized.index);
    if (answer.kind !== 'skipped') { message.textContent = answer.reason; return; }
    state = answer.state;
    draw();
    save();
  });
  finish.addEventListener('click', () => {
    if (disposed || state?.status !== 'active' || state.target.status !== 'exact') return;
    const answer = reduceRecall(state, { type: 'finish' }, normalized.index);
    if (!['review', 'finished'].includes(answer.kind)) { message.textContent = answer.reason; return; }
    state = answer.state;
    feedback.dismiss();
    composer?.clear();
    draw();
    save();
  });
  repeat.addEventListener('click', () => {
    if (disposed || state?.status !== 'review') return;
    const answer = reduceRecall(state, { type: 'repeat' }, normalized.index);
    if (answer.kind !== 'repeated') { message.textContent = answer.reason; return; }
    cancelMissing();
    feedback.dismiss();
    state = answer.state;
    draw();
    save();
  });
  next.addEventListener('click', async () => {
    if (disposed || state?.status !== 'next') return;
    next.disabled = true;
    await prepare(state.nextLevel, state);
  });

  async function prepare(level, previous = null) {
    if (disposed) return;
    abort.abort();
    feedback.reset();
    cancelMissing();
    abort = new AbortController();
    const token = ++generation;
    inputHost.replaceChildren();
    composer = null;
    next.hidden = true;
    skip.hidden = true;
    message.textContent = 'Calculando jugadas…';
    const created = createRecallScenario(deck, normalized.index, runSeed, level);
    if (!created.ok) { message.textContent = created.reason; return; }
    showBoard(created.scenario);
    const target = await countGroupsAsync(normalized.index, created.scenario.runes,
      { yieldTo: scheduler, signal: abort.signal });
    if (disposed || token !== generation || target.status === 'pending') return;
    if (target.status !== 'exact') { message.textContent = target.reason ?? 'No se pudo calcular el objetivo'; return; }
    const started = previous ? advanceRecall(previous, created.scenario, normalized.index, target) :
      startRecall(created.scenario, normalized.index, target);
    if (!started.ok) { message.textContent = started.reason; return; }
    state = started.state;
    draw();
    if (previous) save();
    next.disabled = false;
  }

  let ready;
  if (!normalized.ok) {
    message.textContent = normalized.reason;
    ready = Promise.resolve();
  } else {
    let restored;
    try { restored = storage.loadRecallSnapshot(deck, normalized.index); } catch { restored = { ok: false }; }
    if (restored?.ok) {
      state = restored.state;
      runSeed = state.scenario.seed;
      if (restored.migrated) {
        notice.textContent = restored.warning ?? 'Progreso anterior adaptado al entrenamiento sin Energía 0';
        notice.hidden = false;
      }
      ready = Promise.resolve(draw());
    } else {
      try {
        if (typeof storage.load === 'function' && Object.hasOwn(storage.load({}), 'recall')) {
          notice.textContent = `No pudimos recuperar el progreso anterior: ${restored?.reason ?? 'datos incompatibles'}. Conservamos el registro hasta que confirmes una nueva jugada.`;
          notice.hidden = false;
        }
      } catch { /* storage bloqueado: el aviso de fallback lo maneja el store */ }
      ready = prepare(initialLevel);
    }
  }
  return {
    ready,
    destroy() { disposed = true; generation++; abort.abort(); cancelMissing(); feedback.destroy(); composer?.destroy(); gallery?.destroy(); root.replaceChildren(); },
  };
}
