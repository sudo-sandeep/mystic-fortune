import { roundFromId, type Round } from './game.ts';

const KEY = 'mystic-fortune.rounds.v1';
export const ROUND_HISTORY_LIMIT = 30;
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage is optional: a copied ID always works without a local history entry. */
export class RoundHistory {
  private ids: string[] = [];
  private readonly storage: HistoryStorage | null;
  private readonly key: string;

  constructor(storage: HistoryStorage | null, playerId?: string, importLegacy = false, committedIds: readonly string[] = []) {
    this.storage = storage;
    this.key = playerId ? `${KEY}.${playerId}` : KEY;
    this.ids = [...committedIds];
    try {
      const raw = storage?.getItem(this.key) ?? (importLegacy ? storage?.getItem(KEY) : null);
      if (!raw || raw.length > 10_000) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const id of parsed.slice(0, ROUND_HISTORY_LIMIT)) {
        try {
          const round = roundFromId(id);
          if (!this.ids.includes(round.id) && this.ids.length < ROUND_HISTORY_LIMIT) this.ids.push(round.id);
        } catch { /* Ignore damaged or unsupported entries individually. */ }
      }
      if (importLegacy) this.persist();
    } catch { /* Disabled storage must never prevent the game from loading. */ }
  }

  get rounds(): readonly Round[] { return this.ids.map(roundFromId); }

  remember(round: Round): void {
    this.ids = [round.id, ...this.ids.filter(id => id !== round.id)].slice(0, ROUND_HISTORY_LIMIT);
    this.persist();
  }

  private persist(): void {
    try { this.storage?.setItem(this.key, JSON.stringify(this.ids)); }
    catch { /* The ID remains usable and this session's history still works. */ }
  }
}
