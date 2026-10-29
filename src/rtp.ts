import { PAYLINES } from './game.ts';
import { BASE_LINE_PAYS, calculateLineAward } from './paytable.ts';
import { REEL_STRIPS, SYMBOLS } from './reelConfig.ts';

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Exact expectation over all reel stops, including per-line cent rounding. */
export function analyzeRtp(wager = 1, pays: Readonly<Record<3 | 4 | 5, number>> = BASE_LINE_PAYS,
  strips: readonly (readonly number[])[] = REEL_STRIPS, lineCount = PAYLINES.length) {
  const wagerCents = Math.round(wager * 100);
  if (!Number.isFinite(wager) || wagerCents <= 0 || !Number.isSafeInteger(wagerCents)
    || strips.length !== 5 || !Number.isSafeInteger(lineCount) || lineCount <= 0
    || ([3, 4, 5] as const).some(count => !Number.isFinite(pays[count]) || pays[count] < 0)) throw new RangeError('Invalid RTP configuration.');
  const frequencies = strips.map(strip => {
    if (strip.length === 0 || strip.some(symbol => !Number.isInteger(symbol) || symbol < 0 || symbol >= SYMBOLS.length)) {
      throw new RangeError('Invalid reel strip for RTP analysis.');
    }
    return SYMBOLS.map((_, symbol) => BigInt(strip.filter(entry => entry === symbol).length));
  });
  const lengths = strips.map(strip => BigInt(strip.length));
  const combinations = lengths.reduce((product, length) => product * length, 1n);
  const matchCombinations: Record<3 | 4 | 5, bigint> = { 3: 0n, 4: 0n, 5: 0n };
  for (let symbol = 0; symbol < SYMBOLS.length; symbol++) {
    const firstThree = frequencies[0][symbol] * frequencies[1][symbol] * frequencies[2][symbol];
    matchCombinations[3] += firstThree * (lengths[3] - frequencies[3][symbol]) * lengths[4];
    matchCombinations[4] += firstThree * frequencies[3][symbol] * (lengths[4] - frequencies[4][symbol]);
    matchCombinations[5] += firstThree * frequencies[3][symbol] * frequencies[4][symbol];
  }
  // Each row is a circular shift of its strip and has the same symbol frequencies.
  // Linearity of expectation includes every overlapping payline without assuming independent wins.
  const awardCents = Object.fromEntries(([3, 4, 5] as const).map(count => [count,
    pays === BASE_LINE_PAYS ? Math.round(calculateLineAward(count, wager) * 100) : Math.round(pays[count] * wager * 100),
  ])) as Record<3 | 4 | 5, number>;
  if (Object.values(awardCents).some(value => !Number.isSafeInteger(value))) throw new RangeError('RTP awards exceed the supported range.');
  const numerator = BigInt(lineCount) * ([3, 4, 5] as const).reduce((total, count) =>
    total + matchCombinations[count] * BigInt(awardCents[count]), 0n);
  const denominator = combinations * BigInt(wagerCents);
  const divisor = gcd(numerator, denominator);
  return {
    wager, awardCents, combinations, matchCombinations,
    numerator: numerator / divisor, denominator: denominator / divisor,
    rtpPercent: Number(numerator) / Number(denominator) * 100,
    expectedReturn: Number(numerator) / Number(combinations) / 100,
  };
}
