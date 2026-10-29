import { preloadGameAssets } from './assets.ts';
import { Dialogs } from './dialogs.ts';
import { IntroScreen } from './intro.ts';
import { ReelAudio } from './audio.ts';
import { RoundMessageCycle } from './roundMessages.ts';
import { RoundHistory } from './roundHistory.ts';
import { roundAnimationRandom } from './roundId.ts';
import { PlayerStore } from './players.ts';
import { withGameLock, type GameLease } from './tabLock.ts';
import {
  BETS, GameSession, PAYLINES, STARTING_BALANCE, createBoard, roundFromId,
  type ForceKind, type Round, type SpinResult,
} from './game.ts';
import { ReelView, celebrate, rollUpWin } from './presentation.ts';
import { delay, playReels } from './timing.ts';

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required interface element: ${id}`);
  return node;
}

function button(id: string): HTMLButtonElement {
  const node = element(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Expected a button: ${id}`);
  return node;
}

function blockedGame(reason: string): void {
  element('intro-loading-content').hidden = false;
  element('intro-progress').hidden = true;
  element('intro-sound-prompt').hidden = true;
  element('intro-status').textContent = reason;
  const retry = button('intro-retry');
  retry.hidden = false;
  retry.textContent = 'TRY AGAIN';
  retry.onclick = () => window.location.reload();
}

function startGame(lease: GameLease): void {
// Cache references and formatters; the win counter updates on every animation frame.
const ui = {
  reels: element('reels'), balance: element('balance'), bet: element('bet'),
  win: element('win'), message: element('message'), net: element('net-value'),
  playTime: element('play-time'), spin: button('spin'), minus: button('minus'),
  plus: button('plus'), betTrigger: button('bet-trigger'),
  currencyTrigger: button('currency-trigger'), currencyCode: element('currency-code'),
  forcerTrigger: import.meta.env.DEV ? button('forcer-launch') : null, betOptions: element('bet-options'),
  currencyOptions: element('currency-options'), forcerOptions: import.meta.env.DEV ? element('forcer-options') : null,
  roundCopy: button('round-copy'),
  roundLaunch: button('round-launch'), roundMode: element('round-mode'), roundStatus: element('round-status'),
  replayId: element('replay-id') as HTMLInputElement, replayError: element('replay-error'),
  roundHistory: element('round-history'),
  soundToggle: button('sound-toggle'), soundState: element('sound-state'),
  menu: button('player-menu'), playerId: element('player-id') as HTMLInputElement,
  playerCurrentId: element('player-current-id'), playerBalance: element('player-balance'),
  playerBet: element('player-bet'), playerRounds: element('player-round-count'),
  playerError: element('player-error'), playerStorage: element('player-storage-note'),
  replayPlayerId: element('replay-player-id'),
};

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar', rate: 1 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', rate: 90 },
  { code: 'EUR', symbol: '€', name: 'Euro', rate: .9 },
  { code: 'GBP', symbol: '£', name: 'British Pound', rate: .78 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', rate: 150 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', rate: 1.36 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', rate: 1.52 },
] as const;
const formatters = new Map(CURRENCIES.map(item => [item.code, new Intl.NumberFormat('en-US', {
  style: 'currency', currency: item.code, minimumFractionDigits: 2, maximumFractionDigits: 2,
})]));
const playerStorage = (() => { try { return window.localStorage; } catch { return null; } })();
const players = new PlayerStore(playerStorage);
let player = players.current;
let currency: typeof CURRENCIES[number] = CURRENCIES.find(item => item.code === player.currency) ?? CURRENCIES[0];
const money = (value: number) => formatters.get(currency.code)!.format(value * currency.rate);

const forceOptions: readonly { id: ForceKind; title: string }[] = import.meta.env.DEV ? [
  { id: 'big', title: '✦ Big Win (25×+)' },
  { id: 'five', title: '✦ 5 of a Kind' },
  { id: 'four', title: '✦ 4 of a Kind' },
  { id: 'three', title: '✦ 3 of a Kind' },
  { id: 'scatter', title: '✦ Scatter Symbols' },
  { id: 'loss', title: '✦ No Win' },
] : [];

