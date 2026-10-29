import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYLINES, scoreBoard } from '../src/game.ts';

// Transcribed from the user's reference, including its line-number order.
const reference = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [1, 0, 0, 1, 2],
  [1, 2, 2, 1, 0], [1, 1, 0, 1, 2], [1, 1, 2, 1, 0],
  [0, 0, 1, 2, 1], [2, 2, 1, 0, 1], [1, 0, 1, 2, 2],
  [1, 2, 1, 0, 0], [0, 0, 0, 1, 2], [2, 2, 2, 1, 0],
  [0, 1, 2, 2, 2], [2, 1, 0, 0, 0], [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
];

test('all 25 configured paylines match the supplied reference in order', () => {
  assert.deepEqual(PAYLINES.map(line => [...line.rows]), reference);
  assert.equal(new Set(PAYLINES.map(line => line.rows.join(','))).size, 25);
});

test('every supplied path scores and highlights the correct three, four, and five cells', () => {
  for (const [lineIndex, rows] of reference.entries()) {
    for (const [matches, expectedAward] of [[3, 36.2], [4, 111.4], [5, 268.2]]) {
      // Unmatched cells have a different symbol on each reel, so the target run
      // ends exactly at the chosen match count, even on overlapping paylines.
      const board = Array.from({ length: 5 }, (_, column) => [column, column, column]);
      for (let column = 0; column < matches; column++) board[column][rows[column]] = 10;
      const result = scoreBoard(board, 10);
      const win = result.lines.find(line => line.lineIndex === lineIndex);
      assert.ok(win, `Missing win on line ${lineIndex + 1} with ${matches} matches`);
      assert.equal(win.count, matches);
      assert.equal(win.amount, expectedAward);
      assert.deepEqual(win.cells, rows.slice(0, matches).map((row, column) => [column, row]));
    }
  }
});

test('overlapping lines pay separately and their awards sum exactly', () => {
  const fullBoard = Array.from({ length: 5 }, () => [0, 0, 0]);
  const result = scoreBoard(fullBoard, 10);
  assert.equal(result.lines.length, 25);
  assert.equal(result.total, 6705);
  assert.deepEqual(result.lines.map(line => line.lineIndex), Array.from({ length: 25 }, (_, index) => index));
});

test('paths sharing their first three cells remain distinct paying lines', () => {
  const board = Array.from({ length: 5 }, (_, column) => [column, column, column]);
  for (let column = 0; column < 3; column++) board[column][0] = 10;
  const result = scoreBoard(board, 10);
  assert.deepEqual(result.lines.map(line => line.lineIndex + 1), [2, 20]);
  assert.equal(result.total, 72.4);
});
