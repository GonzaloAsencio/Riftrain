/**
 * Proyeccion de runas. El nucleo aritmetico de todo el entrenador.
 *
 * REGLAS (fijadas por el usuario, NO inferidas del juego):
 *  - El Mazo de Runas tiene 12 cartas.
 *  - En Canalizar se toman 2 runas por turno (3 en el primer turno si jugas segundo).
 *  - INVARIANTE: mesa + mazo = 12, siempre. La mesa nunca supera 12.
 *  - Energia (incolora) = agotar una runa. Reversible, se endereza en el Awaken.
 *    NO cambia la cantidad de runas en mesa.
 *  - Poder (con dominio)  = reciclar una runa. Permanente: sale de la mesa y va al
 *    fondo del Mazo de Runas. REDUCE la mesa.
 *  - La Reserva de Runas se vacia al terminar la fase de Robo.
 *
 * ECUACION NUCLEO:
 *    mesa(T+1) = mesa(T) - recicladas(T) + canalizadas
 *    canalizadas = min(2, 12 - mesa_tras_reciclar)
 */

export const RUNE_DECK_SIZE = 12;
export const CHANNEL_PER_TURN = 2;
export const CHANNEL_FIRST_TURN_ON_THE_DRAW = 3;

export const DOMAINS = ['fury', 'calm', 'mind', 'body', 'order', 'chaos'];

export const DOMAIN_COLOR = {
  fury: '#c0453c',
  calm: '#3e8e6e',
  mind: '#3a6ea5',
  body: '#b07333',
  order: '#c0a02a',
  chaos: '#7a4fa3',
};

export const DOMAIN_LABEL = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  order: 'Order',
  chaos: 'Chaos',
};

export function isDomain(d) {
  return DOMAINS.includes(d);
}

/** Cuantas runas se canalizan dado el estado de mesa tras reciclar. */
export function channelAmount(boardAfterRecycle, { firstTurnOnTheDraw = false } = {}) {
  const cap = firstTurnOnTheDraw ? CHANNEL_FIRST_TURN_ON_THE_DRAW : CHANNEL_PER_TURN;
  const room = RUNE_DECK_SIZE - boardAfterRecycle;
  return Math.max(0, Math.min(cap, room));
}

/**
 * Proyecta la mesa turno a turno y devuelve la cadena aritmetica completa,
 * para poder mostrarla linea por linea: "T5: 9 - 2 + 2 = 9".
 *
 * @param {object} o
 * @param {number} o.startBoard      runas en mesa al inicio del turno `startTurn`
 * @param {number} o.startTurn       numero del turno inicial
 * @param {number} o.turns           cuantos turnos proyectar (>= 1)
 * @param {number[]|function} o.recycles  recicladas por turno (array o fn(turn, board))
 * @param {boolean} o.firstTurnOnTheDraw  el primer turno proyectado canaliza 3
 * @returns {{steps: Array, final: number, max: number, maxTurn: number}}
 */
export function projectRunes({
  startBoard,
  startTurn = 1,
  turns,
  recycles = [],
  firstTurnOnTheDraw = false,
} = {}) {
  if (!Number.isInteger(startBoard) || startBoard < 0 || startBoard > RUNE_DECK_SIZE) {
    throw new RangeError(`startBoard fuera de rango: ${startBoard}`);
  }
  if (!Number.isInteger(turns) || turns < 1) {
    throw new RangeError(`turns tiene que ser >= 1, recibi: ${turns}`);
  }

  const recycleAt = typeof recycles === 'function' ? recycles : (i) => recycles[i] ?? 0;

  const steps = [];
  let board = startBoard;
  let max = startBoard;
  let maxTurn = startTurn;

  for (let i = 0; i < turns; i++) {
    const turn = startTurn + i;
    const before = board;

    // Reciclar nunca puede sacar mas runas de las que hay en mesa.
    const wanted = Math.max(0, Math.trunc(recycleAt(i, before) || 0));
    const recycled = Math.min(wanted, before);
    const afterRecycle = before - recycled;

    const channeled = channelAmount(afterRecycle, {
      firstTurnOnTheDraw: firstTurnOnTheDraw && i === 0,
    });
    const after = afterRecycle + channeled;

    steps.push({
      turn,
      before,
      recycled,
      requestedRecycle: wanted,
      afterRecycle,
      channeled,
      after,
      deck: RUNE_DECK_SIZE - after,
      formula: `T${turn}: ${before} − ${recycled} + ${channeled} = ${after}`,
    });

    board = after;
    if (board > max) {
      max = board;
      maxTurn = turn;
    }
  }

  return { steps, final: board, max, maxTurn };
}

/** Runas en mesa al terminar el turno `targetTurn`. */
export function runesAtTurn(targetTurn, opts) {
  const startTurn = opts.startTurn ?? 1;
  if (targetTurn < startTurn) throw new RangeError('targetTurn anterior al startTurn');
  const { steps } = projectRunes({ ...opts, turns: targetTurn - startTurn + 1 });
  return steps[steps.length - 1].after;
}

/** Primer turno en el que la mesa alcanza (o supera) K. null si nunca en el horizonte. */
export function turnReaching(k, opts) {
  const { steps } = projectRunes(opts);
  const hit = steps.find((s) => s.after >= k);
  return hit ? hit.turn : null;
}

/**
 * INVARIANTE del sistema: mesa + mazo = 12 en todo momento.
 * Lo exponemos para que los tests lo puedan afirmar sobre cada paso.
 */
export function invariantHolds(step) {
  return step.after + step.deck === RUNE_DECK_SIZE && step.after <= RUNE_DECK_SIZE && step.after >= 0;
}

/** Construye una mesa de runas concreta (con dominios y estado ready). */
export function makeBoard(domains, { readyCount = null } = {}) {
  const ready = readyCount === null ? domains.length : readyCount;
  return domains.map((domain, i) => ({ domain, ready: i < ready }));
}
