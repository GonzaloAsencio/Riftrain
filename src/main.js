/**
 * El loop del entrenador.
 *
 * Ciclo cerrado: abrir -> responder -> ver -> siguiente. Sin menus intermedios,
 * sin pantalla de inicio, sin selector de dificultad. Abre y ya hay una mano
 * boca abajo esperando.
 */

import { generateScenario, QUESTION } from './engine/scenario.js';
import { DOMAIN_COLOR, DOMAIN_LABEL, projectRunes, RUNE_DECK_SIZE } from './engine/runes.js';
import { cardCost, costLabel, availableRunes } from './engine/cost.js';
import { search, resolve } from './engine/match.js';
import * as prog from './engine/progression.js';
import * as store from './store.js';
import { Hand } from './ui/hand.js';
import { renderCard } from './ui/card.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const ui = {
  streak: $('streak'), streakN: $('streak').querySelector('.streak__n'),
  level: $('level'), timer: $('timer'),
  turn: $('turn'), deck: $('deck'), runes: $('runes'),
  hand: $('hand'), ask: $('ask'),
  picks: $('input-picks'), type: $('input-type'), field: $('type-field'),
  suggest: $('suggest'), num: $('input-num'), named: $('named'),
  primary: $('btn-primary'), skip: $('btn-skip'), verdict: $('verdict'),
  chipReview: $('chip-review'), chipSeed: $('chip-seed'), phBanner: $('ph-banner'),
  btnStats: $('btn-stats'), btnMode: $('btn-mode'),
};

const MODE = { CARDS: 'cards', RUNES: 'runes' };

const app = {
  data: null,
  cardsById: new Map(),
  state: prog.emptyState(),
  mode: MODE.CARDS,
  scenario: null,
  next: null,          // pre-generado mientras respondo el actual
  hand: null,
  named: [],           // ids ya nombrados esta ronda
  answered: false,
  t0: 0,
  timerId: null,
  suggestIndex: -1,
};

// ---------------------------------------------------------------- arranque

async function boot() {
  const res = await fetch('data/cards.json');
  app.data = await res.json();
  app.cardsById = new Map(app.data.cards.map((c) => [c.id, c]));

  app.state = store.load(prog.emptyState());

  if (app.data._placeholder) {
    ui.phBanner.textContent =
      'Datos de andamio: estas cartas NO son reales de Riftbound. Reemplaza data/cards.json por tus decklists.';
    ui.phBanner.classList.remove('hidden');
  }
  if (store.isMemoryOnly()) {
    ui.phBanner.textContent += ' (El navegador bloquea el almacenamiento: el progreso no va a sobrevivir al cierre.)';
    ui.phBanner.classList.remove('hidden');
  }

  ui.primary.addEventListener('click', onPrimary);
  ui.skip.addEventListener('click', () => finishRound());
  ui.btnMode.addEventListener('click', toggleMode);
  ui.btnStats.addEventListener('click', showStats);
  ui.field.addEventListener('input', onType);
  ui.field.addEventListener('keydown', onTypeKeys);

  round();
}

function ctx(level = app.state.level) {
  return { decks: app.data.decks, cardsById: app.cardsById, level };
}

/** Pre-genera el escenario siguiente mientras el jugador responde el actual. */
function pregenerate() {
  const peek = { ...app.state, answered: app.state.answered + 1 };
  const { seed, isReview } = prog.nextSeed(peek);
  try {
    app.next = { scenario: generateScenario(seed, ctx()), isReview };
  } catch {
    app.next = null;
  }
}

// ---------------------------------------------------------------- ronda

function round() {
  const picked = app.next ?? (() => {
    const { seed, isReview } = prog.nextSeed(app.state);
    return { scenario: generateScenario(seed, ctx()), isReview };
  })();
  app.next = null;

  app.scenario = picked.scenario;
  app.named = [];
  app.answered = false;
  app.suggestIndex = -1;

  paintChrome(picked.isReview);
  paintTable();

  // La mano se monta BOCA ABAJO, antes de cualquier pregunta.
  app.hand = new Hand(ui.hand, app.scenario.hand);

  if (app.mode === MODE.RUNES) paintRuneQuestion();
  else paintCardQuestion();

  ui.verdict.classList.add('hidden');
  ui.verdict.textContent = '';
  ui.named.textContent = '';
  ui.primary.textContent = 'Confirmar';
  ui.primary.disabled = false;

  startTimer();
  pregenerate();
}

