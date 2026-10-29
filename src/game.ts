import { calculateLineAward } from './paytable.ts';
import { REEL_STRIPS, SYMBOLS } from './reelConfig.ts';
import { createRoundId, readRoundId } from './roundId.ts';

export const ROW_COUNT = 3;
export const REEL_COUNT = REEL_STRIPS.length;
export const STARTING_BALANCE = 10_000;
export const BETS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const;
export type Board = readonly (readonly number[])[];
export type ForceKind = 'big' | 'five' | 'four' | 'three' | 'loss' | 'scatter';

export const PAYLINES = [
  // Exact order from the supplied 25-line configuration; 0 = top, 1 = middle, 2 = bottom.
  { label: 'LINE 1', rows: [1, 1, 1, 1, 1] },
  { label: 'LINE 2', rows: [0, 0, 0, 0, 0] },
  { label: 'LINE 3', rows: [2, 2, 2, 2, 2] },
  { label: 'LINE 4', rows: [0, 1, 2, 1, 0] },
  { label: 'LINE 5', rows: [2, 1, 0, 1, 2] },
  { label: 'LINE 6', rows: [0, 0, 1, 2, 2] },
  { label: 'LINE 7', rows: [2, 2, 1, 0, 0] },
  { label: 'LINE 8', rows: [1, 0, 1, 2, 1] },
  { label: 'LINE 9', rows: [1, 2, 1, 0, 1] },
  { label: 'LINE 10', rows: [0, 1, 1, 1, 0] },
  { label: 'LINE 11', rows: [2, 1, 1, 1, 2] },
  { label: 'LINE 12', rows: [1, 0, 0, 1, 2] },
  { label: 'LINE 13', rows: [1, 2, 2, 1, 0] },
  { label: 'LINE 14', rows: [1, 1, 0, 1, 2] },
  { label: 'LINE 15', rows: [1, 1, 2, 1, 0] },
  { label: 'LINE 16', rows: [0, 0, 1, 2, 1] },
  { label: 'LINE 17', rows: [2, 2, 1, 0, 1] },
  { label: 'LINE 18', rows: [1, 0, 1, 2, 2] },
  { label: 'LINE 19', rows: [1, 2, 1, 0, 0] },
  { label: 'LINE 20', rows: [0, 0, 0, 1, 2] },
  { label: 'LINE 21', rows: [2, 2, 2, 1, 0] },
  { label: 'LINE 22', rows: [0, 1, 2, 2, 2] },
  { label: 'LINE 23', rows: [2, 1, 0, 0, 0] },
  { label: 'LINE 24', rows: [0, 1, 0, 1, 0] },
  { label: 'LINE 25', rows: [2, 1, 2, 1, 2] },
] as const;

export interface LineWin {
  readonly lineIndex: number;
  readonly count: number;
  readonly amount: number;
  readonly cells: readonly (readonly [number, number])[];
}

export interface SpinResult {
  readonly total: number;
  readonly lines: readonly LineWin[];
  readonly bonus: number;
}

export interface Round {
  readonly id: string;
  readonly board: Board;
  readonly wager: number;
  readonly result: SpinResult;
}

function freezeRound(id: string, board: Board, wager: number, scored: SpinResult, bonus: number): Round {
  return Object.freeze({
    id, board: Object.freeze(board.map(column => Object.freeze([...column]))), wager,
    result: Object.freeze({
      total: (cents(scored.total) + cents(bonus)) / 100, bonus,
      lines: Object.freeze(scored.lines.map(line => Object.freeze({
        ...line,
        cells: Object.freeze(line.cells.map(cell => Object.freeze([...cell] as [number, number]))),
      }))),
    }),
  });
}

export function roundFromId(id: string): Round {
  const data = readRoundId(id);
  if (!BETS.some(bet => bet === data.wager)) throw new RangeError('Unsupported wager in round ID.');
  // Preserve original awards even if the current paytable changes later.
  // MF1 uses the 25 payline paths above; a path/symbol change requires a new ID version.
  const scored = scoreBoard(data.board, data.wager);
  const lines = scored.lines.map(line => ({ ...line, amount: data.lineAwards[line.count - 3] }));
  return freezeRound(data.id, data.board, data.wager, {
    total: lines.reduce((sum, line) => sum + cents(line.amount), 0) / 100, lines, bonus: 0,
  }, data.bonus);
}

function cents(value: number): number {
  const result = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result)) {
    throw new RangeError('Credits must be a finite, non-negative amount.');
  }
  return result;
}

export function validateBoard(board: Board): void {
  if (board.length !== REEL_COUNT || board.some(column =>
    column.length !== ROW_COUNT || column.some(symbol =>
      !Number.isInteger(symbol) || symbol < 0 || symbol >= SYMBOLS.length))) {
    throw new RangeError('Invalid reel board.');
  }
}

function randomIndex(length: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a value from 0 up to 1.');
  }
  return Math.floor(value * length);
}

