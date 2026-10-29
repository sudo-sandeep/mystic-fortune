/** Focus containment and background isolation for the existing themed dialogs. */
export class Dialogs {
  private active: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private previousOverflow = '';
  private readonly options = new Map<HTMLElement, { exitMs?: () => number; onClose?: () => void }>();
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly background: readonly HTMLElement[];

  constructor(background: readonly HTMLElement[]) {
    this.background = background;
    document.addEventListener('keydown', event => {
      if (!this.active) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Tab') {
        const focusable = this.focusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !this.active.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !this.active.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    });
    document.addEventListener('focusin', event => {
      if (this.active && !this.active.contains(event.target as Node)) this.focusable()[0]?.focus();
    });
  }

  register(backdrop: HTMLElement, closeButton: HTMLButtonElement,
    options: { exitMs?: () => number; onClose?: () => void } = {}): void {
    this.options.set(backdrop, options);
    closeButton.addEventListener('click', () => this.close());
    backdrop.addEventListener('click', event => { if (event.target === backdrop) this.close(); });
  }

  get isOpen(): boolean { return this.active !== null; }

  open(backdrop: HTMLElement): void {
    this.close(true);
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousOverflow = document.body.style.overflow;
    backdrop.hidden = false;
    backdrop.classList.remove('is-closing');
    this.active = backdrop;
    for (const element of this.background) element.inert = true;
    document.body.style.overflow = 'hidden';
    (backdrop.querySelector<HTMLElement>('.selected') ?? this.focusable()[0])?.focus();
  }

  close(immediate = false): void {
    if (!this.active) return;
    if (!immediate) {
      if (this.closeTimer !== null) return;
      const exitMs = this.options.get(this.active)?.exitMs?.() ?? 0;
      if (exitMs > 0) {
        this.active.classList.add('is-closing');
        this.closeTimer = setTimeout(() => this.close(true), exitMs);
        return;
      }
    }
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    const closed = this.active;
    this.active.hidden = true;
    this.active.classList.remove('is-closing');
    this.active = null;
    for (const element of this.background) element.inert = false;
    document.body.style.overflow = this.previousOverflow;
    this.returnFocus?.focus();
    this.returnFocus = null;
    this.options.get(closed)?.onClose?.();
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.active?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]',
    ) ?? []);
  }
}