type Phase = 'loading' | 'idle' | 'spinning' | 'presenting' | 'error';
const session = new GameSession(player.balance, player.bet, import.meta.env.DEV);
const history = new RoundHistory(playerStorage, player.id, players.createdInitialPlayer, players.roundIds);
const reelAudio = new ReelAudio();
reelAudio.setEnabled(false);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionPreference.matches;
const view = new ReelView(ui.reels, reducedMotion);
const messageCycle = new RoundMessageCycle(entry => {
  // Idle replays remain visible without repeatedly announcing the same wins.
  ui.message.setAttribute('aria-live', 'off');
  if (entry.kind === 'line') {
    view.highlight(entry.line);
    message(`Line ${entry.line.lineIndex + 1} wins ${money(entry.line.amount)}`, true);
  } else {
    view.clearWins();
    message(session.balance < session.bet
      ? 'Game Over - Play On · Choose a lower bet to continue'
      : 'Game Over - Play On');
  }
});
const dialogs = new Dialogs([element('game'), ui.menu]);
const intro = new IntroScreen({
  root: element('intro'), progress: element('intro-progress'), fill: element('intro-fill'),
  percent: element('intro-percent'), status: element('intro-status'), retry: button('intro-retry'),
  loading: element('intro-loading-content'), soundPrompt: element('intro-sound-prompt'),
  soundYes: button('intro-sound-yes'), soundNo: button('intro-sound-no'),
});
let phase: Phase = 'loading';
let currentRound: Round | null = player.lastRoundId ? roundFromId(player.lastRoundId) : null;
let displayedWin = currentRound?.result.total ?? 0;
let board = currentRound?.board ?? createBoard();
let stopController: AbortController | null = null;
let presentationController: AbortController | null = null;
let skipAvailable = false;
let replaying = player.lastReplay;
let reloadingPlayer = false;

function hud(): void {
  const idle = phase === 'idle';
  const canStop = phase === 'spinning' && stopController !== null && !stopController.signal.aborted;
  ui.balance.textContent = money(session.balance);
  ui.bet.textContent = money(replaying && !idle && currentRound ? currentRound.wager : session.bet);
  ui.win.textContent = money(displayedWin);
  const net = Math.round((session.balance - STARTING_BALANCE) * 100) / 100;
  ui.net.textContent = (net > 0 ? '+' : '') + money(net);
  ui.spin.disabled = !(canStop || skipAvailable || (idle && session.balance >= session.bet));
  ui.spin.textContent = skipAvailable ? 'SKIP' : canStop ? 'Stop' : phase === 'loading' ? 'LOADING' : 'SPIN';
  ui.spin.setAttribute('aria-label', skipAvailable ? 'Skip win presentation' : canStop ? 'Stop reels' : 'Spin reels');
  ui.minus.disabled = !idle || session.bet === BETS[0];
  ui.plus.disabled = !idle || session.bet === BETS[BETS.length - 1];
  ui.betTrigger.disabled = !idle;
  ui.currencyTrigger.disabled = !idle;
  ui.soundToggle.disabled = !idle;
  ui.soundToggle.setAttribute('aria-pressed', String(reelAudio.enabled));
  ui.soundState.textContent = reelAudio.enabled ? 'ON' : 'OFF';
  ui.soundToggle.title = `Sound ${reelAudio.enabled ? 'on' : 'off'} · Click to turn ${reelAudio.enabled ? 'off' : 'on'}`;
  if (ui.forcerTrigger) ui.forcerTrigger.disabled = !idle || session.balance < session.bet;
  ui.roundLaunch.disabled = !idle;
  ui.menu.disabled = !idle;
  ui.roundMode.hidden = !replaying;
  ui.roundMode.textContent = replaying && currentRound ? `UNVERIFIED DEMO REPLAY · Original bet ${money(currentRound.wager)} · Balance unchanged` : '';
  ui.currencyCode.textContent = currency.code;
  ui.reels.setAttribute('aria-busy', String(phase === 'spinning'));
}