export function createBoard(random: () => number = Math.random): Board {
  return REEL_STRIPS.map(strip => {
    const stop = randomIndex(strip.length, random);
    return Array.from({ length: ROW_COUNT }, (_, row) => strip[(stop + row) % strip.length]);
  });
}

export function scoreBoard(board: Board, wager: number): SpinResult {
  validateBoard(board);
  if (cents(wager) === 0) throw new RangeError('Wager must be positive.');
  const lines: LineWin[] = [];
  for (const [lineIndex, line] of PAYLINES.entries()) {
    const symbol = board[0][line.rows[0]];
    let count = 1;
    while (count < REEL_COUNT && board[count][line.rows[count]] === symbol) count++;
    if (count < 3) continue;
    lines.push({
      lineIndex,
      count,
      amount: calculateLineAward(count as 3 | 4 | 5, wager),
      cells: Array.from({ length: count }, (_, column) => [column, line.rows[column]] as const),
    });
  }
  return { total: lines.reduce((sum, line) => sum + cents(line.amount), 0) / 100, lines, bonus: 0 };
}

export function forcedBoard(kind: ForceKind, random: () => number = Math.random): Board {
  const out = Array.from({ length: REEL_COUNT }, (_, column) =>
    Array.from({ length: ROW_COUNT }, (_, row) => (column * 3 + row * 4 + 1) % SYMBOLS.length));
  if (kind === 'big') return out.map(() => [0, 0, 0]);
  if (kind === 'five' || kind === 'four' || kind === 'three') {
    const count = kind === 'five' ? 5 : kind === 'four' ? 4 : 3;
    for (let column = 0; column < count; column++) out[column][1] = 2;
    if (count < REEL_COUNT) out[count][1] = 3;
    return out;
  }
  if (kind === 'scatter') {
    for (const column of out) column[1] = SYMBOLS.indexOf('Scatter');
    return out;
  }
  if (kind !== 'loss') throw new RangeError('Unknown forced outcome.');
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const column of out) {
      for (let row = 0; row < ROW_COUNT; row++) column[row] = randomIndex(SYMBOLS.length, random);
    }
    if (scoreBoard(out, 1).total === 0) return out;
  }
  // Deterministic fallback also works with an adversarial or constant random source.
  return out.map((_, column) => Array.from({ length: ROW_COUNT }, (_, row) =>
    (column * 3 + row * 4) % SYMBOLS.length));
}

export class GameSession {
  private balanceCents: number;
  private betCents: number;
  private activeRound: Round | null = null;
  private settled = false;
  private replaying = false;

  constructor(balance = STARTING_BALANCE, bet = 10) {
    this.balanceCents = cents(balance);
    this.betCents = cents(bet);
    this.setBet(bet);
  }

  get balance(): number { return this.balanceCents / 100; }
  get bet(): number { return this.betCents / 100; }
  get busy(): boolean { return this.activeRound !== null; }
  get roundSettled(): boolean { return this.settled; }

  setBet(bet: number): void {
    if (this.busy) throw new Error('Cannot change the wager during a round.');
    if (!BETS.some(value => value === bet)) throw new RangeError('Unsupported wager.');
    this.betCents = cents(bet);
  }

  startRound(force: ForceKind | null = null, random: () => number = Math.random): Round | null {
    if (this.busy || this.balanceCents < this.betCents) return null;
    // Compute and freeze the entire outcome before debiting or animating it.
    const board = force ? forcedBoard(force, random) : createBoard(random);
    const scored = scoreBoard(board, this.bet);
    const bonus = force === 'big' ? Math.max(0, this.betCents * 25 - cents(scored.total)) / 100 : 0;
    const id = createRoundId({
      board, wager: this.bet, bonus,
      lineAwards: [calculateLineAward(3, this.bet), calculateLineAward(4, this.bet), calculateLineAward(5, this.bet)],
    });
    const round = freezeRound(id, board, this.bet, scored, bonus);
    this.balanceCents -= this.betCents;
    this.activeRound = round;
    this.settled = false;
    this.replaying = false;
    return round;
  }

  startReplay(id: string): Round | null {
    if (this.busy) return null;
    const round = roundFromId(id);
    this.activeRound = round;
    this.settled = false;
    this.replaying = true;
    return round;
  }

  settleRound(round: Round): void {
    this.assertActive(round);
    if (this.settled) throw new Error('Round has already been credited.');
    const balance = this.balanceCents + (this.replaying ? 0 : cents(round.result.total));
    if (!Number.isSafeInteger(balance)) throw new RangeError('Credit balance exceeds the supported range.');
    this.balanceCents = balance;
    this.settled = true;
  }

  finishRound(round: Round): void {
    this.assertActive(round);
    // Animation failures before settlement return the wager. Credited wins stay credited.
    if (!this.settled && !this.replaying) this.balanceCents += cents(round.wager);
    this.activeRound = null;
    this.settled = false;
    this.replaying = false;
  }

  private assertActive(round: Round): void {
    if (this.activeRound !== round) throw new Error('Round is no longer active.');
  }
}
