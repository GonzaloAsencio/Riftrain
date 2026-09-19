#!/usr/bin/env node
/**
 * Baja el catalogo de cartas de la galeria OFICIAL de Riot y lo deja
 * normalizado en data/catalog.json.
 *
 *   node tools/fetch-cards.mjs
 *
 * GRATIS Y SIN API KEY. La galeria es una app Next.js: su HTML trae un buildId,
 * y con ese buildId se pide el JSON que la propia pagina consume. No se scrapea
 * HTML de cartas ni se parsea markup: se lee el mismo dato estructurado que usa
 * el sitio. (Scrydex quedo descartada: su objeto card no publica los costos.)
 *
 * POR QUE ESTE ARCHIVO NO TIENE TESTS: no hace nada mas que tres fetch y un
 * write. Toda la logica que se puede equivocar -- aplanar costos, repartir el
 * poder por dominio, deduplicar impresiones -- vive en src/engine/catalog.js,
 * que es puro y se testea con un fixture. Un test que pegue contra Riot seria
 * lento, frágil y dependiente de la red.
 *
 * POR QUE data/catalog.json NO ES data/cards.json: la app se abre desde el
 * celular entre partidas, y las ~935 cartas pesan mas de 1 MB. El catalogo es
 * materia prima para las herramientas; cards.json es el producto chico que el
 * navegador baja. Mezclarlos seria pagar un megabyte en cada arranque.
 */

import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../src/engine/catalog.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'data', 'catalog.json');
const GALERIA = 'https://riftbound.leagueoflegends.com/en-us/card-gallery/';
const UA = 'Mozilla/5.0 (Riftrain card catalog builder)';

/** Falla ruidoso: un catalogo a medias entrena mal y no se nota. */
function morir(motivo) {
  console.error(`\n  No se pudo generar el catalogo: ${motivo}`);
  console.error(`  ${SALIDA} quedo como estaba.\n`);
  process.exit(1);
}

async function pedir(url, que) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA } });
  } catch (e) {
    return morir(`no se pudo conectar para ${que}: ${e.message}`);
  }
  if (!res.ok) return morir(`${que} devolvio HTTP ${res.status}`);
  return res;
}

async function main() {
  console.log(`  Galeria: ${GALERIA}`);

  const html = await (await pedir(GALERIA, 'la galeria')).text();
  const m = /"buildId":"([^"]+)"/.exec(html);
  if (!m) morir('no encontre el buildId en el HTML (Riot cambio la pagina?)');
  const buildId = m[1];
  console.log(`  buildId: ${buildId}`);

  const datosUrl = `https://riftbound.leagueoflegends.com/_next/data/${buildId}/en-us/card-gallery.json`;
  const datos = await (await pedir(datosUrl, 'el JSON de la galeria')).json();

  // Por TIPO, nunca por indice: hoy es el blade 2, y manana Riot mete un banner
  // arriba y pasa a ser el 3.
  const blades = datos?.pageProps?.page?.blades;
  if (!Array.isArray(blades)) morir('el JSON no trae pageProps.page.blades');
  const gallery = blades.find((b) => b?.type === 'riftboundCardGallery');
  if (!gallery) morir('no hay ningun blade de tipo riftboundCardGallery');

  const items = gallery.cards?.items;
  if (!Array.isArray(items) || items.length === 0) morir('el blade no trae cards.items');
  console.log(`  items: ${items.length}`);

  const { cards, errors } = buildCatalog(items);
  if (cards.length === 0) morir('el catalogo quedo vacio despues de normalizar');

  const incompletas = cards.filter((c) => c.needsCost);
  console.log(`  cartas: ${cards.length} (${incompletas.length} sin costo utilizable)`);

  if (errors.length) {
    console.log(`\n  ${errors.length} item(s) descartados:`);
    for (const e of errors.slice(0, 10)) console.log(`    ${e.code ?? '?'}: ${e.reason}`);
    if (errors.length > 10) console.log(`    ... y ${errors.length - 10} mas`);
  }

  const salida = {
    _generated: new Date().toISOString(),
    _source: GALERIA,
    _buildId: buildId,
    _warning: 'GENERADO por tools/fetch-cards.mjs. No editar a mano. Datos de carta (c) Riot Games.',
    count: cards.length,
    cards,
  };

  // Escritura atomica: si algo revienta a mitad de camino, el catalogo anterior
  // sigue entero en su lugar.
  mkdirSync(dirname(SALIDA), { recursive: true });
  const tmp = `${SALIDA}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(salida, null, 1)}\n`);
  renameSync(tmp, SALIDA);

  console.log(`\n  Escrito: data/catalog.json\n`);
}

await main();
