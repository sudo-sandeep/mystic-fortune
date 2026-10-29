import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { PAYLINES, BETS, createBoard, scoreBoard } from '../src/game.ts';
import { REEL_STRIPS } from '../src/reelConfig.ts';
import { BASE_LINE_PAYS, TARGET_RTP_PERCENT, calculateLineAward } from '../src/paytable.ts';
import { analyzeRtp } from '../src/rtp.ts';

const legacyPays = { 3: .12, 4: .35, 5: .85 };

function reelRows() {
  return REEL_STRIPS.map(strip => [0, 1, 2].map(row =>
    Uint8Array.from(strip, (_, stop) => strip[(stop + row) % strip.length])));
}

function prefixTable(rows) {
  if (PAYLINES.length > 31) throw new Error('Simulation mask supports up to 31 paylines.');
  const size = REEL_STRIPS.slice(0, 3).reduce((n, strip) => n * strip.length, 1);
  const buffer = new SharedArrayBuffer(size * 4);
  const table = new Uint32Array(buffer);
  let index = 0;
  for (let a = 0; a < REEL_STRIPS[0].length; a++) {
    for (let b = 0; b < REEL_STRIPS[1].length; b++) {
      for (let c = 0; c < REEL_STRIPS[2].length; c++) {
        let mask = 0;
        for (let line = 0; line < PAYLINES.length; line++) {
          const path = PAYLINES[line].rows;
          const symbol = rows[0][path[0]][a];
          if (symbol === rows[1][path[1]][b] && symbol === rows[2][path[2]][c]) mask |= 1 << line;
        }
        table[index++] = mask;
      }
    }
  }
  return buffer;
}

function fastPayout(stops, rows, table) {
  const lengths = REEL_STRIPS.map(strip => strip.length);
  let mask = table[(stops[0] * lengths[1] + stops[1]) * lengths[2] + stops[2]];
  let cents = 0;
  while (mask) {
    const line = 31 - Math.clz32(mask & -mask);
    mask &= mask - 1;
    const path = PAYLINES[line].rows;
    const symbol = rows[0][path[0]][stops[0]];
    const count = symbol !== rows[3][path[3]][stops[3]] ? 3
      : symbol !== rows[4][path[4]][stops[4]] ? 4 : 5;
    cents += Math.round(calculateLineAward(count, 1) * 100);
  }
  return cents;
}

function verifyKernel(rows, table) {
  // Check the optimized audit against the actual production generator and scorer.
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let trial = 0; trial < 10000; trial++) {
    const draws = Array.from({ length: 5 }, random);
    let draw = 0;
    const board = createBoard(() => draws[draw++]);
    const stops = draws.map((value, column) => Math.floor(value * REEL_STRIPS[column].length));
    for (const bet of trial < 100 ? BETS : [1]) {
      const expected = Math.round(scoreBoard(board, bet).total * 100);
      if (fastPayout(stops, rows, table) * bet !== expected) throw new Error(`Audit kernel disagrees with scoreBoard at trial ${trial}.`);
    }
  }
}

