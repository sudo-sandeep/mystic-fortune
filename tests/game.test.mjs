import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSession, BETS, PAYLINES, createBoard, forcedBoard, scoreBoard, validateBoard } from '../src/game.ts';
import { REEL_STRIP, REEL_STRIP_LENGTH, REEL_STRIPS, SYMBOLS } from '../src/reelConfig.ts';
import { delay, playReels } from '../src/timing.ts';

test('reel configuration contains valid symbols and wraps at its actual length', () => {
  assert.equal(REEL_STRIP_LENGTH, REEL_STRIP.length);
  assert.equal(REEL_STRIPS.length, 5);
  for (const strip of REEL_STRIPS) {
    assert.ok(strip.length >= 3);
    assert.ok(strip.every(symbol => Number.isInteger(symbol) && symbol >= 0 && symbol < SYMBOLS.length));
  }
  const board = createBoard(() => 1 - Number.EPSILON);
  assert.deepEqual(board[0], [REEL_STRIP.at(-1), REEL_STRIP[0], REEL_STRIP[1]]);
  validateBoard(board);
});

test('natural outcomes draw once per reel and remain within the strips', () => {
  let calls = 0;
  const board = createBoard(() => calls++ / 5);
  assert.equal(calls, 5);
  board.forEach((column, index) => {
    const stop = Math.floor(index / 5 * REEL_STRIP_LENGTH);
    assert.deepEqual(column, [0, 1, 2].map(row => REEL_STRIPS[index][(stop + row) % REEL_STRIP_LENGTH]));
  });
});

test('line awards use the fixed 92% paytable for three, four, and five matches', () => {
  for (const [kind, count, amount] of [['three', 3, 36.2], ['four', 4, 111.4], ['five', 5, 268.2]]) {
    const result = scoreBoard(forcedBoard(kind), 10);
    assert.equal(result.total, amount);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].lineIndex, 0);
    assert.equal(result.lines[0].count, count);
    assert.equal(result.lines[0].cells.length, count);
  }
});

test('diagonal paylines score and matching must begin at the leftmost reel', () => {
  const board = Array.from({ length: 5 }, (_, column) => [column, column + 1, column + 2]);
  for (const [column, row] of [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]]) board[column][row] = 9;
  const vLine = scoreBoard(board, 10).lines.find(line => line.lineIndex === 3);
  assert.equal(vLine?.count, 5);
  const rightMatches = Array.from({ length: 5 }, (_, column) => [column === 0 ? 0 : 1, column + 2, column + 4]);
  assert.equal(scoreBoard(rightMatches, 10).total, 0);
});

test('scatter remains a normal line symbol in this demo', () => {
  assert.equal(scoreBoard(forcedBoard('scatter'), 10).total, 268.2);
});

test('forced losses remain losses even with a constant random source', () => {
  for (const random of [() => 0, () => .5, () => 1 - Number.EPSILON]) {
    assert.equal(scoreBoard(forcedBoard('loss', random), 10).total, 0);
  }
});

test('malformed inputs are rejected before they produce invalid awards', () => {
  assert.throws(() => scoreBoard([], 10), RangeError);
  assert.throws(() => scoreBoard(Array.from({ length: 5 }, () => [0, -1, 2]), 10), RangeError);
  assert.throws(() => scoreBoard(forcedBoard('five'), Number.NaN), RangeError);
  assert.throws(() => scoreBoard(forcedBoard('five'), 0), RangeError);
  for (const value of [-1, 1, Number.NaN, Infinity]) {
    assert.throws(() => createBoard(() => value), RangeError);
  }
});

test('a round debits once and rejects duplicate starts and bet changes', () => {
  const session = new GameSession(100, 10);
  const round = session.startRound('five');
  assert.ok(round);
  assert.equal(session.balance, 90);
  assert.equal(session.startRound(), null);
  assert.throws(() => session.setBet(20), /during a round/);
  session.settleRound(round);
  assert.equal(session.balance, 358.2);
  assert.throws(() => session.settleRound(round), /already been credited/);
  session.finishRound(round);
  assert.equal(session.busy, false);
  assert.equal(session.balance, 358.2);
  assert.throws(() => session.settleRound(round), /no longer active/);
});

