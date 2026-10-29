export const LANDING_SOUND_SECONDS = .52;
export const LANDING_SOUND_GAIN = .9;
export const ROLLUP_SOUND_SECONDS = 1.28;
export const ROLLUP_SOUND_GAIN = .65;
export const REEL_LANDING_PROFILES = [
  { peak: .38, pitch: .88, weight: .45, decay: .78 },
  { peak: .50, pitch: .94, weight: .56, decay: .86 },
  { peak: .63, pitch: 1, weight: .67, decay: .94 },
  { peak: .76, pitch: 1.06, weight: .80, decay: 1.02 },
  { peak: .90, pitch: 1.12, weight: .95, decay: 1.10 },
] as const;

/** Keep overlapping strikes below full scale without turning down ordinary hits. */
export function limitLandingMix(value: number): number {
  const level = Math.abs(value);
  if (level <= .8) return value;
  return Math.sign(value) * (.8 + .16 * (1 - Math.exp(-(level - .8) / .16)));
}

function landingLimiterCurve() {
  const curve = new Float32Array(4097);
  for (let index = 0; index < curve.length; index++) {
    curve[index] = limitLandingMix((index / (curve.length - 1) * 2 - 1) * 4);
  }
  return curve;
}

/** An empty steel container hitting a hard floor: hollow body, sharp contact, short rattle. */
export function createLandingSamples(sampleRate: number, reelIndex = 4): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 16_000) {
    throw new RangeError('Audio sample rate must be at least 16000 Hz.');
  }
  if (!Number.isInteger(reelIndex) || reelIndex < 0 || reelIndex >= REEL_LANDING_PROFILES.length) {
    throw new RangeError('Landing sound requires a reel index from 0 to 4.');
  }
  const profile = REEL_LANDING_PROFILES[reelIndex];
  const samples = new Float32Array(Math.ceil(sampleRate * LANDING_SOUND_SECONDS));
  const partials = [
    { frequency: 142, level: .55, decay: .115 },
    { frequency: 237, level: .36, decay: .100 },
    { frequency: 347, level: .29, decay: .085 },
    { frequency: 483, level: .22, decay: .075 },
    { frequency: 691, level: .17, decay: .065 },
    { frequency: 1163, level: .12, decay: .048 },
    { frequency: 2279, level: .07, decay: .028 },
  ];
  let noiseState = 0x5eeda11;
  let lowNoise = 0;
  let peak = 0;
  const noiseFilter = 1 - Math.exp(-2 * Math.PI * 1400 / sampleRate);
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / .0007);
    const release = Math.min(1, (samples.length - 1 - index) / (sampleRate * .025));
    // Seeded noise gives every landing the same crisp transient without touching game RNG.
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    const noise = (noiseState >>> 0) / 0x80000000 - 1;
    lowNoise += noiseFilter * (noise - lowNoise);
    const contact = (.6 * (noise - lowNoise) + .4 * lowNoise) * .65 * Math.exp(-time / .010);
    const thumpPhase = 2 * Math.PI * (58 * time + 1.22 * (1 - Math.exp(-time / .012)));
    // Small contacts and shell flutter make the decay sound like settling sheet metal.
    const rattleEnvelope = .20 * Math.exp(-(((time - .027) / .004) ** 2))
      + .13 * Math.exp(-(((time - .057) / .005) ** 2))
      + .08 * Math.exp(-(((time - .094) / .006) ** 2))
      + .04 * Math.exp(-(((time - .143) / .008) ** 2));
    const rattle = (noise * .35 + lowNoise * .65) * rattleEnvelope * (.6 + profile.weight);
    let value = profile.weight * Math.sin(thumpPhase) * Math.exp(-time / (.040 * profile.decay))
      + contact + rattle;
    const vibration = .05 * Math.sin(2 * Math.PI * 48 * time) + .05 * lowNoise;
    const shellTime = time + .0006 * (1 - Math.exp(-time / .008));
    for (const partial of partials) {
      value += partial.level * Math.sin(2 * Math.PI * partial.frequency * profile.pitch * shellTime + vibration)
        * Math.exp(-time / (partial.decay * profile.decay));
    }
    samples[index] = Math.tanh(value * 1.8) * attack * release;
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  // Preserve a strong attack while leaving headroom for the previous reel's fading tail.
  if (peak > 0) {
    for (let index = 0; index < samples.length; index++) samples[index] *= profile.peak / peak;
  }
  samples[0] = 0;
  samples[samples.length - 1] = 0;
  return samples;
}

