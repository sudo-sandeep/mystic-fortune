import type { Board } from './game.ts';

/** MF1 stores the outcome and original awards, independent of RNG and browser storage. */
export interface RoundData {
  board: Board;
  wager: number;
  bonus: number;
  lineAwards: readonly [number, number, number];
}

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

function amount(value: number): string {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) || cents > 99_999_999) {
    throw new RangeError('Invalid amount in round ID.');
  }
  return cents.toString(36).toUpperCase();
}

export function createRoundId(data: RoundData): string {
  const symbols = data.board.flat();
  if (data.board.length !== 5 || data.board.some(column => column.length !== 3)
    || symbols.some(symbol => !Number.isInteger(symbol) || symbol < 0 || symbol > 10)) {
    throw new RangeError('Invalid board in round ID.');
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const payload = ['MF1', nonce, amount(data.wager), amount(data.bonus),
    symbols.map(symbol => symbol.toString(16)).join('').toUpperCase(), ...data.lineAwards.map(amount)].join('-');
  return `${payload}-${checksum(payload)}`;
}

export function readRoundId(input: string): RoundData & { id: string } {
  if (typeof input !== 'string' || input.length > 160) throw new RangeError('Invalid round ID.');
  const id = input.trim().toUpperCase();
  if (!/^MF1-[0-9A-F]{32}-[0-9A-Z]{1,6}-[0-9A-Z]{1,6}-[0-9A]{15}(?:-[0-9A-Z]{1,6}){3}-[0-9A-F]{8}$/.test(id)) {
    throw new RangeError('Enter a complete Mystic Fortune round ID (MF1).');
  }
  const [version, nonce, wager, bonus, symbols, three, four, five, check] = id.split('-');
  const payload = [version, nonce, wager, bonus, symbols, three, four, five].join('-');
  if (checksum(payload) !== check) throw new RangeError('Round ID is incomplete or has a typing error.');
  const value = (part: string) => {
    const number = parseInt(part, 36);
    if (number > 99_999_999 || number.toString(36).toUpperCase() !== part) throw new RangeError('Invalid round ID amount.');
    return number / 100;
  };
  return {
    id, wager: value(wager), bonus: value(bonus),
    board: Array.from({ length: 5 }, (_, column) =>
      Array.from({ length: 3 }, (_, row) => parseInt(symbols[column * 3 + row], 16))),
    lineAwards: [value(three), value(four), value(five)],
  };
}

/** Stable cosmetic reel strips for the same round, separate from outcome selection. */
export function roundAnimationRandom(id: string): () => number {
  let state = parseInt(checksum(id), 16);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
}