function paintChrome(isReview) {
  ui.streakN.textContent = String(app.state.streak);
  ui.streak.classList.toggle('streak--hot', app.state.streak >= 3);
  ui.level.textContent = `Nivel ${app.state.level}`;
  ui.chipReview.classList.toggle('hidden', !isReview);
  ui.chipSeed.textContent = `#${(app.scenario.seed >>> 0).toString(36).toUpperCase().slice(-5)}`;
  ui.chipSeed.classList.remove('hidden');
}

function paintTable() {
  const s = app.scenario;
  ui.turn.textContent = `Turno ${s.turn}`;
  ui.deck.textContent = s.deckName;

  ui.runes.textContent = '';
  for (const r of s.runes) {
    const n = el('div', 'rune' + (r.ready ? '' : ' rune--spent'), DOMAIN_LABEL[r.domain][0]);
    n.style.background = DOMAIN_COLOR[r.domain];
    n.title = `${DOMAIN_LABEL[r.domain]}${r.ready ? '' : ' (agotada)'}`;
    ui.runes.appendChild(n);
  }
  const avail = availableRunes(s.runes);
  const meta = el('span', 'runes__meta',
    avail.total === s.runes.length
      ? `${avail.total} abiertas`
      : `${avail.total} abiertas de ${s.runes.length} en mesa`);
  ui.runes.appendChild(meta);
}

// ---------------------------------------------------------------- modo cartas

function paintCardQuestion() {
  const s = app.scenario;
  const avail = availableRunes(s.runes).total;

  ui.ask.textContent = `Con ${avail} runas abiertas en el turno ${s.turn}, ¿que cartas puede jugar?`;
  const hint = el('span', 'ask__hint',
    s.level >= 3
      ? 'Nombralas de memoria. Se dan vuelta a medida que le pegues.'
      : 'Marca las que puede pagar.');
  ui.ask.appendChild(hint);

  hideInputs();
  ui.skip.classList.remove('hidden');
  ui.skip.textContent = 'No hay mas';

  if (s.level <= 2) paintPicks(s);
  else paintTypeInput(s);
}

/** Niveles 1 y 2: RECONOCIMIENTO. Las opciones estan a la vista. */
function paintPicks(s) {
  const rng = (n) => Math.floor(Math.random() * n);
  let options;

  if (s.level === 1) {
    options = s.hand.slice(0, 5);
  } else {
    // Nivel 2: 12 cartas, la mitad NO son de este mazo. Entrena el arquetipo.
    const deck = app.data.decks.find((d) => d.id === s.deckId);
    const propias = new Set(deck.cards.map((c) => c.cardId));
    const ajenas = app.data.cards.filter((c) => !propias.has(c.id));
    const senuelos = [];
    while (senuelos.length < 6 && ajenas.length) {
      const c = ajenas[rng(ajenas.length)];
      if (!senuelos.includes(c)) senuelos.push(c);
    }
    const propiasVisibles = [...new Map(s.hand.map((c) => [c.id, c])).values()].slice(0, 6);
    options = [...propiasVisibles, ...senuelos].sort(() => Math.random() - 0.5);
  }

  ui.picks.textContent = '';
  ui.picks.classList.remove('hidden');
  for (const card of options) {
    const b = el('button', 'pick');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(el('span', null, card.name));
    b.appendChild(el('span', 'pick__cost', costLabel(cardCost(card))));
    b.addEventListener('click', () => {
      if (app.answered) return;
      const on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', on ? 'false' : 'true');
      if (on) app.named = app.named.filter((id) => id !== card.id);
      else app.named.push(card.id);
    });
    ui.picks.appendChild(b);
  }
}

/** Niveles 3 y 4: EVOCACION. La carta se dibuja recien cuando la nombro. */
function paintTypeInput(s) {
  ui.type.classList.remove('hidden');
  ui.field.value = '';
  ui.field.placeholder = s.level === 3 ? 'Nombra una carta…' : 'Escribila de memoria…';
  ui.field.focus({ preventScroll: true });
}

