import assert from 'node:assert/strict';
import test from 'node:test';
import { rollUpWin } from '../src/winRollup.ts';

function frames(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let callback;
  let cancellations = 0;
  globalThis.requestAnimationFrame = next => { callback = next; return 1; };
  globalThis.cancelAnimationFrame = () => { cancellations++; };
  context.after(() => {
    if (originalRequest) globalThis.requestAnimationFrame = originalRequest;
    else delete globalThis.requestAnimationFrame;
    if (originalCancel) globalThis.cancelAnimationFrame = originalCancel;
    else delete globalThis.cancelAnimationFrame;
  });
  return { run: time => callback(time), cancellations: () => cancellations };
}

test('sound and shower finish together at the rollup deadline even with paused frames', async context => {
  frames(context);
  let soundStops = 0;
  let showerStops = 0;
  const updates = [];
  const counting = rollUpWin(250, 1000, value => updates.push(value), new AbortController().signal, () => {
    soundStops++; showerStops++;
  });
  context.mock.timers.tick(999);
  assert.equal(soundStops, 0);
  assert.equal(showerStops, 0);
  context.mock.timers.tick(1);
  await counting;
  assert.deepEqual(updates, [250]);
  assert.equal(soundStops, 1);
  assert.equal(showerStops, 1);
  context.mock.timers.tick(60_000);
  assert.equal(showerStops, 1);
});

test('Skip immediately finishes the counter and effects, and stale frames cannot restart them', async context => {
  const clock = frames(context);
  const controller = new AbortController();
  let stops = 0;
  const updates = [];
  const counting = rollUpWin(250, 21_000, value => updates.push(value), controller.signal, () => stops++);
  controller.abort();
  assert.equal(stops, 1);
  await counting;
  clock.run(performance.now() + 50_000);
  context.mock.timers.tick(60_000);
  assert.deepEqual(updates, [250]);
  assert.equal(stops, 1);
  assert.equal(clock.cancellations(), 1);
});

test('an animation frame completing the counter also ends effects exactly once', async context => {
  const clock = frames(context);
  let stops = 0;
  const counting = rollUpWin(250, 1000, () => {}, new AbortController().signal, () => stops++);
  clock.run(performance.now() + 2000);
  await counting;
  context.mock.timers.tick(60_000);
  assert.equal(stops, 1);
});

test('instant reduced-motion rollups leave no running effects', async () => {
  let stops = 0;
  let value = 0;
  await rollUpWin(250, 0, amount => { value = amount; }, new AbortController().signal, () => stops++);
  assert.equal(stops, 1);
  assert.equal(value, 250);
});

test('a counter rendering error cleans up the effects and rejects instead of hanging', async context => {
  const clock = frames(context);
  let stops = 0;
  const counting = rollUpWin(250, 1000, () => { throw new Error('Display failed'); },
    new AbortController().signal, () => stops++);
  clock.run(performance.now() + 100);
  await assert.rejects(counting, /Display failed/);
  assert.equal(stops, 1);
});
