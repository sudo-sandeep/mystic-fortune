import assert from 'node:assert/strict';
import test from 'node:test';
import { RoundMessageCycle } from '../src/roundMessages.ts';

const result = {
  lines: [
    { lineIndex: 0, count: 3, amount: 1.2, cells: [[0, 1], [1, 1], [2, 1]] },
    { lineIndex: 24, count: 4, amount: 3.5, cells: [[0, 2], [1, 1], [2, 2], [3, 1]] },
  ],
  total: 4.7,
  bonus: 0,
};
const describe = entry => entry.kind === 'line' ? `line ${entry.line.lineIndex + 1}` : entry.kind;

test('completed wins and Game Over repeat in order over multiple cycles', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.start(result);
  for (let step = 0; step < 7; step++) context.mock.timers.tick(1700);
  assert.deepEqual(messages, [
    'game-over', 'line 1', 'line 25', 'game-over', 'line 1', 'line 25', 'game-over', 'line 1',
  ]);
  cycle.stop();
});

test('Spin cancellation prevents old messages from overwriting the next round', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.start(result);
  context.mock.timers.tick(1700);
  cycle.stop();
  messages.push('Good luck');
  context.mock.timers.tick(60_000);
  assert.equal(cycle.active, false);
  assert.deepEqual(messages, ['game-over', 'line 1', 'Good luck']);
});

test('a new result replaces the previous loop without duplicate timers', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.start(result);
  context.mock.timers.tick(500);
  cycle.start({ ...result, lines: [result.lines[1]] });
  context.mock.timers.tick(1200);
  assert.deepEqual(messages, ['game-over', 'game-over']);
  context.mock.timers.tick(500);
  assert.deepEqual(messages, ['game-over', 'game-over', 'line 25']);
  cycle.stop();
});

test('refresh reformats the current award without restarting the sequence', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let currency = 'USD';
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(entry.kind === 'line'
    ? `${currency} ${entry.line.amount}` : 'game-over'));
  cycle.start(result);
  context.mock.timers.tick(1700);
  currency = 'INR';
  cycle.refresh();
  context.mock.timers.tick(1700);
  assert.deepEqual(messages, ['game-over', 'USD 1.2', 'INR 1.2', 'INR 3.5']);
  cycle.stop();
});

test('a no-win round stays on Game Over without an unnecessary repeating timer', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.start({ lines: [], total: 0, bonus: 0 });
  context.mock.timers.tick(60_000);
  assert.equal(cycle.active, true);
  assert.deepEqual(messages, ['game-over']);
  cycle.stop();
});

test('hidden tabs pause and resume one cycle at a time', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.start(result);
  context.mock.timers.tick(1700);
  cycle.setPaused(true);
  context.mock.timers.tick(60_000);
  assert.deepEqual(messages, ['game-over', 'line 1']);
  cycle.setPaused(false);
  cycle.setPaused(false);
  context.mock.timers.tick(1700);
  assert.deepEqual(messages, ['game-over', 'line 1', 'line 1', 'line 25']);
  cycle.stop();
});

test('a round completed while hidden waits to begin replaying', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  cycle.setPaused(true);
  cycle.start(result);
  context.mock.timers.tick(60_000);
  assert.deepEqual(messages, ['game-over']);
  cycle.setPaused(false);
  context.mock.timers.tick(1700);
  assert.equal(messages.at(-1), 'line 1');
  cycle.stop();
});

test('bonus amounts do not add messages or extra pauses to the repeating line-win sequence', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = [];
  const cycle = new RoundMessageCycle(entry => messages.push(describe(entry)));
  const bonusResult = { ...result, bonus: 10, total: 14.7 };
  cycle.start(bonusResult);
  for (let step = 0; step < 6; step++) context.mock.timers.tick(1700);
  assert.deepEqual(messages, ['game-over', 'line 1', 'line 25', 'game-over', 'line 1', 'line 25', 'game-over']);
  assert.equal(bonusResult.total, 14.7);
  assert.equal(bonusResult.bonus, 10);
  cycle.stop();
});
