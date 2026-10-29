import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSession, secureRandom } from '../src/game.ts';
import { PlayerStore, PLAYER_STORAGE_PREFIX } from '../src/players.ts';
import { RoundHistory } from '../src/roundHistory.ts';
import { withGameLock } from '../src/tabLock.ts';

function storage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); } };
}

function accept(store, session, kind) {
  const round = session.startRound(kind);
  session.settleRound(round, balance => store.commitRound({
    ...store.current, balance, lastRoundId: round.id, lastReplay: false,
  }));
  return round;
}

test('reload before the first reel lands retains a losing stake and its replay in one commit', () => {
  const disk = storage();
  const store = new PlayerStore(disk);
  const session = new GameSession(10000, 10, true);
  const round = accept(store, session, 'loss');
  assert.equal(session.busy, true); // No animation or finishRound has occurred.
  const restored = new PlayerStore(disk);
  assert.equal(restored.current.balance, 9990);
  assert.equal(restored.current.lastRoundId, round.id);
  assert.deepEqual(restored.roundIds, [round.id]);
  assert.deepEqual(new RoundHistory(disk, restored.current.id, false, restored.roundIds).rounds, [round]);
});

test('refreshing a committed winning round never credits it twice; replay remains neutral', () => {
  const disk = storage();
  const store = new PlayerStore(disk);
  const session = new GameSession(10000, 10, true);
  const round = accept(store, session, 'five');
  const expected = 10000 - round.wager + round.result.total;
  assert.equal(new PlayerStore(disk).current.balance, expected);
  assert.throws(() => session.settleRound(round), /already been credited/);
  session.finishRound(round);
  const restored = new PlayerStore(disk);
  const replaySession = new GameSession(restored.current.balance);
  const replay = replaySession.startReplay(round.id);
  replaySession.settleRound(replay);
  replaySession.finishRound(replay);
  assert.equal(replaySession.balance, expected);
  assert.equal(new PlayerStore(disk).current.balance, expected);
});

test('a quota failure rejects acceptance without changing the saved balance or archive', () => {
  const disk = storage();
  const store = new PlayerStore(disk);
  const previous = store.current;
  const key = PLAYER_STORAGE_PREFIX + previous.id;
  const raw = disk.getItem(key);
  const session = new GameSession(10000, 10, true);
  const round = session.startRound('loss');
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => session.settleRound(round, balance => store.commitRound({
    ...store.current, balance, lastRoundId: round.id,
  })), /No wager was taken/);
  assert.equal(session.roundSettled, false);
  session.finishRound(round);
  assert.equal(session.balance, 10000);
  assert.deepEqual(store.current, previous);
  assert.deepEqual(store.roundIds, []);
  assert.equal(disk.getItem(key), raw);
});

test('round archive survives a failed legacy history write and later settings saves', () => {
  const disk = storage();
  const write = disk.setItem;
  disk.setItem = (key, value) => {
    if (key.startsWith('mystic-fortune.rounds.')) throw new Error('Quota');
    write(key, value);
  };
  const store = new PlayerStore(disk);
  const session = new GameSession(10000, 10, true);
  const round = accept(store, session, 'loss');
  new RoundHistory(disk, store.current.id).remember(round);
  store.save({ ...store.current, sound: true });
  const restored = new PlayerStore(disk);
  assert.equal(restored.current.sound, true);
  assert.deepEqual(new RoundHistory(disk, restored.current.id, false, restored.roundIds).rounds, [round]);
  assert.equal(restored.current.balance, 9990);
});

test('session-only storage cannot accept a new persistent round', () => {
  const store = new PlayerStore(null);
  const session = new GameSession(10000, 10, true);
  const round = session.startRound('loss');
  assert.throws(() => session.settleRound(round, balance => store.commitRound({
    ...store.current, balance, lastRoundId: round.id,
  })), /storage is unavailable/);
  assert.equal(session.roundSettled, false);
  session.finishRound(round);
  assert.equal(session.balance, 10000);
});

test('v1 profiles migrate without losing settings and stale pre-upgrade tabs cannot overwrite v2 credits', () => {
  const disk = storage();
  const profile = { id: 'LEGACY-PLAYER', balance: 123.45, bet: 5, currency: 'INR', sound: true,
    elapsedMs: 12000, lastRoundId: null, lastReplay: false };
  disk.setItem('mystic-fortune.active-player.v1', profile.id);
  disk.setItem('mystic-fortune.player.v1.' + profile.id, JSON.stringify({ version: 1, ...profile }));
  const store = new PlayerStore(disk);
  assert.deepEqual(store.current, profile);
  const session = new GameSession(profile.balance, profile.bet, true);
  accept(store, session, 'loss');
  disk.setItem('mystic-fortune.player.v1.' + profile.id, JSON.stringify({ version: 1, ...profile, balance: 9999 }));
  disk.setItem('mystic-fortune.active-player.v1', 'OLD-TAB-PLAYER');
  const restored = new PlayerStore(disk);
  assert.equal(restored.current.id, profile.id);
  assert.equal(restored.current.balance, 118.45);
  assert.equal(restored.current.currency, 'INR');
});

function lockManager() {
  let held = false;
  return { async request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true;
    try { return await callback({ name }); }
    finally { held = false; }
  } };
}

test('a second tab cannot initialize storage or gameplay until the first tab releases its lock', async () => {
  const locks = lockManager();
  let firstLease;
  let initialized = 0;
  const first = withGameLock(locks, lease => { firstLease = lease; initialized++; }, assert.fail);
  let explanation;
  await withGameLock(locks, () => { initialized++; }, reason => { explanation = reason; });
  assert.equal(initialized, 1);
  assert.match(explanation, /another tab/);
  assert.equal(firstLease.active, true);
  firstLease.release();
  await first;
  assert.equal(firstLease.active, false);
  let secondLease;
  const second = withGameLock(locks, lease => { secondLease = lease; initialized++; }, assert.fail);
  assert.equal(initialized, 2);
  secondLease.release();
  await second;
});

test('unsupported or rejected locks fail closed before player storage is touched', async () => {
  for (const locks of [undefined, { request() { throw new Error('SecurityError'); } }]) {
    let reason;
    await withGameLock(locks, () => assert.fail('Must not initialize'), value => { reason = value; });
    assert.ok(reason);
  }
});

test('ordinary sessions reject every forced outcome before debiting the wager', () => {
  const session = new GameSession(100, 10);
  for (const kind of ['big', 'three', 'four', 'five', 'scatter', 'loss']) {
    assert.throws(() => session.startRound(kind), /forcers are disabled/);
    assert.equal(session.balance, 100);
    assert.equal(session.busy, false);
  }
});

test('production random source uses cryptographic samples within the supported interval', () => {
  const samples = Array.from({ length: 100 }, secureRandom);
  assert.ok(samples.every(value => Number.isFinite(value) && value >= 0 && value < 1));
  assert.ok(new Set(samples).size > 1);
});
