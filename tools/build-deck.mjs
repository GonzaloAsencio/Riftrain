#!/usr/bin/env node
/**
 * Convierte una decklist pegada en el data/cards.json que carga la app.
 *
 *   node tools/build-deck.mjs mazos/kennen.txt [mas-mazos.txt ...]
 *
 * Pega el export de tu deckbuilder (Piltover Archive y compania) en un .txt y
 * corre esto. Une las tres piezas que ya existen:
 *
 *   parseDecklist()  saca nombres y cantidades del texto     (src/engine/decklist.js)
 *   catalog.json     trae los costos reales                  (tools/fetch-cards.mjs)
 *   resolveDeck()    los cruza                               (src/engine/catalog.js)
 *
 * POR QUE SOLO VIAJAN LAS CARTAS DEL MAZO: el catalogo completo son ~640 KB y
 * la app se abre desde el celular entre partidas. Aca se escriben unicamente
 * las cartas que los mazos usan, que son decenas.
 *
 * NO INVENTA NADA: lo que no esta en el catalogo se reporta y NO entra al mazo.
 * Si falta una carta del MainDeck, el script termina con error: un mazo al que
 * le falta una carta entrena una mano que no existe.
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecklist } from '../src/engine/decklist.js';
import { resolveDeck } from '../src/engine/catalog.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGO = join(RAIZ, 'data', 'catalog.json');
const SALIDA = join(RAIZ, 'data', 'cards.json');

function morir(motivo) {
  console.error(`\n  ${motivo}`);
  console.error(`  ${SALIDA} quedo como estaba.\n`);
  process.exit(1);
}

const archivos = process.argv.slice(2);
if (archivos.length === 0) {
  morir('Falta el archivo: node tools/build-deck.mjs mazos/kennen.txt');
}

let catalogo;
try {
  catalogo = JSON.parse(readFileSync(CATALOGO, 'utf8'));
} catch {
  morir('No encontre data/catalog.json. Corre primero: node tools/fetch-cards.mjs');
}
console.log(`  Catalogo: ${catalogo.cards.length} cartas (${catalogo._generated?.slice(0, 10)})`);

const decks = [];
const usadas = new Map();
let faltantes = 0;

for (const archivo of archivos) {
  let texto;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch {
    morir(`No pude leer ${archivo}`);
  }

  const nombre = basename(archivo).replace(/\.[^.]+$/, '');
  const parsed = parseDecklist(texto, { name: nombre });

  console.log(`\n  ${parsed.deck.name}`);

  for (const e of parsed.errors) {
    console.log(`    linea ${e.line}: ${e.reason}`);
  }

  const { deck, cards, missing } = resolveDeck(parsed, catalogo.cards);

  for (const m of missing) {
    console.log(`    NO ESTA EN EL CATALOGO (${m.zone}): ${m.name}`);
    if (m.zone === 'main') faltantes += 1;
  }

  const incompletas = cards.filter((c) => c.needsCost);
  for (const c of incompletas) {
    console.log(`    SIN COSTO UTILIZABLE: ${c.name} — ${c.reason}`);
  }

  const copias = deck.cards.reduce((a, e) => a + e.qty, 0);
  console.log(`    ${copias} cartas / ${cards.length} distintas` +
    `${deck.legend ? ` · Legend: ${deck.legend.name}` : ''}` +
    `${deck.champion ? ` · Champion: ${deck.champion.name}` : ''}`);
  if (deck.runes && Object.keys(deck.runes).length) {
    const runas = Object.entries(deck.runes).map(([d, n]) => `${n} ${d}`).join(', ');
    console.log(`    Runas: ${runas}`);
  }

  for (const c of cards) usadas.set(c.id, c);
  if (deck.legend) usadas.set(deck.legend.id, deck.legend);
  if (deck.champion) usadas.set(deck.champion.id, deck.champion);

  decks.push({
    id: deck.id,
    name: deck.name,
    domains: deck.domains,
    legend: deck.legend?.id ?? null,
    champion: deck.champion?.id ?? null,
    runes: deck.runes ?? {},
    cards: deck.cards,
  });
}

if (faltantes > 0) {
  morir(`Faltan ${faltantes} carta(s) del MainDeck en el catalogo. Corre tools/fetch-cards.mjs por si el set es nuevo.`);
}

const salida = {
  _placeholder: false,
  _generated: new Date().toISOString(),
  _warning: 'GENERADO por tools/build-deck.mjs desde data/catalog.json. No editar a mano. Datos de carta (c) Riot Games.',
  cards: [...usadas.values()],
  decks,
};

const tmp = `${SALIDA}.tmp`;
writeFileSync(tmp, `${JSON.stringify(salida, null, 1)}\n`);
renameSync(tmp, SALIDA);

const kb = (JSON.stringify(salida).length / 1024).toFixed(0);
console.log(`\n  Escrito: data/cards.json — ${decks.length} mazo(s), ${usadas.size} cartas, ~${kb} KB\n`);
