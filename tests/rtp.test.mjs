import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRtp } from '../src/rtp.ts';
import { BETS, ROW_COUNT, scoreBoard } from '../src/game.ts';
import { BASE_LINE_PAYS, TARGET_RTP_PERCENT } from '../src/paytable.ts';

test('the full natural game has exactly 92% theoretical RTP at every supported bet', () => {
  for (const bet of BETS) {
    const result = analyzeRtp(bet);
    assert.equal(result.numerator, 23n);
    assert.equal(result.denominator, 25n);
    assert.equal(result.rtpPercent, TARGET_RTP_PERCENT);
    assert.equal(result.rtpPercent, 92);
  }
  assert.equal(analyzeRtp(100).expectedReturn, 92);
  assert.equal(analyzeRtp(1).combinations, 53_782_400_000n);
});

test('the previous game returned approximately 3.00983% rather than 92%', () => {
  const result = analyzeRtp(100, { 3: .12, 4: .35, 5: .85 });
  assert.equal(result.numerator, 80_937_939n);
  assert.equal(result.denominator, 2_689_120_000n);
  assert.ok(Math.abs(result.rtpPercent - 3.009829944368418) < 1e-12);
});

test('the exact analysis agrees with exhaustive scoring of correlated and overlapping paylines', () => {
  // Unequal, short circular strips keep the complete sample space small enough to enumerate.
  const strips = [[0, 0, 1], [1, 0], [0, 1, 1], [0, 1], [1, 0, 0]];
  const expected = analyzeRtp(1, BASE_LINE_PAYS, strips);
  let count = 0;
  let payoutCents = 0n;
  const stops = [];
  const enumerate = column => {
    if (column === 5) {
      const board = strips.map((strip, reel) => Array.from({ length: ROW_COUNT }, (_, row) =>
        strip[(stops[reel] + row) % strip.length]));
      payoutCents += BigInt(Math.round(scoreBoard(board, 1).total * 100));
      count++;
      return;
    }
    for (let stop = 0; stop < strips[column].length; stop++) {
      stops[column] = stop;
      enumerate(column + 1);
    }
  };
  enumerate(0);
  assert.equal(expected.numerator * BigInt(count) * 100n, expected.denominator * payoutCents);
});

test('RTP input validation rejects invalid bets, awards and reel strips', () => {
  for (const bet of [0, -1, NaN, Infinity]) assert.throws(() => analyzeRtp(bet), RangeError);
  assert.throws(() => analyzeRtp(1, { 3: NaN, 4: 1, 5: 2 }), RangeError);
  assert.throws(() => analyzeRtp(1, { 3: 1e100, 4: 1, 5: 2 }), RangeError);
  assert.throws(() => analyzeRtp(1, BASE_LINE_PAYS, [[], [0], [0], [0], [0]]), RangeError);
  assert.throws(() => analyzeRtp(1, BASE_LINE_PAYS, [[0], [0], [11], [0], [0]]), RangeError);
});
