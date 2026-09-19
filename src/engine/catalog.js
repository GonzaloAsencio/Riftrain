/**
 * Normalizacion del catalogo oficial de cartas. PURO: no sabe que existe la red.
 *
 * De donde salen los datos: la galeria oficial de Riot
 * (riftbound.leagueoflegends.com/en-us/card-gallery/). Gratis, sin API key.
 * Quien los baja es tools/fetch-cards.mjs; este modulo solo transforma lo que
 * ya esta en memoria, y por eso se puede testear de verdad.
 *
 * EL PROBLEMA QUE RESUELVE:
 *   Riot guarda el coste como dos cosas sueltas -- un numero de Poder y una
 *   lista de dominios -- y el motor necesita Poder POR DOMINIO, porque para
 *   pagar 1 de Poder Fury hace falta que una runa DISPONIBLE sea Fury (regla 6).
 *
 *     1 dominio + power 3   -> { chaos: 3 }   inequivoco
 *     2 dominios + power 2  -> ???            NO SE PUEDE SABER
 *
 *   Las de dos dominios con poder (41 de 1189) quedan marcadas `needsCost`.
 *   Repartirlas a ojo seria inventar una regla de Riftbound, y el error no se
 *   veria nunca: simplemente se entrenaria mal.
 *
 * AUSENTE NO ES CERO: hay cartas que cuestan 0 de energia de verdad. Un costo
 * que no vino es `null`, igual que en el parser de decklists.
 */

import { DOMAINS } from './runes.js';
import { slug } from './decklist.js';

/** Los numeros de Riot vienen anidados: { label, value: { id: 3 } }. */
function num(field) {
  const n = field?.value?.id;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Dominios de juego de la carta. "Colorless" no es un dominio: es energia. */
function domainsOf(item) {
  const raw = item.domain?.values ?? [];
  return raw.map((v) => v?.id).filter((d) => DOMAINS.includes(d));
}

/** Una variante (art alternativo o firmada) lleva marca en el codigo: UNL-147a, VEN-197*. */
export function isVariant(code) {
  return typeof code === 'string' && /(\*|\d+[a-z])\s*\//.test(code);
}

/**
 * Un item de la galeria -> una carta del motor.
 * @returns {{ card: object|null, error: string|null }}
 */
export function normalizeCard(item) {
  if (!item || typeof item !== 'object') {
    return { card: null, error: 'el item no es un objeto' };
  }
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!name) {
    return { card: null, error: `item sin nombre (${item.publicCode ?? item.id ?? 'sin codigo'})` };
  }

  const energy = num(item.energy);
  const powerTotal = num(item.power);
  const domains = domainsOf(item);

  let power = {};
  let needsCost = false;
  let reason = null;

  if (powerTotal !== null && powerTotal > 0) {
    if (domains.length === 1) {
      power = { [domains[0]]: powerTotal };
    } else if (domains.length === 0) {
      needsCost = true;
      reason = `pide ${powerTotal} de Poder pero no declara dominio`;
    } else {
      // Dos dominios y un numero: no hay forma de saber el reparto.
      needsCost = true;
      reason = `pide ${powerTotal} de Poder entre ${domains.join(' y ')} y no se sabe como se reparte`;
    }
  }

  // Sin energia y sin poder no hay costo que entrenar. Un 0 seria mentira.
  if (!needsCost && energy === null && powerTotal === null) {
    needsCost = true;
    reason = 'la galeria no publica costo para esta carta';
  }

  return {
    card: {
      id: slug(name),
      name,
      code: item.publicCode ?? null,
      collectorNumber: item.collectorNumber ?? null,
      energy,
      power,
      domain: domains[0] ?? null,
      domains,
      type: item.cardType?.type?.[0]?.id ?? null,
      might: num(item.might),
      text: item.text?.richText?.body ?? '',
      img: item.cardImage?.url ?? null,
      needsCost,
      reason,
      source: 'gallery',
    },
    error: null,
  };
}

/** Mismo costo? Se compara lo unico que le importa al motor. */
function sameCost(a, b) {
  return a.energy === b.energy && JSON.stringify(a.power) === JSON.stringify(b.power);
}

/**
 * Todos los items -> el catalogo, una carta por nombre.
 *
 * POR QUE SE DEDUPLICA: la galeria trae cada carta una vez por impresion (arts
 * alternativos, firmadas). Son la misma carta y cuestan lo mismo: para entrenar
 * da igual cual toco. Se prefiere la impresion base.
 *
 * @returns {{ cards: object[], errors: {code: string|null, reason: string}[] }}
 */
export function buildCatalog(items) {
  if (!Array.isArray(items)) {
    throw new TypeError(`buildCatalog espera un array, recibi: ${typeof items}`);
  }

  const errors = [];
  const byId = new Map();

  for (const item of items) {
    const { card, error } = normalizeCard(item);
    if (error) {
      errors.push({ code: item?.publicCode ?? null, reason: error });
      continue;
    }

    const previo = byId.get(card.id);
    if (!previo) {
      byId.set(card.id, card);
      continue;
    }

    // Misma carta, otra impresion. Si los costos no coinciden, algo entendi mal:
    // lo digo en vez de elegir una en silencio.
    if (!sameCost(previo, card)) {
      errors.push({
        code: card.code,
        reason: `"${card.name}" aparece con dos costos distintos (${previo.code} y ${card.code})`,
      });
      continue;
    }

    // La base le gana a la variante; entre dos iguales, el numero mas bajo.
    const mejor =
      isVariant(previo.code) !== isVariant(card.code)
        ? (isVariant(previo.code) ? card : previo)
        : ((card.collectorNumber ?? Infinity) < (previo.collectorNumber ?? Infinity) ? card : previo);

    byId.set(card.id, mejor);
  }

  return { cards: [...byId.values()], errors };
}
