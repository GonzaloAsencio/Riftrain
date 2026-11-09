/**
 * El arranque: una sola pantalla. Abre y ya hay una mano boca abajo esperando.
 * Sin menus, sin pantalla de inicio: lo unico configurable vive detras del engranaje.
 */
import * as store from './store.js';
import { mountRecall } from './ui/recall.js';
import { openSettings } from './ui/settings.js';

const root = document.getElementById('recall-root');
const banner = document.getElementById('ph-banner');
let controller = null;

function warn(text) {
  banner.textContent = banner.textContent ? `${banner.textContent} ${text}` : text;
  banner.classList.remove('hidden');
}

// El catalogo completo (~800 KB) solo hace falta para leer un codigo de mazo: se pide ahi.
const loadCatalog = async () => {
  const res = await fetch('data/catalog.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).cards;
};

async function start() {
  banner.textContent = '';
  banner.classList.add('hidden');
  // El mazo importado viaja con sus cartas: con uno guardado, arrancar no descarga nada.
  const loaded = store.loadSettings();
  if (!loaded.ok) warn(loaded.reason);
  const { maxLevel, deck: imported } = loaded.settings;
  let deck = imported?.deck;
  let cards = imported?.cards;
  if (!deck) {
    const data = await (await fetch('data/cards.json')).json();
    if (data._placeholder) {
      warn('Datos de andamio: estas cartas NO son reales de Riftbound. Reemplaza data/cards.json por tus decklists.');
    }
    deck = data.decks?.[0];
    cards = data.cards;
  }
  if (store.isMemoryOnly()) {
    warn('El navegador bloquea el almacenamiento: el progreso no va a sobrevivir al cierre.');
  }
  if (!deck) { root.textContent = 'No hay mazo cargado. Cargá uno para practicar.'; return; }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  controller?.destroy();
  controller = mountRecall(root, {
    deck, cards, seed, maxLevel, storage: store,
    onOpenSettings: (gear) => openSettings(document.body, {
      maxLevel, deck: imported ?? null, deckName: deck.name, loadCatalog,
      onSave: (value) => {
        const saved = store.saveSettings(value);
        if (!saved.ok) { warn(`No se pudo guardar la configuración: ${saved.reason}`); return; }
        // Remontar con los ajustes nuevos; el foco vuelve al engranaje de la pantalla nueva.
        window.__riftrainReady = boot().then(() => root.querySelector('.table__settings')?.focus());
      },
      onClose: () => { if (gear.isConnected) gear.focus(); },
    }),
  });
  await controller.ready;
}

function boot() {
  return start().catch((err) => {
    root.textContent = `No se pudieron cargar los datos: ${err.message}`;
    console.error(err);
  });
}

// Los tests de navegador esperan esta promesa antes de mirar la app real.
window.__riftrainReady = boot();