function message(text: string, lineWin = false): void {
  ui.message.textContent = text;
  ui.message.classList.toggle('line-win', lineWin);
}

function chooseBet(value: number): void {
  if (phase !== 'idle') return;
  session.setBet(value);
  savePlayer();
  hud();
  if (messageCycle.active) messageCycle.refresh();
  else if (session.balance < value) message('Choose a lower bet to continue');
  else message("Press 'Spin' to Play");
}

function initDialogs(): void {
  const betBackdrop = element('bet-backdrop');
  const currencyBackdrop = element('currency-backdrop');
  const forcerBackdrop = import.meta.env.DEV ? element('forcer-backdrop') : null;
  const roundBackdrop = element('round-backdrop');
  const playerBackdrop = element('player-backdrop');
  dialogs.register(betBackdrop, button('bet-close'));
  dialogs.register(currencyBackdrop, button('currency-close'));
  if (forcerBackdrop) dialogs.register(forcerBackdrop, button('forcer-close'));
  dialogs.register(roundBackdrop, button('round-close'));
  dialogs.register(playerBackdrop, button('player-close'), {
    exitMs: () => reducedMotion() ? 0 : 250,
    onClose: () => { ui.menu.setAttribute('aria-expanded', 'false'); },
  });
  ui.menu.addEventListener('click', () => {
    if (phase !== 'idle') return;
    ui.playerCurrentId.textContent = player.id;
    ui.playerId.value = player.id;
    ui.playerBalance.textContent = money(session.balance);
    ui.playerBet.textContent = money(session.bet);
    ui.playerRounds.textContent = String(history.rounds.length);
    ui.playerError.textContent = '';
    ui.playerId.removeAttribute('aria-invalid');
    ui.playerStorage.textContent = players.storageAvailable
      ? 'Player sessions are saved in this browser.'
      : 'Browser storage is unavailable. Player sessions will last until this page closes.';
    dialogs.open(playerBackdrop);
    ui.menu.setAttribute('aria-expanded', 'true');
  });
  const loadPlayer = (id: string) => {
    if (phase !== 'idle') return;
    try {
      savePlayer();
      players.prepareReload(id);
      reloadingPlayer = true;
      phase = 'loading';
      messageCycle.stop();
      reelAudio.suspend();
      hud();
      window.location.reload();
    } catch (error) {
      if (reloadingPlayer) {
        players.load(player.id);
        reloadingPlayer = false;
        phase = 'idle';
        hud();
        if (currentRound) messageCycle.start(currentRound.result);
      }
      ui.playerError.textContent = error instanceof Error ? error.message : 'Could not load this player.';
      ui.playerId.setAttribute('aria-invalid', 'true');
      ui.playerId.focus();
    }
  };
  element('player-form').addEventListener('submit', event => {
    event.preventDefault();
    loadPlayer(ui.playerId.value);
  });
  ui.playerId.addEventListener('input', () => {
    ui.playerError.textContent = '';
    ui.playerId.removeAttribute('aria-invalid');
  });

  const playRoundId = (id: string) => {
    if (phase !== 'idle') return;
    try {
      const round = roundFromId(id);
      ui.replayError.textContent = '';
      ui.replayId.removeAttribute('aria-invalid');
      dialogs.close();
      void spin(null, round.id);
    } catch (error) {
      ui.replayError.textContent = error instanceof Error ? error.message : 'Invalid round ID.';
      ui.replayId.setAttribute('aria-invalid', 'true');
      ui.replayId.focus();
    }
  };
  element('round-form').addEventListener('submit', event => {
    event.preventDefault();
    playRoundId(ui.replayId.value);
  });
  ui.replayId.addEventListener('input', () => {
    ui.replayError.textContent = '';
    ui.replayId.removeAttribute('aria-invalid');
    ui.roundCopy.disabled = ui.replayId.value.trim() === '';
    ui.roundStatus.textContent = '';
  });
  ui.roundLaunch.addEventListener('click', () => {
    if (phase !== 'idle') return;
    ui.replayId.value = currentRound?.id ?? '';
    ui.roundCopy.disabled = ui.replayId.value === '';
    ui.roundStatus.textContent = '';
    ui.replayError.textContent = '';
    ui.replayId.removeAttribute('aria-invalid');
    ui.roundHistory.replaceChildren();
    ui.replayPlayerId.textContent = player.id;
    const rounds = history.rounds;
    if (rounds.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No rounds for this player yet. Play a round to save its replay.';
      ui.roundHistory.append(empty);
    }
    for (const round of rounds) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'round-history-choice';
      choice.title = round.id;
      const name = document.createElement('strong');
      name.textContent = `${round.id.slice(0, 11)}…${round.id.slice(-8)}`;
      const details = document.createElement('span');
      details.textContent = `Bet ${money(round.wager)} · Win ${money(round.result.total)} · Replay ↗`;
      choice.append(name, details);
      choice.addEventListener('click', () => playRoundId(round.id));
      ui.roundHistory.append(choice);
    }
    dialogs.open(roundBackdrop);
    ui.replayId.focus();
  });
  ui.roundCopy.addEventListener('click', async () => {
    const id = ui.replayId.value.trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      ui.roundStatus.textContent = 'Round ID copied.';
    } catch {
      ui.replayId.focus();
      ui.replayId.select();
      ui.roundStatus.textContent = 'Round ID selected. Copy it with Ctrl+C or your device’s copy command.';
    }
  });

  for (const value of BETS) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'bet-option';
    choice.addEventListener('click', () => { dialogs.close(); chooseBet(value); });
    ui.betOptions.append(choice);
  }
  ui.betTrigger.addEventListener('click', () => {
    if (phase !== 'idle') return;
    ui.betOptions.querySelectorAll<HTMLButtonElement>('button').forEach((choice, index) => {
      choice.textContent = money(BETS[index]);
      choice.classList.toggle('selected', BETS[index] === session.bet);
      choice.setAttribute('aria-pressed', String(BETS[index] === session.bet));
    });
    dialogs.open(betBackdrop);
  });

  for (const item of CURRENCIES) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'currency-choice';
    choice.textContent = `${item.symbol}  ${item.code} · ${item.name}`;
    choice.addEventListener('click', () => {
      if (phase !== 'idle') return;
      currency = item;
      savePlayer();
      dialogs.close();
      hud();
      messageCycle.refresh();
    });
    ui.currencyOptions.append(choice);
  }
  ui.currencyTrigger.addEventListener('click', () => {
    if (phase !== 'idle') return;
    ui.currencyOptions.querySelectorAll<HTMLButtonElement>('button').forEach((choice, index) => {
      const selected = CURRENCIES[index].code === currency.code;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
    dialogs.open(currencyBackdrop);
  });

  if (import.meta.env.DEV && ui.forcerTrigger && ui.forcerOptions && forcerBackdrop) {
  for (const option of forceOptions) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'forcer-choice';
    choice.textContent = option.title;
    choice.addEventListener('click', () => { dialogs.close(); void spin(option.id); });
    ui.forcerOptions.append(choice);
  }
  ui.forcerTrigger.addEventListener('click', () => {
    if (phase === 'idle' && session.balance >= session.bet) dialogs.open(forcerBackdrop);
  });
  }
}

