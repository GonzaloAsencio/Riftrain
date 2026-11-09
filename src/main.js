/**
 * El arranque: una sola pantalla. Abre y ya hay una mano boca abajo esperando.
 * Sin menus, sin pantalla de inicio, sin selector de modo.
 */
import * as store from './store.js';
import { mountRecall } from './ui/recall.js';

const root = document.getElementById('recall-root');
const banner = document.getElementById('ph-banner');

function warn(text) {
  banner.textContent = banner.textContent ? `${banner.textContent} ${text}` : text;
  banner.classList.remove('hidden');
}

async function boot() {
  const res = await fetch('data/cards.json');
  const data = await res.json();
  if (data._placeholder) {
    warn('Datos de andamio: estas cartas NO son reales de Riftbound. Reemplaza data/cards.json por tus decklists.');
  }
  if (store.isMemoryOnly()) {
    warn('El navegador bloquea el almacenamiento: el progreso no va a sobrevivir al cierre.');
  }
  const deck = data.decks[0];
  if (!deck) { root.textContent = 'No hay mazo cargado. Cargá uno para practicar.'; return; }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const controller = mountRecall(root, { deck, cards: data.cards, seed, storage: store });
  await controller.ready;
}

// Los tests de navegador esperan esta promesa antes de mirar la app real.
window.__riftrainReady = boot().catch((err) => {
  root.textContent = `No se pudieron cargar los datos: ${err.message}`;
  console.error(err);
});
