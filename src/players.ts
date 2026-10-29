import { BETS, STARTING_BALANCE, roundFromId } from './game.ts';

export const PLAYER_STORAGE_PREFIX = 'mystic-fortune.player.v1.';
export const ACTIVE_PLAYER_KEY = 'mystic-fortune.active-player.v1';
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'] as const;
type PlayerStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface PlayerProfile {
  readonly id: string;
  readonly balance: number;
  readonly bet: number;
  readonly currency: string;
  readonly sound: boolean;
  readonly elapsedMs: number;
  readonly lastRoundId: string | null;
  readonly lastReplay: boolean;
}

export function normalizePlayerId(input: string): string {
  if (typeof input !== 'string' || input.length > 100) throw new RangeError('Enter a valid player ID.');
  const id = input.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,47}$/.test(id)) {
    throw new RangeError('Use 3–48 letters, numbers, hyphens or underscores. Start with a letter or number.');
  }
  return id;
}

export function createPlayerId(): string {
  return 'P-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function freshPlayer(id: string): PlayerProfile {
  return Object.freeze({ id, balance: STARTING_BALANCE, bet: 10, currency: 'USD', sound: false,
    elapsedMs: 0, lastRoundId: null, lastReplay: false });
}

function validate(profile: PlayerProfile): void {
  if (!Number.isFinite(profile.balance) || profile.balance < 0
    || !Number.isSafeInteger(Math.round(profile.balance * 100))
    || !BETS.some(bet => bet === profile.bet)
    || !CURRENCIES.some(code => code === profile.currency)
    || typeof profile.sound !== 'boolean' || typeof profile.lastReplay !== 'boolean'
    || !Number.isSafeInteger(profile.elapsedMs) || profile.elapsedMs < 0) {
    throw new RangeError('Invalid saved player session.');
  }
  if (profile.lastRoundId !== null) roundFromId(profile.lastRoundId);
}

/** Local demo profiles: player IDs select a session; they are not authentication. */
export class PlayerStore {
  readonly createdInitialPlayer: boolean;
  private readonly storage: PlayerStorage | null;
  private readonly cache = new Map<string, PlayerProfile>();
  private active!: PlayerProfile;
  private persistent: boolean;

  constructor(storage: PlayerStorage | null) {
    this.storage = storage;
    this.persistent = storage !== null;
    let previous: string | null = null;
    let saved: string | null | undefined;
    try {
      saved = storage?.getItem(ACTIVE_PLAYER_KEY);
    } catch { this.persistent = false; }
    try { if (saved) previous = normalizePlayerId(saved); }
    catch { /* Replace an invalid active ID without touching any saved profiles. */ }
    this.createdInitialPlayer = previous === null;
    this.load(previous ?? createPlayerId());
  }

  get current(): PlayerProfile { return this.active; }
  get storageAvailable(): boolean { return this.persistent; }

  load(input: string): PlayerProfile {
    const id = normalizePlayerId(input);
    const profile = this.find(id);
    this.active = profile;
    this.write(PLAYER_STORAGE_PREFIX + id, JSON.stringify({ version: 1, ...profile }));
    this.write(ACTIVE_PLAYER_KEY, id);
    return profile;
  }

  /** Persist the destination before unloading; never fall back to a different player. */
  prepareReload(input: string): PlayerProfile {
    const id = normalizePlayerId(input);
    if (!this.storage) throw new Error('Browser storage is unavailable. Enable it before loading another player.');
    const profile = this.find(id);
    const saved = JSON.stringify({ version: 1, ...profile });
    try {
      this.storage.setItem(PLAYER_STORAGE_PREFIX + id, saved);
      this.storage.setItem(ACTIVE_PLAYER_KEY, id);
      if (this.storage.getItem(ACTIVE_PLAYER_KEY) !== id
        || this.storage.getItem(PLAYER_STORAGE_PREFIX + id) !== saved) throw new Error('Session was not saved.');
    } catch {
      this.persistent = false;
      this.write(ACTIVE_PLAYER_KEY, this.active.id);
      throw new Error('Could not save the player for reload. Check browser storage and try again.');
    }
    this.active = profile;
    this.persistent = true;
    return profile;
  }

  private find(id: string): PlayerProfile {
    let profile = this.cache.get(id);
    if (!profile) {
      profile = freshPlayer(id);
      try {
        const raw = this.storage?.getItem(PLAYER_STORAGE_PREFIX + id);
        if (raw && raw.length <= 10_000) {
          const data: unknown = JSON.parse(raw);
          if (typeof data === 'object' && data !== null && !Array.isArray(data)
            && 'version' in data && data.version === 1) {
            const saved = data as Record<string, unknown>;
            const candidate: PlayerProfile = {
              id, balance: saved.balance as number, bet: saved.bet as number,
              currency: saved.currency as string, sound: saved.sound as boolean,
              elapsedMs: saved.elapsedMs as number, lastRoundId: saved.lastRoundId as string | null,
              lastReplay: saved.lastReplay as boolean,
            };
            validate(candidate);
            profile = Object.freeze(candidate);
          }
        }
      } catch { /* A damaged profile cannot prevent switching to a usable session. */ }
      this.cache.set(id, profile);
    }
    return profile;
  }

  save(profile: PlayerProfile): PlayerProfile {
    if (profile.id !== this.active.id) throw new Error('Cannot save a different player over the active session.');
    validate(profile);
    this.active = Object.freeze({ ...profile, balance: Math.round(profile.balance * 100) / 100 });
    this.cache.set(profile.id, this.active);
    this.write(PLAYER_STORAGE_PREFIX + profile.id, JSON.stringify({ version: 1, ...this.active }));
    return this.active;
  }

  private write(key: string, value: string): void {
    if (!this.storage) return;
    try { this.storage.setItem(key, value); }
    catch { this.persistent = false; }
  }
}