function deckCards() {
  const deck = app.data.decks.find((d) => d.id === app.scenario.deckId);
  return deck.cards.map((c) => app.cardsById.get(c.cardId)).filter(Boolean);
}

function onType() {
  // Nivel 4: SIN autocompletado. Evocacion en frio.
  if (app.scenario.level >= 4) return;
  const q = ui.field.value;
  const hits = search(q, deckCards(), { limit: 6 });
  renderSuggest(hits);
}

function renderSuggest(cards) {
  ui.suggest.textContent = '';
  app.suggestIndex = -1;
  if (!cards.length) { ui.suggest.classList.add('hidden'); return; }
  cards.forEach((card, i) => {
    const b = el('button', 'suggest__item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', 'false');
    b.dataset.i = String(i);
    b.appendChild(el('span', null, card.name));
    b.appendChild(el('span', 'suggest__cost', costLabel(cardCost(card))));
    b.addEventListener('click', () => nameCard(card));
    ui.suggest.appendChild(b);
  });
  ui.suggest.classList.remove('hidden');
}

function onTypeKeys(e) {
  const items = [...ui.suggest.querySelectorAll('.suggest__item')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    app.suggestIndex = (app.suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((it, i) => it.setAttribute('aria-selected', String(i === app.suggestIndex)));
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (app.suggestIndex >= 0 && items[app.suggestIndex]) { items[app.suggestIndex].click(); return; }
    submitTyped();
  }
}

function submitTyped() {
  const q = ui.field.value.trim();
  if (!q) { finishRound(); return; }

  // Nivel 3 busca sobre el mazo; nivel 4 sobre todas las cartas cargadas.
  const pool = app.scenario.level >= 4 ? app.data.cards : deckCards();
  const r = resolve(q, pool);

  if (!r.card) {
    flashField(r.reason === 'ambiguous' ? 'Ambiguo, se mas preciso' : 'No reconozco esa carta');
    return;
  }
  nameCard(r.card);
}

function flashField(msg) {
  ui.field.value = '';
  ui.field.placeholder = msg;
  setTimeout(() => { ui.field.placeholder = 'Nombra una carta…'; }, 1400);
}

/**
 * Nombro una carta: se da vuelta AHI MISMO si esta en la mano.
 * Si no esta, entra igual al abanico, tachada y con borde rojo.
 */
function nameCard(card) {
  if (app.answered) return;
  app.named.push(card.id);

  const { hit } = app.hand.reveal(card.id);
  if (!hit) app.hand.addFalsePositive(card);

  ui.named.appendChild(el('span', 'named__tag', card.name));
  ui.field.value = '';
  ui.suggest.classList.add('hidden');
  ui.field.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- modo runas

const RUNE_Q = ['count', 'max', 'when', 'pay'];

function paintRuneQuestion() {
  const s = app.scenario;
  const idx = (s.seed >>> 3) % RUNE_Q.length;
  s.runeQuestion = RUNE_Q[idx];
  const board = s.runes.length;
  const horizon = 4;

  const proj = projectRunes({ startBoard: board, startTurn: s.turn + 1, turns: horizon });
  s.runeProjection = proj;

  let text;
  switch (s.runeQuestion) {
    case 'count':
      s.runeTarget = s.turn + 3;
      s.runeAnswer = proj.steps[2].after;
      text = `Tiene ${board} runas en mesa en el turno ${s.turn}. Si no recicla, ¿cuantas va a tener al final del turno ${s.runeTarget}?`;
      break;
    case 'max':
      s.runeAnswer = proj.max;
      text = `Con ${board} runas en el turno ${s.turn} y sin reciclar, ¿cual es el maximo que alcanza en los proximos ${horizon} turnos?`;
      break;
    case 'when': {
      const target = Math.min(RUNE_DECK_SIZE, board + 4);
      s.runeK = target;
      const hit = proj.steps.find((st) => st.after >= target);
      s.runeAnswer = hit ? hit.turn : 0;
      text = `Tiene ${board} runas en el turno ${s.turn}. ¿En que turno llega a ${target}? (0 si no llega en ${horizon} turnos)`;
      break;
    }
    case 'pay': {
      const avail = availableRunes(s.runes).total;
      const energia = Math.max(1, Math.floor(avail / 2));
      const poder = 1;
      s.runeCost = { energia, poder };
      s.runeAnswer = energia + poder <= avail ? 1 : 0;
      text = `Con ${avail} runas abiertas, ¿puede pagar ${energia} de Energia + ${poder} de Poder? (1 = si, 0 = no)`;
      break;
    }
  }

  ui.ask.textContent = text;
  hideInputs();
  ui.skip.classList.add('hidden');
  paintNumpad();
}

/**
 * El teclado muestra SIEMPRE el rango completo 0-12.
 * Nunca cuatro opciones plausibles: eso regala la respuesta.
 */
function paintNumpad() {
  ui.num.textContent = '';
  ui.num.classList.remove('hidden');
  app.numChoice = null;
  for (let i = 0; i <= RUNE_DECK_SIZE; i++) {
    const b = el('button', null, String(i));
    b.type = 'button';
    b.className = 'num';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (app.answered) return;
      [...ui.num.children].forEach((c) => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      app.numChoice = i;
    });
    ui.num.appendChild(b);
  }
}

// ---------------------------------------------------------------- cierre

function onPrimary() {
  if (app.answered) { round(); return; }
  finishRound();
}

function finishRound() {
  if (app.answered) return;
  app.answered = true;
  stopTimer();
  const ms = performance.now() - app.t0;

  ui.suggest.classList.add('hidden');
  ui.skip.classList.add('hidden');
  ui.primary.textContent = 'Siguiente';

  const result = app.mode === MODE.RUNES ? closeRuneRound(ms) : closeCardRound(ms);

  app.state = prog.record(app.state, result);
  store.save(app.state);
  paintChrome(false);
  pregenerate();
}

function closeCardRound(ms) {
  const s = app.scenario;
  const solution = s.solution;
  const playableIds = solution.playableIds;

  // EL CIERRE: las que no nombre se dan vuelta solas, en blanco y negro,
  // en la MISMA fila, al lado de las que acerte en color.
  app.hand.revealRest();
  const summary = app.hand.summary();

  // Acertar = nombrar una carta de la mano que ADEMAS era jugable.
  const hitIds = summary.hits.map((c) => c.id);
  const correctos = hitIds.filter((id) => playableIds.includes(id));
  const expected = new Set(playableIds).size;
  const missedIds = playableIds.filter((id) => !hitIds.includes(id));

  // Falsos positivos: la nombre y no estaba en la mano, o estaba pero NO era jugable.
  const fpFueraDeMano = summary.falsePositives.map((c) => c.id);
  const fpNoJugables = hitIds.filter((id) => !playableIds.includes(id));
  const falsePositiveIds = [...fpFueraDeMano, ...fpNoJugables];

  paintVerdict({
    hits: correctos.length, expected,
    falsePositives: falsePositiveIds.length,
    rows: buildWhyRows(s),
  });

  return {
    seed: s.seed, question: s.question, deckId: s.deckId, turn: s.turn,
    hits: correctos.length, expected,
    falsePositives: falsePositiveIds.length,
    missedIds, falsePositiveIds, ms,
  };
}

function buildWhyRows(s) {
  return s.solution.verdicts.map((v) => ({
    ok: v.ok,
    name: v.card.name,
    cost: costLabel(v.cost),
    reason: v.ok
      ? `${v.cost.runes} runas: ${v.cost.energy} agotadas${v.cost.powerTotal ? ` + ${v.cost.powerTotal} reciclada${v.cost.powerTotal > 1 ? 's' : ''}` : ''}`
      : v.reason,
  }));
}

function closeRuneRound(ms) {
  const s = app.scenario;
  const ok = app.numChoice === s.runeAnswer;

  const chain = el('div', 'chain');
  for (const st of s.runeProjection.steps) {
    const line = el('div');
    line.innerHTML = `T${st.turn}: ${st.before} − ${st.recycled} + ${st.channeled} = <b>${st.after}</b>`;
    chain.appendChild(line);
  }

  paintVerdict({
    hits: ok ? 1 : 0, expected: 1, falsePositives: 0,
    extra: chain,
    headline: ok ? 'Bien' : `Era ${s.runeAnswer}`,
  });

  return {
    seed: s.seed, question: `rune-${s.runeQuestion}`, deckId: s.deckId, turn: s.turn,
    hits: ok ? 1 : 0, expected: 1, falsePositives: 0,
    missedIds: [], falsePositiveIds: [], ms,
  };
}

function paintVerdict({ hits, expected, falsePositives, rows = [], extra = null, headline = null }) {
  ui.verdict.textContent = '';
  ui.verdict.classList.remove('hidden');
  const perfect = hits === expected && falsePositives === 0;
  ui.verdict.className = `verdict verdict--${perfect ? 'ok' : 'bad'}`;

  const head = el('div', 'verdict__head');
  head.appendChild(el('span', null, headline ?? (perfect ? 'Las viste todas' : 'Se te escaparon')));
  const score = falsePositives
    ? `${hits}/${expected} · ${falsePositives} de mas`
    : `${hits}/${expected}`;
  head.appendChild(el('span', 'verdict__score num', score));
  ui.verdict.appendChild(head);

  if (extra) ui.verdict.appendChild(extra);

  if (rows.length) {
    const why = el('div', 'why');
    for (const r of rows) {
      const row = el('div', `why__row why__row--${r.ok ? 'yes' : 'no'}`);
      row.appendChild(el('span', 'why__mark', r.ok ? '✓' : '✕'));
      const body = el('span');
      body.appendChild(el('span', 'why__name', `${r.name} (${r.cost}) `));
      body.appendChild(el('span', 'why__reason', r.reason));
      row.appendChild(body);
      why.appendChild(row);
    }
    ui.verdict.appendChild(why);
  }
}

// ---------------------------------------------------------------- varios

function hideInputs() {
  ui.picks.classList.add('hidden');
  ui.type.classList.add('hidden');
  ui.num.classList.add('hidden');
  ui.suggest.classList.add('hidden');
}

function toggleMode() {
  app.mode = app.mode === MODE.CARDS ? MODE.RUNES : MODE.CARDS;
  ui.btnMode.textContent = app.mode === MODE.RUNES ? 'C' : 'R';
  ui.btnMode.title = app.mode === MODE.RUNES ? 'Ir al modo cartas' : 'Ir al modo runas';
  round();
}

function showStats() {
  const st = prog.stats(app.state);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lines = [
    `Respondidas: ${st.answered}`,
    `Precision: ${pct(st.accuracy)} · perfectas ${pct(st.perfectRate)}`,
    `Mejor racha: ${st.bestStreak} · nivel ${st.level}`,
    st.medianMs ? `Tiempo mediano: ${(st.medianMs / 1000).toFixed(1)}s` : null,
    st.weakest ? `Punto debil: ${st.weakest.dim} "${st.weakest.key}" (${pct(st.weakest.acc)})` : null,
    st.reviewPending ? `En cola de repaso: ${st.reviewPending}` : null,
    st.topMissed.length ? `Mas perdidas: ${st.topMissed.map((m) => nameOf(m.id) + ' x' + m.count).join(', ')}` : null,
    st.topFalsePositives.length ? `Mas esperadas de mas: ${st.topFalsePositives.map((m) => nameOf(m.id) + ' x' + m.count).join(', ')}` : null,
  ].filter(Boolean);
  alert(lines.join('\n'));
}

const nameOf = (id) => app.cardsById.get(id)?.name ?? id;

// --- Cronometro: discreto pero presente. No castiga; evita que me quede
// --- pensando treinta segundos, que es lo contrario de lo que pasa en la mesa.
function startTimer() {
  stopTimer();
  // performance.now() desde el rAF POSTERIOR al pintado: si midiera desde antes,
  // le estaria cobrando al jugador el tiempo de render.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    app.t0 = performance.now();
    app.timerId = setInterval(() => {
      const s = (performance.now() - app.t0) / 1000;
      ui.timer.textContent = `${s.toFixed(1)}s`;
      ui.timer.classList.toggle('timer--warn', s > 25);
    }, 100);
  }));
}

function stopTimer() {
  if (app.timerId) clearInterval(app.timerId);
  app.timerId = null;
}

boot().catch((err) => {
  ui.ask.textContent = `No se pudieron cargar los datos: ${err.message}`;
  console.error(err);
});
