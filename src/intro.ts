import { delay } from './timing.ts';

export const MINIMUM_INTRO_MS = 5000;

/** Both real loading and the five-second presentation must finish before entry. */
export async function waitForGameLoad(assets: Promise<void>): Promise<void> {
  const timer = new AbortController();
  try {
    await Promise.all([assets, delay(MINIMUM_INTRO_MS, timer.signal)]);
  } finally { timer.abort(); }
}

export function loadingProgress(elapsed: number, loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, elapsed / MINIMUM_INTRO_MS, loaded / total)) * 100;
}

interface IntroElements {
  root: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  percent: HTMLElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
  loading: HTMLElement;
  soundPrompt: HTMLElement;
  soundYes: HTMLButtonElement;
  soundNo: HTMLButtonElement;
}

export class IntroScreen {
  private readonly elements: IntroElements;
  private ready = false;
  private soundChoice: Promise<void> | null = null;

  constructor(elements: IntroElements) { this.elements = elements; }

  async load(preload: (onProgress: (loaded: number, total: number) => void) => Promise<void>): Promise<void> {
    const { root, retry, status, loading, soundPrompt, soundYes, soundNo } = this.elements;
    this.ready = false;
    this.soundChoice = null;
    root.hidden = false;
    root.setAttribute('aria-label', 'Loading Mystic Fortune');
    loading.hidden = false;
    soundPrompt.hidden = true;
    soundYes.disabled = soundNo.disabled = true;
    root.classList.remove('intro-finished', 'intro-error');
    retry.hidden = true;
    status.textContent = 'Preparing your adventure…';
    this.update(0);
    const start = performance.now();
    let loaded = 0;
    let total = 1;
    let frame = 0;
    const tick = (now: number) => {
      // Reserve 100% for the successful completion of both loading gates.
      this.update(Math.min(99, loadingProgress(now - start, loaded, total)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    try {
      await waitForGameLoad(preload((count, size) => { loaded = count; total = size; }));
      this.update(100);
      status.textContent = 'Your fortune awaits';
      this.ready = true;
    } finally { cancelAnimationFrame(frame); }
  }

  askForSound(onChoose: (enabled: boolean) => void): Promise<void> {
    if (!this.ready) return Promise.reject(new Error('Game assets must finish loading before choosing sound.'));
    if (this.soundChoice) return this.soundChoice;
    const { root, loading, soundPrompt, soundYes, soundNo } = this.elements;
    loading.hidden = true;
    soundPrompt.hidden = false;
    root.setAttribute('aria-label', 'Choose game sound');
    soundYes.disabled = soundNo.disabled = false;
    this.soundChoice = new Promise<void>((resolve, reject) => {
      const choose = (enabled: boolean) => {
        soundYes.removeEventListener('click', yes);
        soundNo.removeEventListener('click', no);
        soundYes.disabled = soundNo.disabled = true;
        try {
          // Run inside the actual click gesture so browsers can unlock audio.
          onChoose(enabled);
          resolve();
        } catch (error) { reject(error); }
      };
      const yes = () => choose(true);
      const no = () => choose(false);
      soundYes.addEventListener('click', yes);
      soundNo.addEventListener('click', no);
    });
    soundYes.focus({ preventScroll: true });
    return this.soundChoice;
  }

  dismiss(): void {
    this.elements.root.classList.add('intro-finished');
    // CSS handles the crossfade; this also cleans up when transitions are disabled.
    setTimeout(() => { this.elements.root.hidden = true; }, 450);
  }

  fail(): void {
    const { root, retry, status, loading, soundPrompt, soundYes, soundNo } = this.elements;
    this.ready = false;
    loading.hidden = false;
    soundPrompt.hidden = true;
    soundYes.disabled = soundNo.disabled = true;
    root.classList.add('intro-error');
    status.textContent = 'Some images could not load. Check your connection and try again.';
    retry.hidden = false;
    retry.focus({ preventScroll: true });
  }

  private update(value: number): void {
    const percent = String(Math.floor(value));
    this.elements.fill.style.transform = `scaleX(${value / 100})`;
    if (this.elements.percent.textContent !== `${percent}%`) {
      this.elements.percent.textContent = `${percent}%`;
      this.elements.progress.setAttribute('aria-valuenow', percent);
    }
  }
}
