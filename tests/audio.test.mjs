import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandingSamples, createWinRollupSamples, limitLandingMix, ROLLUP_SOUND_SECONDS, LANDING_SOUND_SECONDS, LANDING_SOUND_GAIN, REEL_LANDING_PROFILES, ReelAudio } from '../src/audio.ts';
import { forcedBoard } from '../src/game.ts';
import { delay, playReels } from '../src/timing.ts';

test('normal spins play one sound after each of the five landings', async () => {
  const events = [];
  await playReels(forcedBoard('five'), async column => {
    events.push(`land ${column}`);
  }, new AbortController().signal, true, (column, slammed) => {
    assert.equal(slammed, false);
    events.push(`sound ${column}`);
  });
  assert.deepEqual(events, [
    'land 0', 'sound 0', 'land 1', 'sound 1', 'land 2', 'sound 2',
    'land 3', 'sound 3', 'land 4', 'sound 4',
  ]);
});

for (const alreadyLanded of [0, 1, 2, 3, 4]) {
  test(`slam with ${5 - alreadyLanded} reels left plays exactly one remaining sound`, async () => {
    const controller = new AbortController();
    let landed = 0;
    const heardAt = [];
    const selectedSounds = [];
    if (alreadyLanded === 0) controller.abort();
    await playReels(forcedBoard('five'), async () => {
      landed++;
    }, controller.signal, true, (column, slammed) => {
      heardAt.push(landed);
      selectedSounds.push({ column, slammed });
      if (!slammed && heardAt.length === alreadyLanded) controller.abort();
    });
    assert.equal(landed, 5);
    assert.deepEqual(heardAt, [...Array.from({ length: alreadyLanded }, (_, index) => index + 1), 5]);
    assert.deepEqual(selectedSounds, [
      ...Array.from({ length: alreadyLanded }, (_, column) => ({ column, slammed: false })),
      { column: 4, slammed: true },
    ]);
  });
}

test('the combined slam sound waits for the last braking animation', async () => {
  const controller = new AbortController();
  controller.abort();
  let finishLast;
  const lastLanding = new Promise(resolve => { finishLast = resolve; });
  let sounds = 0;
  const playing = playReels(forcedBoard('five'), async column => {
    if (column === 4) await lastLanding;
  }, controller.signal, false, () => sounds++);
  await delay(5);
  assert.equal(sounds, 0);
  finishLast();
  await playing;
  assert.equal(sounds, 1);
});

test('failed landings do not play a success sound', async () => {
  let sounds = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(playReels(forcedBoard('five'), async column => {
    if (column === 2) throw new Error('Landing failed');
  }, controller.signal, true, () => sounds++), /Landing failed/);
  assert.equal(sounds, 0);
});

test('an unavailable sound effect cannot interrupt a valid spin', async () => {
  let landed = 0;
  await playReels(forcedBoard('five'), async () => { landed++; },
    new AbortController().signal, true, () => { throw new Error('Audio device unavailable'); });
  assert.equal(landed, 5);
});

test('the reel impact is strong, finite, unclipped, and fades to silence', () => {
  for (const sampleRate of [44_100, 48_000]) {
    const samples = createLandingSamples(sampleRate);
    assert.equal(samples.length, Math.ceil(sampleRate * LANDING_SOUND_SECONDS));
    assert.ok(samples.every(Number.isFinite));
    const peak = samples.reduce((highest, value) => Math.max(highest, Math.abs(value)), 0);
    assert.ok(peak * LANDING_SOUND_GAIN > .8 && peak * LANDING_SOUND_GAIN < 1);
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    const energy = values => values.reduce((sum, value) => sum + value * value, 0) / values.length;
    assert.ok(energy(samples.slice(0, Math.floor(sampleRate * .05))) > .04);
    assert.ok(energy(samples.slice(-2000)) < energy(samples.slice(0, 2000)) * .01);
  }
});

function fakeAudioContext() {
  const sources = [];
  let buffers = 0;
  let resumes = 0;
  const context = {
    sampleRate: 48_000,
    currentTime: 0,
    state: 'suspended',
    destination: {},
    createBuffer(_channels, length) {
      buffers++;
      const samples = new Float32Array(length);
      return { getChannelData: () => samples };
    },
    createGain() {
      const gain = {
        value: 1,
        setValueAtTime(value) { this.value = value; },
        linearRampToValueAtTime(value) { this.value = value; },
        cancelScheduledValues() {},
      };
      return { gain, connect() {}, disconnect() {} };
    },
    createWaveShaper: () => ({ curve: null, connect() {} }),
    createBufferSource() {
      const source = {
        buffer: null, onended: null, started: false, disconnected: false, stopped: false, stops: 0,
        connect() {},
        start() { this.started = true; },
        disconnect() { this.disconnected = true; },
        stop() { this.stopped = true; this.stops++; },
      };
      sources.push(source);
      return source;
    },
    resume() { resumes++; context.state = 'running'; return Promise.resolve(); },
    suspend() { context.state = 'suspended'; return Promise.resolve(); },
  };
  return { context, sources, buffers: () => buffers, resumes: () => resumes };
}

