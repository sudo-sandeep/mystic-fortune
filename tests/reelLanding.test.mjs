import assert from 'node:assert/strict';
import test from 'node:test';
import { reelLandingPlan, NORMAL_LANDING_MS, SLAM_LANDING_MS } from '../src/reelLanding.ts';
import { playReels, delay } from '../src/timing.ts';
import { forcedBoard } from '../src/game.ts';

test('normal braking preserves the visible symbols and joins the spin at the same velocity', () => {
  for (const height of [57.5, 138]) {
    for (const position of [0, .1, 3.5, 7.875, 11.999]) {
      const currentY = -position * height;
      const plan = reelLandingPlan(currentY, height, false);
      const oldVisibleTop = currentY + plan.firstVisible * height;
      const newVisibleTop = plan.fromY + plan.leadRows * height;
      assert.ok(Math.abs(newVisibleTop - oldVisibleTop) < 1e-8, 'the bridge must not jump at the handoff');
      const [, x1, y1] = plan.easing.match(/cubic-bezier\(([^,]+),([^,]+)/).map(Number);
      const initialVelocity = -plan.fromY / plan.duration * y1 / x1;
      assert.ok(Math.abs(initialVelocity - 12 * height / 850) < 1e-8, 'normal landing must not abruptly change speed');
      assert.ok(y1 > 0 && y1 < 1);
      assert.equal(plan.duration, NORMAL_LANDING_MS);
      assert.equal(plan.leadRows, 3);
    }
  }
});

test('slam keeps its existing four-row brake and 650ms easing', () => {
  const plan = reelLandingPlan(-725, 100, true);
  assert.equal(plan.fromY, -425);
  assert.equal(plan.duration, SLAM_LANDING_MS);
  assert.equal(plan.easing, 'cubic-bezier(.26,.55,.30,1)');
  assert.equal(plan.leadRows, 4);
  assert.throws(() => reelLandingPlan(0, 0, false), RangeError);
});

function clock(context) {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  context.mock.method(performance, 'now', () => Date.now());
  return async ms => {
    context.mock.timers.tick(ms);
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  };
}

test('normal braking keeps the 380ms reel stagger instead of adding a pause after every animation', async context => {
  const advance = clock(context);
  const starts = [];
  const sounds = [];
  const playing = playReels(forcedBoard('loss'), async column => {
    starts.push({ column, time: Date.now() });
    await delay(NORMAL_LANDING_MS);
  }, new AbortController().signal, false, column => sounds.push({ column, time: Date.now() }));
  await advance(1100);
  for (let reel = 0; reel < 5; reel++) await advance(380);
  await playing;
  assert.deepEqual(starts.map(entry => entry.time), [1100, 1480, 1860, 2240, 2620]);
  assert.deepEqual(sounds.map(entry => entry.time), [1480, 1860, 2240, 2620, 3000]);
  assert.deepEqual(sounds.map(entry => entry.column), [0, 1, 2, 3, 4]);
});

test('Stop during a normal brake immediately brakes the other reels and plays one combined sound', async context => {
  const advance = clock(context);
  const controller = new AbortController();
  const starts = [];
  const sounds = [];
  const playing = playReels(forcedBoard('five'), async (column, _result, slammed) => {
    starts.push({ column, slammed, time: Date.now() });
    await delay(slammed ? SLAM_LANDING_MS : NORMAL_LANDING_MS);
  }, controller.signal, false, (column, slammed) => sounds.push({ column, slammed, time: Date.now() }));
  await advance(1100);
  await advance(150);
  controller.abort();
  await advance(0);
  assert.deepEqual(starts, [
    { column: 0, slammed: false, time: 1100 },
    ...[1, 2, 3, 4].map(column => ({ column, slammed: true, time: 1250 })),
  ]);
  await advance(230);
  assert.deepEqual(sounds, []);
  await advance(420);
  await playing;
  assert.deepEqual(sounds, [{ column: 4, slammed: true, time: 1900 }]);
});

test('Stop during the last normal brake still produces exactly one final landing sound', async context => {
  const advance = clock(context);
  const controller = new AbortController();
  const sounds = [];
  let landings = 0;
  const playing = playReels(forcedBoard('five'), async () => {
    landings++;
    await delay(NORMAL_LANDING_MS);
  }, controller.signal, false, (column, slammed) => sounds.push({ column, slammed }));
  await advance(1100);
  for (let reel = 0; reel < 4; reel++) await advance(380);
  await advance(100);
  controller.abort();
  await advance(280);
  await playing;
  assert.equal(landings, 5);
  assert.deepEqual(sounds, [
    ...[0, 1, 2, 3].map(column => ({ column, slammed: false })),
    { column: 4, slammed: true },
  ]);
});

test('a failing normal brake during Stop waits for the remaining animations before reporting failure', async context => {
  const advance = clock(context);
  const controller = new AbortController();
  let completed = 0;
  let sounds = 0;
  const playing = playReels(forcedBoard('five'), async (_column, _result, slammed) => {
    await delay(slammed ? SLAM_LANDING_MS : NORMAL_LANDING_MS);
    if (!slammed) throw new Error('Normal brake failed');
    completed++;
  }, controller.signal, false, () => sounds++);
  const rejected = assert.rejects(playing, /Normal brake failed/);
  await advance(1100);
  await advance(150);
  controller.abort();
  await advance(0);
  await advance(230);
  assert.equal(completed, 0);
  await advance(420);
  await rejected;
  assert.equal(completed, 4);
  assert.equal(sounds, 0);
});
