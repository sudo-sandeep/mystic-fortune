/** Resolve and finish attached effects exactly when the counter finishes or is skipped. */
export function rollUpWin(amount: number, duration: number, update: (value: number) => void,
  signal: AbortSignal, onFinish: () => void = () => {}): Promise<void> {
  if (signal.aborted || duration <= 0) {
    update(amount);
    onFinish();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let frame = 0;
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      try {
        if (!error) update(amount);
      } catch (updateError) { error = updateError; }
      try { onFinish(); }
      catch (finishError) { error ??= finishError; }
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish();
    const tick = (now: number) => {
      if (finished) return;
      try {
        const progress = Math.min(1, (now - start) / duration);
        update(Math.round(amount * progress * 100) / 100);
        if (progress < 1) frame = requestAnimationFrame(tick);
        else finish();
      } catch (error) { finish(error); }
    };
    // Background tabs may pause animation frames while the rollup's clock continues.
    const timer = setTimeout(() => finish(), duration);
    signal.addEventListener('abort', onAbort, { once: true });
    frame = requestAnimationFrame(tick);
  });
}
