import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_PLAYER_KEY, PLAYER_STORAGE_PREFIX, PlayerStore, createPlayerId, normalizePlayerId } from '../src/players.ts';
import { GameSession, STARTING_BALANCE } from '../src/game.ts';
import { RoundHistory } from '../src/roundHistory.ts';

function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('first launch generates a unique player, and refresh resumes that same identity', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  assert.equal(store.createdInitialPlayer, true);
  assert.match(store.current.id, /^P-[0-9A-F]{32}$/);
  assert.equal(store.current.balance, STARTING_BALANCE);
  assert.equal(store.storageAvailable, true);
  const restored = new PlayerStore(storage);
  assert.equal(restored.createdInitialPlayer, false);
  assert.deepEqual(restored.current, store.current);
  const ids = new Set(Array.from({ length: 100 }, createPlayerId));
  assert.equal(ids.size, 100);
});

test('loading another player isolates balance and settings and restores them on return', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  const alice = store.load('  Alice-123  ');
  assert.equal(alice.id, 'ALICE-123');
  const saved = store.save({ ...alice, balance: 9988.88, bet: 20, currency: 'INR', sound: true, elapsedMs: 123456 });
  const bob = store.load('bob-456');
  assert.equal(bob.balance, STARTING_BALANCE);
  assert.equal(bob.bet, 10);
  assert.equal(bob.currency, 'USD');
  assert.equal(bob.sound, false);
  assert.equal(bob.elapsedMs, 0);
  store.save({ ...bob, balance: 25, bet: 1 });
  assert.deepEqual(store.load('alice-123'), saved);
  const refreshed = new PlayerStore(storage);
  assert.deepEqual(refreshed.current, saved);
  assert.equal(refreshed.load('BOB-456').balance, 25);
});

test('each player has a separate replay archive after switching and refreshing', () => {
  const storage = memoryStorage();
  const first = new GameSession().startRound('five');
  const second = new GameSession().startRound('big');
  const alice = new RoundHistory(storage, 'ALICE');
  const bob = new RoundHistory(storage, 'BOB');
  alice.remember(first);
  assert.equal(bob.rounds.length, 0);
  bob.remember(second);
  assert.deepEqual(new RoundHistory(storage, 'ALICE').rounds, [first]);
  assert.deepEqual(new RoundHistory(storage, 'BOB').rounds, [second]);
  assert.equal(new RoundHistory(storage, 'NEW-PLAYER').rounds.length, 0);
});

test('legacy browser rounds migrate only into the initial player archive', () => {
  const storage = memoryStorage();
  const legacy = new GameSession().startRound('three');
  new RoundHistory(storage).remember(legacy);
  const store = new PlayerStore(storage);
  const initial = new RoundHistory(storage, store.current.id, store.createdInitialPlayer);
  assert.deepEqual(initial.rounds, [legacy]);
  const second = store.load('SECOND-PLAYER');
  assert.equal(new RoundHistory(storage, second.id).rounds.length, 0);
  const refreshed = new PlayerStore(storage);
  assert.equal(refreshed.createdInitialPlayer, false);
  assert.equal(new RoundHistory(storage, refreshed.current.id, refreshed.createdInitialPlayer).rounds.length, 0);
});

test('last round and credited balance resume without paying or debiting the round again', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  const session = new GameSession();
  const round = session.startRound('big');
  session.settleRound(round);
  store.save({ ...store.current, balance: session.balance, lastRoundId: round.id });
  const refreshed = new PlayerStore(storage).current;
  const resumed = new GameSession(refreshed.balance, refreshed.bet);
  assert.equal(resumed.balance, 16695);
  const replay = resumed.startReplay(refreshed.lastRoundId);
  resumed.settleRound(replay);
  resumed.finishRound(replay);
  assert.equal(resumed.balance, 16695);
});

test('invalid player IDs never change the current player or overwrite its saved state', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  const original = store.current;
  for (const invalid of [null, 4, '', 'ab', '../alice', '<script>', 'a b', '-abc', 'a'.repeat(49)]) {
    assert.throws(() => store.load(invalid), RangeError);
    assert.deepEqual(store.current, original);
    assert.equal(storage.getItem(ACTIVE_PLAYER_KEY), original.id);
  }
  assert.equal(normalizePlayerId('  player_01  '), 'PLAYER_01');
  assert.throws(() => store.save({ ...original, id: 'DIFFERENT' }), /different player/);
  assert.throws(() => store.save({ ...original, balance: -1 }), /Invalid saved/);
  assert.throws(() => { original.balance = 99; }, TypeError);
});

