/**
 * LA MANO DEL RIVAL. El corazon del proyecto.
 *
 * Reglas no negociables (seccion 1 del brief):
 *
 *  1. Las cartas boca abajo estan DESDE EL PRIMER SEGUNDO. No aparecen al final.
 *     Si los huecos se agregaran al cerrar, el cierre se sentiria como una lista
 *     pegada abajo. Viendo siete dorsos desde el arranque, cada revelacion pesa
 *     y las que quedan boca abajo al final te estan mirando.
 *
 *  2. Nombrar una carta correctamente la da vuelta AHI MISMO, en su lugar del
 *     abanico, con giro de 280ms. Queda en color.
 *
 *  3. Al cerrar, las que no nombre se dan vuelta SOLAS y quedan en blanco y negro
 *     (grayscale(1) + opacidad baja), en la MISMA fila, al lado de las acertadas.
 *     El feedback es una imagen, no un porcentaje.
 *
 *  4. Falso positivo: si nombro una carta que no esta, entra al abanico igual,
 *     tachada y con borde rojo. Anticipar una amenaza que no existe es un error
 *     tan caro como no ver la que si esta.
 *
 * Copias repetidas: si la mano trae dos copias de la misma carta, nombrarla una vez
 * da vuelta UNA. Para ver las dos hay que nombrarla dos veces - porque anticipar
 * "tiene dos" es justamente parte de la habilidad.
 */

import { renderCard, flipUp, flipDown, openZoom } from './card.js';

const HOLD_MS = 380;

export class Hand {
  /**
   * @param {HTMLElement} container
   * @param {Array} cards  la mano concreta (nunca se expone al jugador)
   */
  constructor(container, cards) {
    this.container = container;
    this.cards = cards;
    this.slots = [];        // { card, node, slot, revealed }
    this.extras = [];       // falsos positivos
    this.closed = false;
    this.mount();
  }

  /** Monta la mano entera BOCA ABAJO. Esto pasa antes de la primera pregunta. */
  mount() {
    this.container.textContent = '';
    // El contenedor se reusa entre rondas: la mano nueva arranca cerrada.
    this.container.classList.remove('hand--open');
    this.container.setAttribute('role', 'group');
    this.container.setAttribute('aria-label', `Mano del rival: ${this.cards.length} cartas`);

    for (const card of this.cards) {
      const slot = document.createElement('div');
      slot.className = 'hand__slot';
      const node = renderCard(card, { faceUp: false });
      slot.appendChild(node);
      this.container.appendChild(slot);

      const entry = { card, node, slot, revealed: false };
      this.attachHold(entry);
      this.slots.push(entry);
    }
  }

  /** Mantener pulsado amplia la carta (solo si ya esta dada vuelta). */
  attachHold(entry) {
    let timer = null;
    let closeZoom = null;
    const start = () => {
      if (entry.node.dataset.face !== 'up') return;
      timer = setTimeout(() => { closeZoom = openZoom(entry.card); }, HOLD_MS);
    };
    const stop = () => {
      clearTimeout(timer);
      if (closeZoom) { closeZoom(); closeZoom = null; }
    };
    entry.slot.addEventListener('pointerdown', start);
    entry.slot.addEventListener('pointerup', stop);
    entry.slot.addEventListener('pointerleave', stop);
    entry.slot.addEventListener('pointercancel', stop);
  }

  /** Cuantas copias de esta carta quedan sin revelar. */
  remaining(cardId) {
    return this.slots.filter((s) => s.card.id === cardId && !s.revealed).length;
  }

  /**
   * Nombre una carta. Si esta en la mano y queda alguna sin revelar, se da vuelta.
   * @returns {{hit: boolean, card: object|null}}
   */
  reveal(cardId) {
    const entry = this.slots.find((s) => s.card.id === cardId && !s.revealed);
    if (!entry) return { hit: false, card: null };

    entry.revealed = true;
    flipUp(entry.node, entry.card, 'hit');
    entry.slot.dataset.lift = '1';
    return { hit: true, card: entry.card };
  }

  /**
   * Desmarcar: vuelve a tapar UNA copia ya dada vuelta.
   *
   * En los niveles 1 y 2 el jugador marca botones y puede arrepentirse. Si el
   * clic da vuelta la carta pero el segundo clic no la tapa, el abanico deja de
   * ser el espejo de lo que dije, y el abanico ES el feedback.
   *
   * Despues del cierre no hace nada: ahi lo gris ya es la respuesta.
   * @returns {boolean} si tapo alguna
   */
  unreveal(cardId) {
    if (this.closed) return false;
    // Se destapa la ULTIMA que se dio vuelta: deshacer es deshacer el ultimo clic.
    const entry = [...this.slots].reverse().find((s) => s.card.id === cardId && s.revealed);
    if (!entry) return false;

    entry.revealed = false;
    flipDown(entry.node);
    delete entry.slot.dataset.lift;
    return true;
  }

  /** Desmarcar un falso positivo: sale de la fila como si nunca lo hubiera dicho. */
  removeFalsePositive(cardId) {
    const i = this.extras.findIndex((s) => s.card.id === cardId);
    if (i === -1) return false;
    const [entry] = this.extras.splice(i, 1);
    entry.slot.remove();
    return true;
  }

  /**
   * La nombre y no estaba. Entra al abanico igual: tachada, borde rojo.
   * Quiero ver tambien lo que estaba esperando DE MAS.
   */
  addFalsePositive(card) {
    const slot = document.createElement('div');
    slot.className = 'hand__slot';
    const node = renderCard(card, { faceUp: true, result: 'false-positive' });
    slot.appendChild(node);
    this.container.appendChild(slot);
    const entry = { card, node, slot, revealed: true, falsePositive: true };
    this.attachHold(entry);
    this.extras.push(entry);
    return entry;
  }

  /**
   * EL CIERRE. Las que no vi se dan vuelta solas, en blanco y negro,
   * en la misma fila. Esa imagen es el feedback.
   */
  revealRest({ stagger = 55 } = {}) {
    if (this.closed) return [];
    this.closed = true;

    // El abanico se abre para que las grises se puedan LEER.
    this.container.classList.add('hand--open');

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const missed = this.slots.filter((s) => !s.revealed);

    missed.forEach((entry, i) => {
      const doFlip = () => {
        entry.revealed = true;
        flipUp(entry.node, entry.card, 'missed');
      };
      // stagger 0 (o motion reducido) = sincrono. Un setTimeout(fn, 0) deja el
      // cierre sin aplicar durante un tick, y eso lo vuelve inobservable para un
      // test y para cualquiera que lea el estado justo despues.
      if (reduce || stagger <= 0) doFlip();
      else setTimeout(doFlip, i * stagger);
    });

    return missed.map((s) => s.card);
  }

  /** Resumen para las estadisticas: acertadas, perdidas y falsos positivos. */
  summary() {
    const hits = this.slots.filter((s) => s.node.dataset.result === 'hit').map((s) => s.card);
    const missed = this.slots.filter((s) => s.node.dataset.result === 'missed').map((s) => s.card);
    const falsePositives = this.extras.map((s) => s.card);
    return { hits, missed, falsePositives, total: this.cards.length };
  }
}