test('insufficient funds and invalid wagers never debit the balance', () => {
  const session = new GameSession(5, 10);
  assert.equal(session.startRound(), null);
  assert.equal(session.balance, 5);
  for (const value of [0, -1, 3, Number.NaN, Infinity]) assert.throws(() => session.setBet(value));
  session.setBet(5);
  const round = session.startRound('loss');
  assert.equal(session.balance, 0);
  session.settleRound(round);
  session.finishRound(round);
  assert.equal(session.balance, 0);
});

test('failed outcome generation leaves the balance and session unchanged', () => {
  const session = new GameSession(100, 10);
  assert.throws(() => session.startRound(null, () => Number.NaN), RangeError);
  assert.equal(session.balance, 100);
  assert.equal(session.busy, false);
});

test('an interrupted round refunds its wager exactly once', () => {
  const session = new GameSession(100, 10);
  const round = session.startRound('five');
  session.finishRound(round);
  assert.equal(session.balance, 100);
  assert.throws(() => session.finishRound(round), /no longer active/);
  assert.equal(session.balance, 100);
});

test('presentation failure after settlement preserves the credited award', () => {
  const session = new GameSession(100, 10);
  const round = session.startRound('big');
  session.settleRound(round);
  session.finishRound(round);
  assert.equal(session.balance, 6795);
});

test('forced Big Win pays the 25 actual winning lines using the new paytable', () => {
  const session = new GameSession(100, 10);
  const round = session.startRound('big');
  assert.equal(round.result.total, 6705);
  assert.equal(round.result.bonus, 0);
  assert.equal(round.result.lines.length, 25);
  assert.ok(round.result.lines.every(line => line.lineIndex >= 0 && line.lineIndex < PAYLINES.length));
});

test('round outcomes and awards cannot be changed after the wager is placed', () => {
  const round = new GameSession().startRound('five');
  assert.throws(() => { round.board[0][0] = 10; }, TypeError);
  assert.throws(() => { round.result.total = 1000; }, TypeError);
  assert.throws(() => { round.result.lines[0].cells[0][0] = 4; }, TypeError);
});

test('cent accounting stays exact across repeated fractional awards and wagers', () => {
  const session = new GameSession(100, 1);
  for (let index = 0; index < 100; index++) {
    const round = session.startRound('three');
    session.settleRound(round);
    session.finishRound(round);
  }
  assert.equal(session.balance, 362);
  for (const wager of BETS) assert.equal(scoreBoard(forcedBoard('five'), wager).total, wager * 26.82);
});

test('Stop lands each reel exactly once and preserves already landed reels', async () => {
  const controller = new AbortController();
  const board = new GameSession().startRound('five').board;
  const landings = [];
  await playReels(board, async (column, result, slammed) => {
    landings.push({ column, result, slammed });
    if (column === 1) controller.abort();
  }, controller.signal, true);
  assert.deepEqual(landings.map(landing => landing.column), [0, 1, 2, 3, 4]);
  assert.deepEqual(landings.map(landing => landing.slammed), [false, false, true, true, true]);
  for (const landing of landings) assert.equal(landing.result, board[landing.column]);
});

test('an immediate Stop uses the same frozen board for every reel', async () => {
  const controller = new AbortController();
  controller.abort();
  const board = new GameSession().startRound('four').board;
  const landings = [];
  await playReels(board, async (column, result, slammed) => {
    landings.push(column);
    assert.equal(result, board[column]);
    assert.equal(slammed, true);
  }, controller.signal);
  assert.deepEqual(landings, [0, 1, 2, 3, 4]);
});

test('a failed slam waits for other landings before releasing the round', async () => {
  const controller = new AbortController();
  controller.abort();
  let completed = 0;
  await assert.rejects(playReels(forcedBoard('five'), async column => {
    if (column === 0) throw new Error('Animation failed');
    await delay(10);
    completed++;
  }, controller.signal), /Animation failed/);
  assert.equal(completed, 4);
});

test('Skip cancellation immediately releases outstanding presentation waits', async () => {
  const controller = new AbortController();
  const wait = delay(60_000, controller.signal);
  controller.abort();
  await wait;
  await delay(60_000, controller.signal);
});