async function showLines(result: SpinResult, signal: AbortSignal): Promise<void> {
  try {
    for (const line of result.lines) {
      if (signal.aborted) break;
      view.highlight(line);
      message(`Line ${line.lineIndex + 1} wins ${money(line.amount)}`, true);
      await delay(reducedMotion() ? 500 : 1700, signal);
    }
  } finally { view.clearWins(); }
}

async function presentWin(round: Round): Promise<void> {
  const { total } = round.result;
  if (total === 0) return;
  phase = 'presenting';
  presentationController = new AbortController();
  const controller = presentationController;
  const multiplier = total / round.wager;
  const isBig = multiplier >= 25;
  const duration = reducedMotion() ? 0 : isBig
    ? Math.min(60_000, 21_000 * Math.max(1, multiplier / 25))
    : Math.min(3500, Math.max(900, 800 + multiplier * 120));
  const shower = isBig && duration > 0 ? celebrate(ui.reels, money, total, reducedMotion(), controller.signal) : null;
  const skipDelay = reducedMotion() ? 0 : isBig ? 5000 : 500;
  const skipTimer = setTimeout(() => {
    if (controller.signal.aborted) return;
    skipAvailable = true;
    hud();
  }, skipDelay);
  const stopRollupSound = duration > 0 ? reelAudio.startWinRollup(controller.signal) : () => {};
  const stopRollupEffects = () => {
    stopRollupSound();
    shower?.stop();
  };
  try {
    await Promise.all([
      rollUpWin(total, duration, value => {
        displayedWin = value;
        ui.win.textContent = money(value);
        shower?.update(value);
      }, controller.signal, stopRollupEffects),
      showLines(round.result, controller.signal),
    ]);
  } finally {
    stopRollupEffects();
    clearTimeout(skipTimer);
    controller.abort();
    skipAvailable = false;
    hud();
    // Finish the short visual exit before another spin can start.
    await shower?.stop();
    presentationController = null;
  }
}

