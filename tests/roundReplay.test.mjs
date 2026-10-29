import assert from 'node:assert/strict';
import test from 'node:test';
import { BETS, GameSession, roundFromId, scoreBoard } from '../src/game.ts';
import { createRoundId, readRoundId, roundAnimationRandom } from '../src/roundId.ts';
import { RoundHistory, ROUND_HISTORY_LIMIT } from '../src/roundHistory.ts';
import { BASE_LINE_PAYS } from '../src/paytable.ts';
import { playReels } from '../src/timing.ts';

test('every accepted round gets a unique ID even when outcomes and wagers are identical', () => {
  const session = new GameSession();
  const ids = new Set();
  for (let index = 0; index < 100; index++) {
    const round = session.startRound('five');
    assert.match(round.id, /^MF1-/);
    assert.ok(round.id.length <= 160);
    ids.add(round.id);
    session.finishRound(round);
  }
  assert.equal(ids.size, 100);
});

test('IDs restore the exact natural and forced rounds at every supported wager', () => {
  for (const bet of BETS) {
    for (const force of [null, 'big', 'five', 'four', 'three', 'scatter', 'loss']) {
      const original = new GameSession(10_000, bet).startRound(force, () => .2);
      for (let repeat = 0; repeat < 3; repeat++) {
        const replay = roundFromId(`  ${original.id.toLowerCase()}  `);
        assert.deepEqual(replay, original);
        assert.ok(Object.isFrozen(replay));
        assert.ok(Object.isFrozen(replay.board[0]));
        assert.ok(Object.isFrozen(replay.result.lines));
        assert.throws(() => { replay.wager = 500; }, TypeError);
      }
    }
  }
});

test('legacy round IDs preserve their original awards and bonus under the new paytable', () => {
  const board = Array.from({ length: 5 }, () => [0, 0, 0]);
  const id = createRoundId({ board, wager: 10, bonus: 37.5, lineAwards: [1.2, 3.5, 8.5] });
  const restored = roundFromId(id);
  assert.equal(restored.result.total, 250);
  assert.equal(restored.result.bonus, 37.5);
  assert.ok(restored.result.lines.every(line => line.amount === 8.5));
  assert.equal(scoreBoard(board, 10).total, 6705);
  assert.equal(Object.isFrozen(BASE_LINE_PAYS), true);
});

test('the MF1 format keeps a previously issued ID compatible', () => {
  const replay = roundFromId('MF1-6925DD81D1A03794FB1701F3CA081C2E-RS-0-129421724A2722A-3C-9Q-NM-65CBE230');
  assert.equal(replay.wager, 10);
  assert.deepEqual(replay.board, [[1, 2, 9], [4, 2, 1], [7, 2, 4], [10, 2, 7], [2, 2, 10]]);
  assert.deepEqual(replay.result, {
    total: 8.5, bonus: 0,
    lines: [{ lineIndex: 0, count: 5, amount: 8.5, cells: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]] }],
  });
});

test('invalid, damaged, future-version and malformed IDs are rejected without changing the session', () => {
  const original = new GameSession().startRound('five');
  const session = new GameSession(100, 20);
  const ids = [null, 12, {}, '', 'hello', 'x'.repeat(10000), original.id.slice(0, -1),
    original.id.replace('MF1-', 'MF2-'), original.id.replace(/.$/, original.id.endsWith('0') ? '1' : '0'),
    original.id.replace(/-[0-9A]{15}-/, '-ZZZZZZZZZZZZZZZ-')];
  for (const id of ids) {
    assert.throws(() => session.startReplay(id), RangeError);
    assert.equal(session.balance, 100);
    assert.equal(session.bet, 20);
    assert.equal(session.busy, false);
  }
  const data = readRoundId(original.id);
  assert.throws(() => roundFromId(createRoundId({ ...data, wager: 3 })), /Unsupported wager/);
  assert.throws(() => createRoundId({ ...data, bonus: Infinity }), RangeError);
});