test('audio reuses its context and selects the correct cached buffer for each reel', () => {
  const fake = fakeAudioContext();
  let contexts = 0;
  const audio = new ReelAudio(() => { contexts++; return fake.context; });
  audio.playLanding();
  assert.equal(contexts, 0);
  audio.unlock();
  audio.unlock();
  for (let index = 0; index < 5; index++) audio.playLanding(index);
  assert.equal(contexts, 1);
  assert.equal(fake.buffers(), 5);
  assert.equal(fake.resumes(), 1);
  assert.equal(fake.sources.length, 5);
  assert.ok(fake.sources.every(source => source.started));
  assert.equal(new Set(fake.sources.map(source => source.buffer)).size, 5);
  audio.playLanding(2);
  assert.equal(fake.sources[5].buffer, fake.sources[2].buffer);
  fake.sources[0].onended();
  assert.equal(fake.sources[0].disconnected, true);
  audio.suspend();
  assert.equal(fake.sources[0].stopped, false);
  assert.ok(fake.sources.slice(1).every(source => source.stopped && source.disconnected));
  assert.equal(fake.context.state, 'suspended');
  audio.unlock();
  assert.equal(fake.context.state, 'running');
  assert.equal(fake.resumes(), 2);
  assert.equal(fake.buffers(), 5);
});

test('all five reel sounds increase in both peak level and perceived intensity', () => {
  assert.equal(REEL_LANDING_PROFILES.length, 5);
  for (const sampleRate of [44_100, 48_000]) {
    let previousPeak = 0;
    let previousEnergy = 0;
    for (let reel = 0; reel < 5; reel++) {
      const samples = createLandingSamples(sampleRate, reel);
      let peak = 0;
      let energy = 0;
      for (const sample of samples) {
        const value = limitLandingMix(sample * LANDING_SOUND_GAIN);
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
      assert.ok(peak > previousPeak, `Reel ${reel + 1} must have a stronger peak`);
      assert.ok(energy > previousEnergy, `Reel ${reel + 1} must have greater sound energy`);
      previousPeak = peak;
      previousEnergy = energy;
    }
  }
});

test('invalid reel sound indices are rejected', () => {
  for (const reel of [-1, 5, 1.5, Number.NaN]) {
    assert.throws(() => createLandingSamples(48_000, reel), RangeError);
  }
});

test('rapid overlapping reel impacts keep their attack without clipping the output', () => {
  const sampleRate = 48_000;
  const samples = createLandingSamples(sampleRate);
  const interval = Math.round(sampleRate * .08);
  const mix = new Float32Array(samples.length + 4 * interval);
  for (let reel = 0; reel < 5; reel++) {
    for (let index = 0; index < samples.length; index++) {
      mix[reel * interval + index] += samples[index] * LANDING_SOUND_GAIN;
    }
  }
  assert.equal(limitLandingMix(.5), .5);
  assert.equal(limitLandingMix(-.5), -.5);
  const peak = mix.reduce((highest, value) => Math.max(highest, Math.abs(limitLandingMix(value))), 0);
  assert.ok(peak > .8 && peak < .96);
});

test('unsupported or blocked audio degrades safely', () => {
  for (const create of [() => null, () => { throw new Error('Audio blocked'); }]) {
    const audio = new ReelAudio(create);
    assert.doesNotThrow(() => {
      audio.unlock(); audio.playLanding(); audio.startWinRollup()(); audio.suspend();
    });
  }
});

test('rollup chimes produce an audible, finite, bounded loop at common sample rates', () => {
  for (const sampleRate of [44_100, 48_000]) {
    const samples = createWinRollupSamples(sampleRate);
    assert.equal(samples.length, Math.round(sampleRate * ROLLUP_SOUND_SECONDS));
    assert.ok(samples.every(Number.isFinite));
    const peak = samples.reduce((highest, sample) => Math.max(highest, Math.abs(sample)), 0);
    assert.ok(peak > .3 && peak < 1);
    for (let part = 0; part < 16; part++) {
      const chunk = samples.slice(Math.floor(part * samples.length / 16), Math.floor((part + 1) * samples.length / 16));
      assert.ok(chunk.some(sample => Math.abs(sample) > .05));
    }
  }
});

test('rollup audio loops continuously with one source and stops once on Skip', () => {
  const fake = fakeAudioContext();
  const audio = new ReelAudio(() => fake.context);
  audio.unlock();
  const controller = new AbortController();
  const stop = audio.startWinRollup(controller.signal);
  const source = fake.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.started, true);
  assert.equal(source.stopped, false);
  assert.equal(fake.buffers(), 6);
  controller.abort();
  assert.equal(source.stops, 1);
  stop();
  assert.equal(source.stops, 1);
  source.onended();
  assert.equal(source.disconnected, true);
});

