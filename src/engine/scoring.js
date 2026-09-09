/**
 * Puntaje de una ronda de cartas. PURO: no sabe que existe un DOM.
 *
 * Por que esta aca y no en la UI: el puntaje se derivaba de `dataset.result` de
 * los nodos del abanico, o sea que solo contaba lo que la interfaz hubiera dado
 * vuelta. En los niveles 1 y 2 los picks no dan vuelta nada, asi que el
 * resultado era 0/N siempre y la progresion se alimentaba de ceros.
 *
 * La regla de dependencia del proyecto ya lo decia: `ui/` no calcula reglas, se
 * las pide al motor. Leer el puntaje de un atributo del DOM era romperla.
 *
 * CRITERIO (el mismo que ya aplicaba `closeCardRound`):
 *  - Acierto: nombre una carta que era pagable este turno.
 *  - Falso positivo: nombre algo que NO era pagable — sea porque no estaba en la
 *    mano, sea porque estaba pero no se podia pagar. Anticipar una amenaza que
 *    no existe cuesta igual que no ver la que si esta.
 *  - Se cuenta por carta DISTINTA, no por instancia: si la mano trae dos copias
 *    de la misma carta, verlas sigue siendo ver UNA carta. (El abanico si
 *    distingue las copias: nombrarla dos veces da vuelta las dos.)
 */

function assertIds(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} tiene que ser un array de ids, recibi: ${typeof value}`);
  }
}

/** Ids distintos, conservando el orden de aparicion. */
const uniq = (ids) => [...new Set(ids)];

/**
 * @param {object} o
 * @param {string[]} o.namedIds     lo que el jugador marco o escribio
 * @param {string[]} o.handIds      la mano real (puede traer ids repetidos)
 * @param {string[]} o.playableIds  las pagables segun el motor (idem)
 * @returns {{
 *   hits: number, expected: number, falsePositives: number,
 *   hitIds: string[], missedIds: string[], falsePositiveIds: string[],
 *   notInHandIds: string[]
 * }}
 */
export function scoreNaming({ namedIds, handIds, playableIds } = {}) {
  assertIds(namedIds, 'namedIds');
  assertIds(handIds, 'handIds');
  assertIds(playableIds, 'playableIds');

  const named = uniq(namedIds);
  const inHand = new Set(handIds);
  const playable = uniq(playableIds);
  const isPlayable = new Set(playable);

  const hitIds = named.filter((id) => isPlayable.has(id));
  const falsePositiveIds = named.filter((id) => !isPlayable.has(id));
  const notInHandIds = falsePositiveIds.filter((id) => !inHand.has(id));
  const missedIds = playable.filter((id) => !named.includes(id));

  return {
    hitIds,
    missedIds,
    falsePositiveIds,
    notInHandIds,
    hits: hitIds.length,
    expected: playable.length,
    falsePositives: falsePositiveIds.length,
  };
}