async function spin(force: ForceKind | null = null, replayId: string | null = null): Promise<void> {
  if (!lease.active || phase !== 'idle' || dialogs.isOpen) return;
  if (force && !import.meta.env.DEV) return;
  reelAudio.unlock();
  let round: Round | null = null;
  let completedResult: SpinResult | null = null;
  const previousBoard = board;
  const previousRound = currentRound;
  const previousReplay = replaying;
  try {
    savePlayer();
    round = replayId === null ? session.startRound(force) : session.startReplay(replayId);
    if (!round) return;
    currentRound = round;
    replaying = replayId !== null;
    session.settleRound(round, balance => {
      if (replaying) return;
      player = players.commitRound({
        id: player.id, balance, bet: session.bet, currency: currency.code,
        sound: reelAudio.enabled, elapsedMs: Math.floor(elapsedMilliseconds()),
        lastRoundId: round!.id, lastReplay: false,
      });
    });
    if (!replaying) history.remember(round);
    ui.roundStatus.textContent = '';
    messageCycle.stop();
    ui.message.setAttribute('aria-live', 'polite');
    phase = 'spinning';
    displayedWin = 0;
    stopController = new AbortController();
    view.start(roundAnimationRandom(round.id));
    message(replaying ? 'Replaying round' : 'Good luck');
    hud();
    await playReels(round.board, (column, result, slammed) => view.land(column, result, slammed),
      stopController.signal, reducedMotion(), column => reelAudio.playLanding(column));
    stopController = null;
    phase = 'presenting';
    board = round.board;
    savePlayer();
    hud();
    await presentWin(round);
    completedResult = round.result;
  } catch (error) {
    console.error('Spin round failed:', error);
    presentationController?.abort();
    if (round && session.roundSettled) {
      board = round.board;
      displayedWin = round.result.total;
      message(replaying ? 'Replay ended. Balance unchanged.' : 'Round saved. Balance updated. Ready to play again.');
      completedResult = round.result;
    } else {
      board = previousBoard;
      displayedWin = previousRound?.result.total ?? 0;
      message(replaying ? 'Replay interrupted. Balance unchanged.' : error instanceof Error ? error.message : 'Round could not be saved. No wager was taken.');
    }
    view.render(board);
  } finally {
    if (round && !session.roundSettled) {
      currentRound = previousRound;
      replaying = previousReplay;
    }
    if (round) session.finishRound(round);
    savePlayer();
    stopController = null;
    presentationController = null;
    skipAvailable = false;
    view.cleanup();
    phase = 'idle';
    hud();
    if (completedResult) messageCycle.start(completedResult);
    else if (session.balance < session.bet) message('Choose a lower bet to continue');
  }
}

