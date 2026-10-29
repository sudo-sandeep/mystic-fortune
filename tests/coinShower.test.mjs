import assert from 'node:assert/strict';
import test from 'node:test';
import { CoinFountain, MAX_SHOWER_COINS, SHOWER_EXIT_MS, launchCoin, startCoinShower } from '../src/coinShower.ts';

test('coins launch upward from the exact bottom-center emitter and span the screen', () => {
  const origin = { x: 640, y: 620 };
  const viewport = { width: 1280, height: 720 };
  const left = launchCoin(origin, viewport, () => .05);
  const right = launchCoin(origin, viewport, () => .95);
  for (const coin of [left, right]) {
    assert.deepEqual({ x: coin.x, y: coin.y }, origin);
    assert.ok(coin.vy < 0);
    const apex = -coin.vy / coin.gravity;
    assert.ok(coin.y + coin.vy * apex + .5 * coin.gravity * apex ** 2 < 0);
  }
  assert.ok(left.x + left.vx * (-left.vy / left.gravity) < 0);
  assert.ok(right.x + right.vx * (-right.vy / right.gravity) > viewport.width);
});

test('a full-minute shower stays within the particle budget and recycles old coins', () => {
  let seed = 5;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const fountain = new CoinFountain(random);
  const origin = { x: 640, y: 620 };
  const viewport = { width: 1280, height: 720 };
  fountain.emit(MAX_SHOWER_COINS + 100, origin, viewport);
  assert.equal(fountain.coins.length, MAX_SHOWER_COINS);
  const first = fountain.coins[0];
  for (let frame = 0; frame < 3600; frame++) {
    fountain.step(1 / 60, origin, viewport);
    assert.ok(fountain.coins.length <= MAX_SHOWER_COINS);
  }
  assert.ok(fountain.coins.length > 0);
  assert.equal(fountain.coins.includes(first), false);
  assert.ok(fountain.coins.every(coin => [coin.x, coin.y, coin.age].every(Number.isFinite)));
});

test('new coins follow a changed origin after scroll or resize', () => {
  const fountain = new CoinFountain(() => .5);
  const viewport = { width: 390, height: 844 };
  fountain.emit(1, { x: 195, y: 520 }, viewport);
  fountain.step(.1, { x: 195, y: 380 }, viewport);
  assert.equal(fountain.coins[0].origin.y, 520);
  assert.ok(fountain.coins.slice(1).every(coin => coin.origin.x === 195 && coin.origin.y === 380));
});

test('stopping emission preserves moving coins until they naturally leave the screen', () => {
  const fountain = new CoinFountain(() => .5);
  const origin = { x: 640, y: 620 };
  const viewport = { width: 1280, height: 720 };
  fountain.emit(24, origin, viewport);
  const first = fountain.coins[0];
  fountain.stopEmitting();
  fountain.stopEmitting();
  fountain.emit(50, origin, viewport);
  fountain.step(.1, origin, viewport);
  assert.equal(fountain.coins.length, 24);
  assert.ok(first.y < origin.y);
  assert.equal(first.age, .1);
  for (let frame = 0; frame < 300; frame++) fountain.step(1 / 60, origin, viewport);
  assert.equal(fountain.coins.length, 0);
});

function canvasEnvironment(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const appended = [];
  const translations = [];
  const gradient = { addColorStop() {} };
  const drawing = new Proxy({
    translate: (x, y) => translations.push({ x, y }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const browser = new EventTarget();
  browser.innerWidth = 1280;
  browser.innerHeight = 720;
  browser.devicePixelRatio = 1;
  let frame;
  let cancelled = 0;
  for (const [key, value] of Object.entries({
    window: browser,
    document: {
      createElement: () => ({
        style: { setProperty() {} },
        classList: { add(name) { this[name] = true; } },
        setAttribute() {}, getContext: () => drawing,
        remove() { this.removed = true; },
      }),
      body: { append: canvas => appended.push(canvas) },
    },
    requestAnimationFrame: callback => { frame = callback; return 1; },
    cancelAnimationFrame: () => { cancelled++; },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    context.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  return {
    reels: { getBoundingClientRect: () => ({ left: 100, width: 1080, bottom: 620 }) },
    browser, appended, translations,
    draw: now => frame(now), cancellations: () => cancelled,
  };
}

test('Skip fades the canvas while coins keep moving, then cleans up exactly once', async context => {
  const environment = canvasEnvironment(context);
  const controller = new AbortController();
  const stop = startCoinShower(environment.reels, controller.signal);
  const canvas = environment.appended[0];
  const now = performance.now();
  environment.draw(now + 50);
  const previousY = environment.translations[0].y;
  controller.abort();
  const finished = stop();
  assert.equal(stop(), finished);
  assert.equal(canvas.classList['is-exiting'], true);
  assert.equal(canvas.removed, undefined);
  environment.translations.length = 0;
  environment.draw(now + 100);
  assert.ok(environment.translations[0].y < previousY);
  context.mock.timers.tick(SHOWER_EXIT_MS - 1);
  assert.equal(canvas.removed, undefined);
  context.mock.timers.tick(1);
  await finished;
  assert.equal(canvas.removed, true);
  assert.equal(environment.cancellations(), 1);
  environment.draw(now + 200);
  context.mock.timers.tick(60_000);
  assert.equal(environment.cancellations(), 1);
});

test('exit cleanup still completes with paused animation frames and on page exit', async context => {
  const environment = canvasEnvironment(context);
  const stop = startCoinShower(environment.reels);
  const finished = stop();
  context.mock.timers.tick(SHOWER_EXIT_MS);
  await finished;
  assert.equal(environment.appended[0].removed, true);
  const stopSecond = startCoinShower(environment.reels);
  environment.browser.dispatchEvent(new Event('pagehide'));
  await stopSecond();
  context.mock.timers.tick(60_000);
  assert.equal(environment.appended[1].removed, true);
  assert.equal(environment.cancellations(), 2);
});
