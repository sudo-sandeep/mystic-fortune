export interface Point { x: number; y: number; }
export interface Viewport { width: number; height: number; }
export interface FlyingCoin extends Point {
  origin: Point;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  angle: number;
  spin: number;
  age: number;
  life: number;
}

export const MAX_SHOWER_COINS = 220;
export const SHOWER_EXIT_MS = 750;

export function launchCoin(origin: Point, viewport: Viewport, random: () => number = Math.random): FlyingCoin {
  const gravity = Math.max(600, viewport.height * 1.8);
  const rise = Math.max(viewport.height * .75, origin.y + viewport.height * .12) * (1 + random() * .35);
  const vy = -Math.sqrt(2 * gravity * rise);
  const apexTime = -vy / gravity;
  const destination = (-.12 + random() * 1.24) * viewport.width;
  return {
    ...origin, origin: { ...origin },
    vx: (destination - origin.x) / apexTime, vy, gravity,
    size: Math.max(20, Math.min(38, viewport.width * .035)) * (.75 + random() * .6),
    angle: random() * Math.PI * 2,
    spin: (random() < .5 ? -1 : 1) * (3 + random() * 7),
    age: 0, life: apexTime * 2 + .75,
  };
}

/** Bound both particle count and allocation rate during long Big Win rollups. */
export class CoinFountain {
  readonly coins: FlyingCoin[] = [];
  private carry = 0;
  private emitting = true;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) { this.random = random; }

  emit(count: number, origin: Point, viewport: Viewport): void {
    if (!this.emitting) return;
    const available = Math.min(count, MAX_SHOWER_COINS - this.coins.length);
    for (let index = 0; index < available; index++) this.coins.push(launchCoin(origin, viewport, this.random));
  }

  stopEmitting(): void { this.emitting = false; }

  step(seconds: number, origin: Point, viewport: Viewport): void {
    let retained = 0;
    for (const coin of this.coins) {
      coin.age += seconds;
      coin.x = coin.origin.x + coin.vx * coin.age;
      coin.y = coin.origin.y + coin.vy * coin.age + .5 * coin.gravity * coin.age ** 2;
      if (coin.age >= coin.life || coin.x < -coin.size || coin.x > viewport.width + coin.size
        || (coin.y > viewport.height + coin.size && coin.vy + coin.gravity * coin.age > 0)) continue;
      this.coins[retained++] = coin;
    }
    this.coins.length = retained;
    if (!this.emitting) return;
    this.carry += seconds * 64;
    const count = Math.floor(this.carry);
    this.carry -= count;
    this.emit(count, origin, viewport);
  }
}

function makeCoinSprite(): HTMLCanvasElement | null {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 112;
  const context = sprite.getContext('2d');
  if (!context) return null;
  context.shadowColor = '#f6b93380';
  context.shadowBlur = 7;
  context.shadowOffsetY = 2;
  const edge = context.createLinearGradient(20, 10, 90, 100);
  edge.addColorStop(0, '#fff6c6');
  edge.addColorStop(.28, '#ffd859');
  edge.addColorStop(.52, '#9c4a0d');
  edge.addColorStop(.76, '#ffdb69');
  edge.addColorStop(1, '#b46c13');
  context.fillStyle = edge;
  context.beginPath(); context.arc(56, 56, 44, 0, Math.PI * 2); context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  const face = context.createRadialGradient(39, 31, 2, 56, 56, 43);
  face.addColorStop(0, '#fff4ad');
  face.addColorStop(.45, '#f6c94d');
  face.addColorStop(1, '#d28c1b');
  context.fillStyle = face;
  context.beginPath(); context.arc(56, 56, 37, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#fff1a3'; context.lineWidth = 2;
  context.beginPath(); context.arc(56, 56, 40, 0, Math.PI * 2); context.stroke();
  context.strokeStyle = '#aa6416'; context.lineWidth = 1.5;
  context.beginPath(); context.arc(56, 56, 32, 0, Math.PI * 2); context.stroke();
  for (let index = 0; index < 28; index++) {
    const angle = index / 28 * Math.PI * 2;
    context.beginPath();
    context.moveTo(56 + Math.cos(angle) * 40, 56 + Math.sin(angle) * 40);
    context.lineTo(56 + Math.cos(angle) * 43, 56 + Math.sin(angle) * 43);
    context.stroke();
  }
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = point * Math.PI / 5 - Math.PI / 2;
    const radius = point % 2 === 0 ? 23 : 11;
    const x = 56 + Math.cos(angle) * radius;
    const y = 56 + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
  context.fillStyle = '#b87517'; context.fill();
  context.strokeStyle = '#fff0a0'; context.lineWidth = 2; context.stroke();
  return sprite;
}

/** Full-screen canvas stays outside the reel's clipping and stacking contexts. */
export function startCoinShower(reels: HTMLElement, signal?: AbortSignal): () => Promise<void> {
  if (signal?.aborted) return () => Promise.resolve();
  const canvas = document.createElement('canvas');
  canvas.className = 'coin-shower-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  const sprite = makeCoinSprite();
  if (!context || !sprite) return () => Promise.resolve();
  canvas.style.setProperty('--shower-exit-duration', `${SHOWER_EXIT_MS}ms`);
  const fountain = new CoinFountain();
  let viewport: Viewport;
  let origin: Point;
  let frame = 0;
  let stopped = false;
  let disposed = false;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let finishExit!: () => void;
  const finished = new Promise<void>(resolve => { finishExit = resolve; });
  let previous = performance.now();
  const updateOrigin = () => {
    const rect = reels.getBoundingClientRect();
    origin = { x: rect.left + rect.width / 2, y: rect.bottom };
  };
  const resize = () => {
    viewport = { width: window.innerWidth, height: window.innerHeight };
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    updateOrigin();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(exitTimer);
    cancelAnimationFrame(frame);
    signal?.removeEventListener('abort', stop);
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', updateOrigin, true);
    window.removeEventListener('pagehide', dispose);
    canvas.remove();
    finishExit();
  };
  const stop = () => {
    if (stopped || disposed) return finished;
    stopped = true;
    fountain.stopEmitting();
    signal?.removeEventListener('abort', stop);
    canvas.classList.add('is-exiting');
    // Keep physics running through the fade; the timer also cleans up paused tabs.
    exitTimer = setTimeout(dispose, SHOWER_EXIT_MS);
    return finished;
  };
  const draw = (now: number) => {
    if (disposed) return;
    const elapsed = Math.min(.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    fountain.step(elapsed, origin, viewport);
    context.clearRect(0, 0, viewport.width, viewport.height);
    for (const coin of fountain.coins) {
      context.save();
      context.globalAlpha = Math.min(1, coin.age / .05, (coin.life - coin.age) / .25);
      context.translate(coin.x, coin.y);
      context.rotate(coin.angle + coin.age * coin.spin * .35);
      context.scale(.25 + .75 * Math.abs(Math.cos(coin.angle + coin.age * coin.spin)), 1);
      context.drawImage(sprite, -coin.size / 2, -coin.size / 2, coin.size, coin.size);
      context.restore();
    }
    frame = requestAnimationFrame(draw);
  };
  resize();
  document.body.append(canvas);
  fountain.emit(24, origin!, viewport!);
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', updateOrigin, { passive: true, capture: true });
  window.addEventListener('pagehide', dispose, { once: true });
  signal?.addEventListener('abort', stop, { once: true });
  frame = requestAnimationFrame(draw);
  return stop;
}
