export interface GameLease {
  readonly active: boolean;
  release(): void;
}

/** Hold an origin-wide Web Lock before reading or writing any player state. */
export async function withGameLock(
  locks: Pick<LockManager, 'request'> | undefined,
  start: (lease: GameLease) => void,
  blocked: (reason: string) => void,
): Promise<void> {
  if (!locks) {
    blocked('This browser cannot safely coordinate game sessions. Use a current browser with HTTPS.');
    return;
  }
  let started = false;
  try {
    await locks.request('mystic-fortune.active-game.v1', { ifAvailable: true }, async lock => {
      if (!lock) {
        blocked('Mystic Fortune is open in another tab. Close that tab, then try again here.');
        return;
      }
      let active = true;
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const lease: GameLease = {
        get active() { return active; },
        release() { active = false; release(); },
      };
      started = true;
      try { start(lease); await held; }
      finally { lease.release(); }
    });
  } catch (error) {
    if (started) throw error;
    blocked('The browser could not lock this game session. Close other game tabs and try again.');
  }
}