test('unavailable or full storage retains separate player profiles for the current page', () => {
  for (const storage of [null, { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); } }]) {
    const store = new PlayerStore(storage);
    assert.equal(store.storageAvailable, false);
    const first = store.load('FIRST');
    store.save({ ...first, balance: 50, elapsedMs: 10000 });
    const second = store.load('SECOND');
    assert.equal(second.balance, STARTING_BALANCE);
    assert.equal(store.load('FIRST').balance, 50);
    assert.equal(store.current.elapsedMs, 10000);
  }
});

test('damaged saved data falls back to a usable profile without exposing other players', () => {
  for (const raw of ['bad JSON', '{}', '[]', 'x'.repeat(10001), JSON.stringify({ version: 9 }),
    JSON.stringify({ version: 1, balance: -1, bet: 10 })]) {
    const storage = memoryStorage();
    storage.setItem(ACTIVE_PLAYER_KEY, 'DAMAGED');
    storage.setItem(PLAYER_STORAGE_PREFIX + 'DAMAGED', raw);
    const current = new PlayerStore(storage).current;
    assert.equal(current.id, 'DAMAGED');
    assert.equal(current.balance, STARTING_BALANCE);
    assert.equal(current.lastRoundId, null);
  }
  const storage = memoryStorage();
  storage.setItem(ACTIVE_PLAYER_KEY, 'invalid player id');
  const store = new PlayerStore(storage);
  assert.match(store.current.id, /^P-/);
  assert.equal(store.storageAvailable, true);
});

test('reload selection persists the destination and preserves the outgoing player session', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  const first = store.load('FIRST');
  const savedFirst = store.save({ ...first, balance: 9876.54, bet: 20, elapsedMs: 12345 });
  const second = store.load('SECOND');
  const savedSecond = store.save({ ...second, balance: 52.25, bet: 5, currency: 'EUR' });
  store.load('FIRST');
  store.prepareReload('  second  ');
  assert.equal(storage.getItem(ACTIVE_PLAYER_KEY), 'SECOND');
  const reloaded = new PlayerStore(storage);
  assert.deepEqual(reloaded.current, savedSecond);
  assert.deepEqual(reloaded.load('FIRST'), savedFirst);
  // Reloading the current ID is also supported, without changing its credits.
  reloaded.prepareReload('FIRST');
  assert.deepEqual(new PlayerStore(storage).current, savedFirst);
});

test('failed reload persistence keeps the outgoing player active instead of reloading the wrong player', () => {
  const entries = new Map();
  let blocked = false;
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { if (blocked) throw new Error('Quota'); entries.set(key, value); },
  };
  const store = new PlayerStore(storage);
  const current = store.current;
  blocked = true;
  assert.throws(() => store.prepareReload('ANOTHER-PLAYER'), /Could not save/);
  assert.deepEqual(store.current, current);
  assert.equal(storage.getItem(ACTIVE_PLAYER_KEY), current.id);
  assert.equal(store.storageAvailable, false);
  blocked = false;
  store.prepareReload('ANOTHER-PLAYER');
  assert.equal(store.storageAvailable, true);
  assert.equal(new PlayerStore(storage).current.id, 'ANOTHER-PLAYER');
  const memoryOnly = new PlayerStore(null);
  const previousId = memoryOnly.current.id;
  assert.throws(() => memoryOnly.prepareReload('ANOTHER-PLAYER'), /storage is unavailable/);
  assert.equal(memoryOnly.current.id, previousId);
});

test('reload rejects malformed IDs and detects storage that silently ignores writes', () => {
  const storage = memoryStorage();
  const store = new PlayerStore(storage);
  const current = store.current;
  const original = [...storage.entries];
  assert.throws(() => store.prepareReload('invalid ID!'), RangeError);
  assert.deepEqual([...storage.entries], original);
  storage.setItem = () => {};
  assert.throws(() => store.prepareReload('ANOTHER-PLAYER'), /Could not save/);
  assert.deepEqual(store.current, current);
  assert.equal(storage.getItem(ACTIVE_PLAYER_KEY), current.id);
});