/** Smooth rising arcade chimes, with soft attacks and a shimmering harmonic tail. */
export function createWinRollupSamples(sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 16_000) {
    throw new RangeError('Audio sample rate must be at least 16000 Hz.');
  }
  const samples = new Float32Array(Math.round(sampleRate * ROLLUP_SOUND_SECONDS));
  const pitches = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 1318.51, 1046.50,
    587.33, 739.99, 880, 1174.66, 1479.98, 1760, 1479.98, 1174.66];
  for (let note = 0; note < pitches.length; note++) {
    const start = Math.round(note * .08 * sampleRate);
    const pitch = pitches[note];
    const strength = note % 4 === 0 ? 1 : .85;
    for (let offset = 0; offset < Math.ceil(sampleRate * .24); offset++) {
      const time = offset / sampleRate;
      const attack = Math.min(1, time / .0035);
      const release = Math.min(1, (.24 - time) / .025);
      const value = .20 * Math.sin(2 * Math.PI * pitch * time) * Math.exp(-time / .052)
        + .045 * Math.sin(2 * Math.PI * pitch * 2 * time) * Math.exp(-time / .034)
        + .025 * Math.sin(2 * Math.PI * (pitch * 2 + 2.5) * time) * Math.exp(-time / .045)
        + .012 * Math.sin(2 * Math.PI * pitch * 3 * time) * Math.exp(-time / .023);
      const sound = value * attack * release * strength;
      samples[(start + offset) % samples.length] += sound;
      samples[(start + offset + Math.round(sampleRate * .105)) % samples.length] += sound * .16;
    }
  }
  const peak = samples.reduce((highest, sample) => Math.max(highest, Math.abs(sample)), 0);
  if (peak > 0) for (let index = 0; index < samples.length; index++) samples[index] *= .58 / peak;
  return samples;
}

function createBrowserContext(): AudioContext | null {
  const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = browser.AudioContext ?? browser.webkitAudioContext;
  return Context ? new Context({ latencyHint: 'interactive' }) : null;
}

/** One lazily activated context and five cached sounds, increasing in intensity by reel. */
export class ReelAudio {
  private readonly createContext: () => AudioContext | null;
  private context: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private rollupBuffer: AudioBuffer | null = null;
  private stopRollupLoop: ((immediate?: boolean) => void) | null = null;
  private output: GainNode | null = null;
  private voices = new Set<AudioBufferSourceNode>();
  private soundEnabled = true;

  constructor(createContext: () => AudioContext | null = createBrowserContext) {
    this.createContext = createContext;
  }

  get enabled(): boolean { return this.soundEnabled; }