test('repeated replays use the original wager and bonus without debiting or crediting balance', () => {
  const original = new GameSession(10_000, 500).startRound('big');
  const session = new GameSession(0, 1);
  for (let index = 0; index < 5; index++) {
    const replay = session.startReplay(original.id);
    assert.deepEqual(replay, original);
    assert.equal(session.busy, true);
    assert.equal(session.balance, 0);
    assert.equal(session.bet, 1);
    assert.equal(session.startRound(), null);
    assert.equal(session.startReplay(original.id), null);
    assert.throws(() => session.setBet(5), /during a round/);
    session.settleRound(replay);
    assert.equal(session.balance, 0);
    assert.throws(() => session.settleRound(replay), /already been credited/);
    session.finishRound(replay);
    assert.equal(session.balance, 0);
    assert.equal(session.busy, false);
    assert.throws(() => session.settleRound(replay), /no longer active/);
  }
});

test('interrupted replays do not refund an uncharged wager and normal accounting resumes afterward', () => {
  const id = new GameSession().startRound('five').id;
  const session = new GameSession(100, 10);
  const replay = session.startReplay(id);
  session.finishRound(replay);
  assert.equal(session.balance, 100);
  const normal = session.startRound('five');
  assert.notEqual(normal.id, id);
  assert.equal(session.balance, 90);
  session.settleRound(normal);
  session.finishRound(normal);
  assert.equal(session.balance, 358.2);
});

test('a round cannot start replay while an ordinary spin is active', () => {
  const session = new GameSession();
  const normal = session.startRound('big');
  assert.equal(session.startReplay(normal.id), null);
  session.settleRound(normal);
  session.finishRound(normal);
  assert.equal(session.balance, 16_695);
});

test('replaying the same ID produces the same cosmetic strips and reel landings', async () => {
  const original = new GameSession().startRound('four');
  const sequence = id => {
    const random = roundAnimationRandom(id);
    return Array.from({ length: 100 }, random);
  };
  assert.deepEqual(sequence(original.id), sequence(roundFromId(original.id).id));
  assert.notDeepEqual(sequence(original.id), sequence(new GameSession().startRound('four').id));
  assert.ok(sequence(original.id).every(value => value >= 0 && value < 1));
  const controller = new AbortController();
  controller.abort();
  const landings = [];
  await playReels(roundFromId(original.id).board, async (column, symbols) => {
    landings.push([column, symbols]);
  }, controller.signal);
  assert.deepEqual(landings, original.board.map((symbols, column) => [column, symbols]));
});

test('history survives a fresh instance, deduplicates replays and caps retained IDs', () => {
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  const history = new RoundHistory(storage);
  const rounds = Array.from({ length: ROUND_HISTORY_LIMIT + 5 }, () => new GameSession().startRound('five'));
  rounds.forEach(round => history.remember(round));
  assert.equal(history.rounds.length, ROUND_HISTORY_LIMIT);
  assert.deepEqual(history.rounds[0], rounds.at(-1));
  assert.deepEqual(new RoundHistory(storage).rounds, history.rounds);
  history.remember(rounds.at(-2));
  assert.equal(history.rounds.length, ROUND_HISTORY_LIMIT);
  assert.deepEqual(history.rounds[0], rounds.at(-2));
  assert.equal(history.rounds.filter(round => round.id === rounds.at(-2).id).length, 1);
  // Even an ID evicted from history remains replayable with no storage lookup.
  assert.deepEqual(roundFromId(rounds[0].id), rounds[0]);
});

test('unavailable, full or damaged storage cannot stop play or ID replay', () => {
  const round = new GameSession().startRound('three');
  for (const raw of ['not JSON', '{}', 'x'.repeat(10001), JSON.stringify(['broken', null, round.id, round.id])]) {
    const history = new RoundHistory({ getItem: () => raw, setItem: () => { throw new Error('Full'); } });
    history.remember(round);
    assert.deepEqual(history.rounds, [round]);
  }
  const history = new RoundHistory({ getItem: () => { throw new Error('Disabled'); }, setItem() {} });
  history.remember(round);
  assert.deepEqual(history.rounds, [round]);
  assert.deepEqual(roundFromId(round.id), round);
});
