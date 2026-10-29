import { SYMBOL_IMAGES } from './assets.ts';
import { ROW_COUNT, type Board, type LineWin } from './game.ts';
import { REEL_STRIPS, SYMBOLS } from './reelConfig.ts';
import { startCoinShower } from './coinShower.ts';
import { reelLandingPlan, SPIN_CYCLE_SLOTS } from './reelLanding.ts';
export { rollUpWin } from './winRollup.ts';

export class ReelView {
  private reels: HTMLElement[] = [];
  private cells: HTMLElement[][] = [];
  private images: HTMLImageElement[][] = [];

  constructor(private root: HTMLElement, private reducedMotion: () => boolean) {}

  render(board: Board): void {
    this.root.replaceChildren();
    this.reels = [];
    this.cells = [];
    this.images = [];
    board.forEach((column, index) => {
      const reel = document.createElement('div');
      reel.className = 'reel';
      reel.id = `reel-${index}`;
      const cells: HTMLElement[] = [];
      const images: HTMLImageElement[] = [];
      column.forEach((symbol, row) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.id = `cell-${index}-${row}`;
        const image = this.makeImage(symbol);
        cell.append(image);
        reel.append(cell);
        cells.push(cell);
        images.push(image);
      });
      this.reels.push(reel);
      this.cells.push(cells);
      this.images.push(images);
      this.root.append(reel);
    });
    // This layer belongs to the stationary viewport, never to a moving symbol strip.
    const grid = document.createElement('div');
    grid.className = 'reel-grid-overlay';
    grid.setAttribute('aria-hidden', 'true');
    for (let column = 1; column < board.length; column++) {
      const divider = document.createElement('span');
      divider.className = 'reel-divider reel-divider-vertical';
      divider.style.left = `${column / board.length * 100}%`;
      grid.append(divider);
    }
    for (let row = 1; row < ROW_COUNT; row++) {
      const divider = document.createElement('span');
      divider.className = 'reel-divider reel-divider-horizontal';
      divider.style.top = `${row / ROW_COUNT * 100}%`;
      grid.append(divider);
    }
    this.root.append(grid);
  }

  start(random: () => number = Math.random): void {
    this.clearWins();
    this.reels.forEach((reel, column) => {
      reel.classList.add('spinning');
      const strip = document.createElement('div');
      strip.className = 'symbol-strip';
      strip.setAttribute('aria-hidden', 'true');
      const source = REEL_STRIPS[column];
      const start = Math.floor(random() * source.length);
      const sequence = Array.from({ length: SPIN_CYCLE_SLOTS }, (_, index) => source[(start + index) % source.length]);
      for (const symbol of [...sequence, ...sequence]) strip.append(this.makeSlot(symbol));
      reel.append(strip);
    });
  }

  async land(column: number, result: readonly number[], slammed: boolean): Promise<void> {
    const reel = this.reels[column];
    const strip = reel.querySelector<HTMLElement>('.symbol-strip');
    if (strip && !this.reducedMotion() && typeof strip.animate === 'function') {
      const slotHeight = reel.getBoundingClientRect().height / ROW_COUNT;
      if (slotHeight > 0) {
        const computed = getComputedStyle(strip);
        const transform = computed.transform;
        const currentY = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
        const cycle = parseFloat(computed.animationDuration) * (computed.animationDuration.endsWith('ms') ? 1 : 1000);
        const plan = reelLandingPlan(currentY, slotHeight, slammed, cycle > 0 ? cycle : 850);
        const bridge = Array.from(strip.children).slice(plan.firstVisible, plan.firstVisible + 5)
          .map(element => element.cloneNode(true));
        strip.getAnimations().forEach(animation => animation.cancel());
        const lead = result.map(symbol => this.makeSlot(symbol));
        if (plan.leadRows > ROW_COUNT) lead.push(this.makeSlot(result[0]));
        strip.replaceChildren(...lead, ...bridge);
        strip.style.animation = 'none';
        strip.style.height = 'auto';
        for (const slot of Array.from(strip.children) as HTMLElement[]) {
          slot.style.height = `${slotHeight}px`;
          slot.style.flex = `0 0 ${slotHeight}px`;
        }
        strip.style.transform = `translate3d(0,${plan.fromY}px,0)`;
        const animation = strip.animate([
          { transform: `translate3d(0,${plan.fromY}px,0)` },
          { transform: 'translate3d(0,0,0)' },
        ], { duration: plan.duration, easing: plan.easing, fill: 'forwards' });
        try { await animation.finished; }
        catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
        } finally { animation.cancel(); }
      }
    }
    result.forEach((symbol, row) => {
      const image = this.images[column][row];
      image.src = SYMBOL_IMAGES[SYMBOLS[symbol]];
      image.alt = SYMBOLS[symbol];
    });
    strip?.remove();
    reel.classList.remove('spinning');
  }

  highlight(line: LineWin): void {
    this.clearWins();
    for (const [column, row] of line.cells) this.cells[column][row].classList.add('win', 'active');
  }

  clearWins(): void {
    for (const column of this.cells) for (const cell of column) cell.classList.remove('win', 'active');
  }

  cleanup(): void {
    this.clearWins();
    for (const reel of this.reels) {
      reel.querySelector('.symbol-strip')?.remove();
      if (typeof reel.getAnimations === 'function') {
        reel.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      }
      reel.classList.remove('spinning');
    }
  }

  private makeImage(symbol: number): HTMLImageElement {
    const image = document.createElement('img');
    image.src = SYMBOL_IMAGES[SYMBOLS[symbol]];
    image.alt = SYMBOLS[symbol];
    image.draggable = false;
    return image;
  }

  private makeSlot(symbol: number): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'strip-slot';
    slot.append(this.makeImage(symbol));
    return slot;
  }
}

