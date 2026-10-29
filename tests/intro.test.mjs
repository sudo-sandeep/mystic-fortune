import assert from 'node:assert/strict';
import test from 'node:test';
import { IntroScreen, loadingProgress, waitForGameLoad } from '../src/intro.ts';

test('cached assets still keep the intro up for the full five seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let ready = false;
  const loading = waitForGameLoad(Promise.resolve()).then(() => { ready = true; });
  context.mock.timers.tick(4999);
  await Promise.resolve();
  assert.equal(ready, false);
  context.mock.timers.tick(1);
  await loading;
  assert.equal(ready, true);
});

test('a slow asset prevents entry even after the five-second minimum', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveAssets;
  const assets = new Promise(resolve => { resolveAssets = resolve; });
  let ready = false;
  const loading = waitForGameLoad(assets).then(() => { ready = true; });
  context.mock.timers.tick(8000);
  await Promise.resolve();
  assert.equal(ready, false);
  resolveAssets();
  await loading;
  assert.equal(ready, true);
});

test('a loading failure is reported rather than opening an incomplete game', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const loading = waitForGameLoad(Promise.reject(new Error('Image unavailable')));
  await assert.rejects(loading, /Image unavailable/);
});

test('displayed progress is limited by both real loading and elapsed time', () => {
  assert.equal(loadingProgress(0, 13, 13), 0);
  assert.equal(loadingProgress(2500, 13, 13), 50);
  assert.equal(loadingProgress(4999, 13, 13) < 100, true);
  assert.equal(loadingProgress(8000, 6, 12), 50);
  assert.equal(loadingProgress(5000, 13, 13), 100);
  assert.equal(loadingProgress(-10, 0, 13), 0);
  assert.equal(loadingProgress(5000, 0, 0), 0);
});

function introEnvironment(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  context.after(() => {
    if (request) globalThis.requestAnimationFrame = request;
    else delete globalThis.requestAnimationFrame;
    if (cancel) globalThis.cancelAnimationFrame = cancel;
    else delete globalThis.cancelAnimationFrame;
  });
  const node = () => Object.assign(new EventTarget(), {
    hidden: false, disabled: false, textContent: '', style: {}, attributes: new Map(),
    classList: { add() {}, remove() {} },
    setAttribute(key, value) { this.attributes.set(key, value); },
    focus() { this.focused = true; },
  });
  const elements = Object.fromEntries(['root', 'progress', 'fill', 'percent', 'status', 'retry',
    'loading', 'soundPrompt', 'soundYes', 'soundNo'].map(key => [key, node()]));
  return { elements, intro: new IntroScreen(elements) };
}

for (const enabled of [true, false]) {
  test(`${enabled ? 'Yes enables' : 'No disables'} sound only after loading and an explicit choice`, async context => {
    const { intro, elements } = introEnvironment(context);
    const loading = intro.load(async progress => { progress(1, 1); });
    assert.equal(elements.soundPrompt.hidden, true);
    assert.equal(elements.soundYes.disabled, true);
    await assert.rejects(intro.askForSound(() => assert.fail('Too early')), /finish loading/);
    context.mock.timers.tick(4999);
    await Promise.resolve();
    assert.equal(elements.soundPrompt.hidden, true);
    context.mock.timers.tick(1);
    await loading;
    assert.equal(elements.progress.attributes.get('aria-valuenow'), '100');
    const choices = [];
    let entered = false;
    let insideClick = false;
    const choosing = intro.askForSound(value => {
      assert.equal(insideClick, true, 'audio unlock must happen within the click');
      choices.push(value);
    });
    const entry = choosing.then(() => { entered = true; });
    assert.equal(intro.askForSound(() => assert.fail('Duplicate handler')), choosing);
    assert.equal(elements.loading.hidden, true);
    assert.equal(elements.soundPrompt.hidden, false);
    assert.equal(elements.soundYes.disabled, false);
    assert.equal(elements.soundNo.disabled, false);
    assert.equal(elements.soundYes.focused, true);
    context.mock.timers.tick(60_000);
    await Promise.resolve();
    assert.equal(entered, false);
    insideClick = true;
    (enabled ? elements.soundYes : elements.soundNo).dispatchEvent(new Event('click'));
    insideClick = false;
    assert.deepEqual(choices, [enabled]);
    await entry;
    assert.equal(entered, true);
    assert.equal(elements.soundYes.disabled, true);
    assert.equal(elements.soundNo.disabled, true);
    elements.soundYes.dispatchEvent(new Event('click'));
    elements.soundNo.dispatchEvent(new Event('click'));
    assert.deepEqual(choices, [enabled]);
  });
}

test('failed loading keeps sound unavailable, and retry reaches the sound question', async context => {
  const { intro, elements } = introEnvironment(context);
  await assert.rejects(intro.load(() => Promise.reject(new Error('Missing image'))), /Missing image/);
  intro.fail();
  assert.equal(elements.loading.hidden, false);
  assert.equal(elements.retry.hidden, false);
  assert.equal(elements.soundPrompt.hidden, true);
  await assert.rejects(intro.askForSound(() => {}), /finish loading/);
  const loading = intro.load(async progress => { progress(1, 1); });
  context.mock.timers.tick(5000);
  await loading;
  const choosing = intro.askForSound(() => {});
  assert.equal(elements.retry.hidden, true);
  assert.equal(elements.soundPrompt.hidden, false);
  elements.soundNo.dispatchEvent(new Event('click'));
  await choosing;
});