function simulate(spins, shared) {
  const rows = reelRows();
  const table = new Uint32Array(shared);
  const lengths = REEL_STRIPS.map(strip => strip.length);
  const firstRows = PAYLINES.map(line => rows[0][line.rows[0]]);
  const fourthRows = PAYLINES.map(line => rows[3][line.rows[3]]);
  const fifthRows = PAYLINES.map(line => rows[4][line.rows[4]]);
  const pays = [0, 0, 0, 3, 4, 5].map(count => count ? Math.round(calculateLineAward(count, 1) * 100) : 0);
  let count3 = 0, count4 = 0, count5 = 0, hitSpins = 0, squaredCents = 0;
  for (let spin = 0; spin < spins; spin++) {
    // The same uniform Math.random/floor stop selection used by createBoard.
    const a = Math.floor(Math.random() * lengths[0]);
    const b = Math.floor(Math.random() * lengths[1]);
    const c = Math.floor(Math.random() * lengths[2]);
    const d = Math.floor(Math.random() * lengths[3]);
    const e = Math.floor(Math.random() * lengths[4]);
    let mask = table[(a * lengths[1] + b) * lengths[2] + c];
    if (!mask) continue;
    hitSpins++;
    let paid = 0;
    while (mask) {
      const line = 31 - Math.clz32(mask & -mask);
      mask &= mask - 1;
      const symbol = firstRows[line][a];
      if (symbol !== fourthRows[line][d]) { count3++; paid += pays[3]; }
      else if (symbol !== fifthRows[line][e]) { count4++; paid += pays[4]; }
      else { count5++; paid += pays[5]; }
    }
    squaredCents += paid * paid;
  }
  return { spins, count3, count4, count5, hitSpins, squaredCents };
}

if (!isMainThread) {
  parentPort.postMessage(simulate(workerData.spins, workerData.table));
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at < 0 ? fallback : args[at + 1];
  };
  const spins = Number(option('--spins', 1_000_000));
  const workers = Number(option('--workers', Math.min(4, availableParallelism())));
  if (!Number.isSafeInteger(spins) || spins < 1 || spins > 1_000_000_000
    || !Number.isInteger(workers) || workers < 1 || workers > 16 || workers > spins) throw new Error('Invalid simulation size or worker count.');
  const started = performance.now();
  const rows = reelRows();
  const shared = prefixTable(rows);
  verifyKernel(rows, new Uint32Array(shared));
  console.log(`Verified the audit kernel against 10,000 production outcomes. Simulating ${spins.toLocaleString()} natural spins with ${workers} workers.`);
  const jobs = Array.from({ length: workers }, (_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { table: shared, spins: Math.floor(spins / workers) + (index < spins % workers ? 1 : 0) },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(new Error(`Simulation worker exited with ${code}.`)); });
  }));
  const chunks = await Promise.all(jobs);
  const totals = chunks.reduce((sum, chunk) => Object.fromEntries(Object.keys(sum).map(key => [key, sum[key] + chunk[key]])),
    { spins: 0, count3: 0, count4: 0, count5: 0, hitSpins: 0, squaredCents: 0 });
  const totalCents = [3, 4, 5].reduce((sum, count) => sum + totals[`count${count}`] * Math.round(calculateLineAward(count, 1) * 100), 0);
  const legacyCents = [3, 4, 5].reduce((sum, count) => sum + totals[`count${count}`] * Math.round(legacyPays[count] * 100), 0);
  const actual = totalCents / spins;
  const variance = Math.max(0, (totals.squaredCents - totalCents * totalCents / spins) / Math.max(1, spins - 1));
  const tolerance = 1.96 * Math.sqrt(variance / spins);
  const report = {
    generatedAt: new Date().toISOString(), spins, workers, elapsedSeconds: (performance.now() - started) / 1000,
    targetRtpPercent: TARGET_RTP_PERCENT, paytable: BASE_LINE_PAYS,
    theoretical: BETS.map(bet => analyzeRtp(bet)), legacyTheoretical: analyzeRtp(1, legacyPays),
    simulation: { rtpPercent: actual, legacyRtpPercent: legacyCents / spins,
      confidence95Percent: [actual - tolerance, actual + tolerance], hitRatePercent: totals.hitSpins / spins * 100,
      totalWager: spins, totalReturned: totalCents / 100, matchingLines: { 3: totals.count3, 4: totals.count4, 5: totals.count5 } },
    scope: 'Independent natural reel outcomes; excludes developer forcers and balance-neutral replays. No UI animations, round-ID allocation or bankroll stopping.',
  };
  const json = JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  const output = option('--output', 'reports/rtp-audit.json');
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await writeFile(output, json + '\n');
  console.log(json);
  console.log(`Saved ${output}`);
}
