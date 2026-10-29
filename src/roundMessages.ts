import type { LineWin, SpinResult } from './game.ts';

export type RoundMessage =
  | { readonly kind: 'line'; readonly line: LineWin }
  | { readonly kind: 'game-over' };

/** Replay settled results without keeping a round busy or changing its credits. */
export class RoundMessageCycle {
  private readonly render: (entry: RoundMessage) => void;
  private readonly duration: number;
  private entries: readonly RoundMessage[] = [];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

  constructor(render: (entry: RoundMessage) => void, duration = 1700) {
    this.render = render;
    this.duration = duration;
  }

  get active(): boolean { return this.entries.length > 0; }

  start(result: SpinResult): void {
    this.stop();
    this.entries = [
      ...result.lines.map(line => ({ kind: 'line' as const, line })),
      { kind: 'game-over' },
    ];
    // The initial win presentation just ended: show Game Over before replaying it.
    this.index = this.entries.length - 1;
    this.refresh();
    this.schedule();
  }

  stop(): void {
    this.clearTimer();
    this.entries = [];
    this.index = 0;
  }

  refresh(): void {
    const entry = this.entries[this.index];
    if (entry) this.render(entry);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.clearTimer();
    if (!paused) {
      this.refresh();
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.paused || this.entries.length <= 1) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.index = (this.index + 1) % this.entries.length;
      this.refresh();
      this.schedule();
    }, this.duration);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