  /** Enabling must happen directly inside a user click to activate browser audio. */
  setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    if (enabled) this.unlock();
    else this.suspend();
  }

  /** Call synchronously from Spin / Stop clicks to satisfy browser audio policies. */
  unlock(): void {
    if (!this.soundEnabled) return;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.stopRollupLoop?.(true);
        this.context = this.createContext();
        this.buffers = [];
        this.rollupBuffer = null;
        this.output = null;
      }
      const context = this.context;
      if (!context) return;
      if (this.buffers.length !== REEL_LANDING_PROFILES.length) {
        this.buffers = REEL_LANDING_PROFILES.map((_, reelIndex) => {
          const samples = createLandingSamples(context.sampleRate, reelIndex);
          const buffer = context.createBuffer(1, samples.length, context.sampleRate);
          buffer.getChannelData(0).set(samples);
          return buffer;
        });
      }
      if (!this.output) {
        const output = context.createGain();
        // Reserve four-times headroom inside the shaper, then restore the level in its curve.
        output.gain.value = LANDING_SOUND_GAIN / 4;
        const limiter = context.createWaveShaper();
        limiter.curve = landingLimiterCurve();
        output.connect(limiter);
        limiter.connect(context.destination);
        this.output = output;
      }
      if (context.state !== 'running') void context.resume().catch(() => {});
    } catch {
      // A missing or blocked audio device must never prevent a spin.
    }
  }

  playLanding(reelIndex = 4): void {
    const context = this.context;
    const buffer = this.buffers[reelIndex];
    if (!this.soundEnabled || !context || context.state !== 'running' || !buffer || !this.output) return;
    let voice: AudioBufferSourceNode | null = null;
    try {
      voice = context.createBufferSource();
      voice.buffer = buffer;
      voice.connect(this.output);
      const source = voice;
      source.onended = () => {
        source.disconnect();
        this.voices.delete(source);
      };
      this.voices.add(source);
      source.start();
    } catch {
      if (voice) {
        voice.disconnect();
        this.voices.delete(voice);
      }
    }
  }

  /** The returned stop function owns only this rollup, never a later one. */
  startWinRollup(signal?: AbortSignal): () => void {
    this.stopRollupLoop?.(true);
    const context = this.context;
    if (!this.soundEnabled || signal?.aborted || !context || context.state !== 'running' || !this.output) return () => {};
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    let cleanup: (() => void) | null = null;
    try {
      if (!this.rollupBuffer) {
        const samples = createWinRollupSamples(context.sampleRate);
        this.rollupBuffer = context.createBuffer(1, samples.length, context.sampleRate);
        this.rollupBuffer.getChannelData(0).set(samples);
      }
      const voice = context.createBufferSource();
      source = voice;
      const volume = context.createGain();
      gain = volume;
      voice.buffer = this.rollupBuffer;
      voice.loop = true;
      volume.gain.setValueAtTime(0, context.currentTime);
      volume.gain.linearRampToValueAtTime(ROLLUP_SOUND_GAIN, context.currentTime + .008);
      voice.connect(volume);
      volume.connect(this.output);
      let stopping = false;
      let cleaned = false;
      const onAbort = () => stop();
      const release = () => {
        if (cleaned) return;
        cleaned = true;
        signal?.removeEventListener('abort', onAbort);
        voice.onended = null;
        voice.disconnect();
        volume.disconnect();
        if (this.stopRollupLoop === stop) this.stopRollupLoop = null;
      };
      cleanup = release;
      const stop = (immediate = false) => {
        if (cleaned || (stopping && !immediate)) return;
        stopping = true;
        signal?.removeEventListener('abort', onAbort);
        try {
          if (immediate) {
            voice.stop();
            release();
          } else {
            const now = context.currentTime;
            volume.gain.cancelScheduledValues(now);
            volume.gain.setValueAtTime(volume.gain.value, now);
            volume.gain.linearRampToValueAtTime(0, now + .012);
            voice.stop(now + .015);
          }
        } catch { release(); }
      };
      this.stopRollupLoop = stop;
      voice.onended = release;
      signal?.addEventListener('abort', onAbort, { once: true });
      voice.start();
      return () => stop();
    } catch {
      if (cleanup) cleanup();
      else {
        source?.disconnect();
        gain?.disconnect();
      }
      return () => {};
    }
  }

  suspend(): void {
    this.stopRollupLoop?.(true);
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* It may already have ended. */ }
      voice.disconnect();
    }
    this.voices.clear();
    try {
      if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
    } catch { /* Audio lifecycle failures do not affect the game. */ }
  }
}