export function celebrate(root: HTMLElement, format: (value: number) => string,
  total: number, reducedMotion: boolean, signal?: AbortSignal) {
  const shower = document.createElement('div');
  shower.className = 'big-win-shower';
  shower.setAttribute('aria-hidden', 'true');
  shower.innerHTML = `<div class="big-win-popup">
    <div class="big-win-crown">✦ ❖ ✦</div><div class="big-win-title">BIG WIN!</div>
    <div class="big-win-rule">✧ ✦ ✧</div><div class="big-win-caption">TOTAL WIN</div>
    <strong class="big-win-amount"><span class="big-win-amount-fit">
      <span class="big-win-amount-size" aria-hidden="true"></span>
      <span class="big-win-amount-value"></span>
    </span></strong><div class="big-win-footer">✦ MYSTIC FORTUNE ✦</div>
  </div>`;
  const amount = shower.querySelector<HTMLElement>('.big-win-amount')!;
  const fit = shower.querySelector<HTMLElement>('.big-win-amount-fit')!;
  const value = shower.querySelector<HTMLElement>('.big-win-amount-value')!;
  // Reserve the final formatted width before counting; digit/group changes cannot resize the row.
  shower.querySelector<HTMLElement>('.big-win-amount-size')!.textContent = format(total);
  value.textContent = format(0);
  root.append(shower);
  const fitAmount = () => {
    const scale = fit.offsetWidth > 0 ? Math.min(1, amount.clientWidth / fit.offsetWidth) : 1;
    fit.style.transform = `scale(${scale})`;
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fitAmount) : null;
  observer?.observe(amount);
  if (!observer) window.addEventListener('resize', fitAmount);
  fitAmount();
  const stopFountain = reducedMotion ? () => Promise.resolve() : startCoinShower(root, signal);
  let stopped: Promise<void> | undefined;
  const stop = () => {
    if (stopped) return stopped;
    signal?.removeEventListener('abort', stop);
    const coinsFinished = stopFountain();
    shower.classList.add('is-exiting');
    const popupFinished = new Promise<void>(resolve => {
      setTimeout(() => {
        observer?.disconnect();
        window.removeEventListener('resize', fitAmount);
        shower.remove();
        resolve();
      }, reducedMotion ? 0 : 450);
    });
    stopped = Promise.all([coinsFinished, popupFinished]).then(() => {});
    return stopped;
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  return {
    update: (amount: number) => { value.textContent = format(amount); },
    stop,
  };
}
