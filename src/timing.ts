import type { Board } from './game.ts';

/** Resolve early on cancellation, cleaning up both the timeout and listener. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function playReels(board: Board,
  land: (column: number, result: readonly number[], slammed: boolean) => Promise<void>,
  signal: AbortSignal, reducedMotion = false,
  onLanding?: (column: number, slammed: boolean) => void): Promise<void> {
  const notifyLanding = (column: number, slammed: boolean) => {
    try { onLanding?.(column, slammed); }
    catch { /* Optional sound effects must not interrupt reel settlement. */ }
  };
  const started = performance.now();
  const slamRemaining = async (first: number, pending: Promise<void>[] = []) => {
    const landings = await Promise.allSettled([
      ...pending,
      ...board.slice(first).map(async (result, offset) => land(first + offset, result, true)),
    ]);
    const failure = landings.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    notifyLanding(board.length - 1, true);
  };
  for (let column = 0; column < board.length; column++) {
    // Animation time belongs to the reel cadence, rather than adding a second pause.
    const due = reducedMotion ? 80 * (column + 1) : 1100 + 380 * column;
    const wait = Math.max(0, due - (performance.now() - started));
    if (wait > 0) await delay(wait, signal);
    if (signal.aborted) {
      // Only unfinished reels land, always using the preselected outcome.
      // Wait for every landing even if one fails, so no animation outlives its round.
      await slamRemaining(column);
      return;
    }
    let onAbort!: () => void;
    const aborted = new Promise<false>(resolve => {
      onAbort = () => resolve(false);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const landing = Promise.resolve(land(column, board[column], false));
      const completed = await Promise.race([landing.then(() => true), aborted]);
      if (!completed || signal.aborted) {
        // Stop can arrive during a normal brake: finish it once while the other reels
        // brake immediately, then play one combined sound for the whole remaining group.
        await slamRemaining(column + 1, [landing]);
        return;
      }
    } finally { signal.removeEventListener('abort', onAbort); }
    notifyLanding(column, false);
  }
}