ui.spin.addEventListener('click', () => {
  if (skipAvailable && presentationController) {
    skipAvailable = false;
    presentationController.abort();
    hud();
  } else if (phase === 'spinning' && stopController) {
    reelAudio.unlock();
    stopController.abort();
    hud();
  } else { void spin(); }
});
ui.minus.addEventListener('click', () => {
  const index = BETS.findIndex(value => value === session.bet);
  chooseBet(BETS[Math.max(0, index - 1)]);
});
ui.plus.addEventListener('click', () => {
  const index = BETS.findIndex(value => value === session.bet);
  chooseBet(BETS[Math.min(BETS.length - 1, index + 1)]);
});
ui.soundToggle.addEventListener('click', () => {
  if (phase !== 'idle') return;
  reelAudio.setEnabled(!reelAudio.enabled);
  savePlayer();
  hud();
});

let sessionStart: number | null = null;
const elapsedBeforeSession = player.elapsedMs;
let lastPlayerSave = Date.now();
function elapsedMilliseconds(): number {
  return elapsedBeforeSession + (sessionStart === null ? 0 : Math.max(0, Date.now() - sessionStart));
}

function savePlayer(): void {
  // Unload/timer callbacks still belong to the old player after the destination is selected.
  if (!lease.active || reloadingPlayer || sessionStart === null) return;
  // Failed acceptance must never overwrite the last committed balance.
  if (session.busy && !session.roundSettled) return;
  player = players.save({
    id: player.id, balance: session.balance, bet: session.bet, currency: currency.code,
    sound: reelAudio.enabled, elapsedMs: Math.floor(elapsedMilliseconds()),
    lastRoundId: currentRound?.id ?? null, lastReplay: replaying,
  });
}

function updatePlayTime(): void {
  const seconds = Math.floor(elapsedMilliseconds() / 1000);
  ui.playTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (sessionStart !== null && Date.now() - lastPlayerSave >= 10_000) {
    savePlayer();
    lastPlayerSave = Date.now();
  }
}
// Hidden tabs do not need a UI refresh every second.
let playTimeTimer: ReturnType<typeof setInterval> | null = null;
function syncPlayTime(): void {
  if (document.hidden && sessionStart !== null) savePlayer();
  messageCycle.setPaused(document.hidden);
  if (playTimeTimer !== null) clearInterval(playTimeTimer);
  playTimeTimer = null;
  updatePlayTime();
  if (!document.hidden && sessionStart !== null) playTimeTimer = setInterval(updatePlayTime, 1000);
}
document.addEventListener('visibilitychange', syncPlayTime);
window.addEventListener('pagehide', () => {
  savePlayer();
  if (playTimeTimer !== null) clearInterval(playTimeTimer);
  stopController?.abort();
  presentationController?.abort();
  reelAudio.suspend();
  messageCycle.setPaused(true);
  lease.release();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { window.location.reload(); return; }
  syncPlayTime();
});

view.render(board);
document.querySelectorAll<HTMLElement>('[data-payline-count]').forEach(label => {
  label.textContent = String(PAYLINES.length);
});
document.querySelector('.reel-lines-left')?.setAttribute('aria-label', `${PAYLINES.length} paylines`);
initDialogs();
syncPlayTime();
hud();
message('Loading symbols…');

let initializing = false;
async function initialize(): Promise<void> {
  if (initializing) return;
  initializing = true;
  phase = 'loading';
  hud();
  try {
    await intro.load(preloadGameAssets);
    await intro.askForSound(enabled => { reelAudio.setEnabled(enabled); });
    sessionStart = Date.now();
    syncPlayTime();
    phase = 'idle';
    savePlayer();
    hud();
    if (currentRound) messageCycle.start(currentRound.result);
    else message("Press 'Spin' to Play");
    for (const target of [element('game'), ui.menu]) {
      target.inert = false;
      target.removeAttribute('aria-hidden');
    }
    document.body.classList.remove('intro-loading');
    if (element('intro').contains(document.activeElement)) ui.spin.focus({ preventScroll: true });
    intro.dismiss();
  } catch (error) {
    console.error('Game initialization failed:', error);
    phase = 'error';
    hud();
    intro.fail();
  } finally { initializing = false; }
}
button('intro-retry').addEventListener('click', () => { void initialize(); });
void initialize();

}

void withGameLock(navigator.locks, startGame, blockedGame);