test('normal rollup completion stops rollup audio and reuses its buffer next time', () => {
  const fake = fakeAudioContext();
  const audio = new ReelAudio(() => fake.context);
  audio.unlock();
  const stop = audio.startWinRollup();
  const first = fake.sources[0];
  stop();
  assert.equal(first.stopped, true);
  first.onended();
  const stopNext = audio.startWinRollup();
  assert.equal(fake.buffers(), 6);
  assert.equal(fake.sources[1].buffer, first.buffer);
  assert.equal(fake.sources[1].stopped, false);
  stop();
  assert.equal(fake.sources[1].stopped, false);
  stopNext();
});

test('already skipped rollups never start a rollup sound', () => {
  const fake = fakeAudioContext();
  const audio = new ReelAudio(() => fake.context);
  audio.unlock();
  const controller = new AbortController();
  controller.abort();
  audio.startWinRollup(controller.signal)();
  assert.equal(fake.sources.length, 0);
  assert.equal(fake.buffers(), 5);
});

test('a new rollup replaces the previous loop without leaving duplicate rollup sources', () => {
  const fake = fakeAudioContext();
  const audio = new ReelAudio(() => fake.context);
  audio.unlock();
  const oldStop = audio.startWinRollup();
  audio.startWinRollup();
  assert.equal(fake.sources[0].disconnected, true);
  assert.equal(fake.sources[1].stopped, false);
  oldStop();
  assert.equal(fake.sources[1].stopped, false);
  audio.suspend();
  assert.equal(fake.sources[1].stopped, true);
  assert.equal(fake.sources[1].disconnected, true);
  assert.equal(fake.context.state, 'suspended');
});

test('choosing No keeps Spin, Stop and all win sounds silent without creating audio resources', () => {
  const fake = fakeAudioContext();
  let contexts = 0;
  const audio = new ReelAudio(() => { contexts++; return fake.context; });
  audio.setEnabled(false);
  assert.equal(audio.enabled, false);
  for (let round = 0; round < 3; round++) {
    audio.unlock();
    for (let reel = 0; reel < 5; reel++) audio.playLanding(reel);
    audio.startWinRollup()();
    audio.suspend();
  }
  assert.equal(contexts, 0);
  assert.equal(fake.buffers(), 0);
  assert.equal(fake.sources.length, 0);
});

test('sound can be enabled, muted and enabled again with cached buffers and no stale voices', () => {
  const fake = fakeAudioContext();
  let contexts = 0;
  const audio = new ReelAudio(() => { contexts++; return fake.context; });
  audio.setEnabled(false);
  audio.setEnabled(true);
  assert.equal(audio.enabled, true);
  assert.equal(fake.context.state, 'running');
  audio.playLanding(0);
  const oldRollupStop = audio.startWinRollup();
  assert.equal(fake.sources.length, 2);
  audio.setEnabled(false);
  assert.equal(fake.context.state, 'suspended');
  assert.ok(fake.sources.every(source => source.stopped && source.disconnected));
  // Even an unexpectedly resumed context must remain silent while the preference is off.
  fake.context.state = 'running';
  audio.unlock();
  audio.playLanding(4);
  audio.startWinRollup()();
  assert.equal(fake.sources.length, 2);
  audio.setEnabled(true);
  audio.playLanding(4);
  const stop = audio.startWinRollup();
  oldRollupStop();
  assert.equal(fake.sources.length, 4);
  assert.equal(fake.sources[3].stopped, false);
  assert.equal(contexts, 1);
  assert.equal(fake.buffers(), 6);
  stop();
});

test('unavailable audio cannot break the sound choice or later toggles', () => {
  const audio = new ReelAudio(() => { throw new Error('Device unavailable'); });
  assert.doesNotThrow(() => {
    audio.setEnabled(false);
    audio.setEnabled(true);
    assert.equal(audio.enabled, true);
    audio.playLanding();
    audio.startWinRollup()();
    audio.setEnabled(false);
    assert.equal(audio.enabled, false);
  });
});
