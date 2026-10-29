# Mystic Fortune Browser Demo

A TypeScript/Vite slot animation demo using virtual credits. Requires Node.js 22.18 or newer.

## Run

```sh
npm ci
npm run dev
```

Open the displayed local URL. To test the production version:

```sh
npm run build
npm run preview
```

Serve the generated `dist/` directory through an HTTP server. Opening `index.html` directly as a file is unsupported. For hosting under a subpath, build with `npm run build -- --base=/your-subpath/`.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

To reproduce the billion-spin RTP audit:

```sh
npm run audit:rtp -- --spins 1000000000 --workers 4 --output reports/rtp-1billion.json
```

The tests use Node's built-in test runner and cover payout calculation, reel wrapping, credit accounting, duplicate settlement, interrupted rounds, forced outcomes, and partial/immediate Stop behavior.

## Game behavior

- A themed intro shows a centered loading bar for at least five seconds. Entry also waits for all game images to load and decode. The bar is then replaced by “Would you like to play sound?” with Yes and No buttons. Either choice opens the game; Yes enables all game sounds and No keeps them muted. No sound is activated before the choice, and the play timer starts only when the game opens. A failed load keeps the intro open with a retry button.
- The **Music & sound** ON/OFF control in the sidebar toggles all game sounds between rounds. Its crossed-out note means sound is off. It is disabled throughout reel spinning, win presentation and the celebration fade, including round replays. Sound starts muted on each page load until the intro choice; it is not part of a round ID.
- A top-right menu button opens a themed sidebar sliding in from the right. Round replay, Music & sound and Choose currency are available in this panel. Outcome forcers appear only in local development (`npm run dev`) and are removed from production builds. A unique random player ID is assigned on the first visit. Edit the ID and choose **Load session** to resume an existing local player or load a fresh one. There is no separate create-player button. IDs use 3–48 letters, digits, hyphens or underscores and are case-insensitive. Switching is available between rounds only.
- Each player retains their own balance, wager, currency, sound preference, elapsed play time, last displayed round and last 30 played-round IDs. **Load session** saves the current player, selects the entered ID and reloads the page. The full intro, five-second loading bar and sound question appear before the selected player's game and replay archive open. Unload callbacks cannot overwrite the selected player with the old session. Loading requires working browser storage; a failed save keeps the current session open with an error. Previewing a pasted round code does not add it to a different player's archive. The first player inherits any replay history from earlier versions of the demo.
- Five reels, three visible rows, and 25 fixed paylines in the exact order of the supplied configuration. Row 0 is top, row 1 is middle, and row 2 is bottom. Line 1 is the middle horizontal, line 2 is the top horizontal, and line 3 is the bottom horizontal. All 25 paths are defined in `src/game.ts` and checked against the reference in `tests/paylines.test.mjs`.
- The reel window has an ornate fixed frame, four vertical and two horizontal separators, and a shared rune background. Symbols and spinning strips are transparent and borderless; individual frames appear only for winning symbols. The side panels display the actual payline count.
- Matching runs start on the leftmost reel. Three, four, and five matches pay 3.62, 11.14, and 26.82 times the total wager per line, regardless of symbol. With the configured strips and 25 paylines, this fixed paytable has exactly 92% theoretical RTP at every supported bet. New spins remain independent; no player-history balancing is used.
- Each spin's immutable outcome is selected before animation starts. Stop accelerates unfinished reels without changing the outcome or reels that have already landed.
- Normal reel stops preserve the visible spinning symbols, then decelerate into the preselected result over 380ms, with no viewport bounce. The first brake starts at 1100ms and subsequent reels keep a 380ms stagger. Slam retains its 650ms brake. Pressing Stop during an in-progress normal brake starts the other brakes immediately and plays one combined landing sound when the unfinished group has settled.
- Every accepted round receives a unique `MF1` ID. IDs and Copy ID are available inside **Round replay**, opened from the sidebar, and stay off the main game screen. Paste an ID, or choose one of the last 30 rounds saved for the active player on this browser. A replay restores the original 5×3 symbols, wager, per-line awards and bonus, including Big Win presentation and sounds. Its spinning symbol strips are also deterministic. Stop and Skip remain available. Replays do not debit, credit or refund the balance, and cannot overlap another round.
- Round IDs contain a random 128-bit identifier and a compact snapshot with a typo-detection checksum. They work after refresh and on other devices without a backend or history lookup. They are demo replay codes, not authenticated financial records. `MF1` refers to the current symbol indices and 25 payline paths; future changes to those require a new version while retaining the MF1 decoder. Original line award amounts are encoded, so changing the active paytable does not alter saved awards. Interrupted rounds also retain their preselected outcome ID.
- Each reel has its own hollow metal-container slam, with a heavy floor impact, resonating steel shell, and brief settling rattle. The sounds increase in loudness, weight, pitch, and resonance from reel 1 to reel 5; reel 5 is the loudest. Slam Stop plays one combined impact using reel 5's sound when all remaining reels finish landing, in addition to sounds from reels that stopped earlier. All five sounds are synthesized and cached locally, activated by a player click, and optional when browser audio is unavailable.
- Credits are accounted for in integer cents. Before animation, the final balance, immutable outcome and replay archive are committed atomically in one browser-storage entry. Reloads and animation failures retain that accepted result without another debit or payout. If acceptance cannot be saved, no round is shown and the wager is returned.
- Skip finishes both the counter and line presentation. Reduced-motion preferences are respected.
- Smooth, rising arcade chimes accompany the win counter rollup. The sound stops when counting finishes or Skip is pressed, even if line messages continue. Idle message replay does not trigger it, and an instant reduced-motion counter remains silent.
- Big Wins launch a gold coin fountain from the bottom center of the reel window across the full screen. The shower and the same rollup sound run together until the win counter completes or Skip is pressed. Skip immediately completes the counter, then the popup fades and existing coins keep moving through a short fade before the next spin is enabled. The fountain follows scroll/resize, respects reduced motion, and uses a bounded particle pool.
- Big Win amounts use lining, tabular digits on a fixed-height row. The final formatted win reserves its width before rollup begins; long currency amounts scale to fit without wrapping or resizing the popup. Resizing updates the fit, and the observer is disconnected when the popup exits.
- After a completed round, its line-win messages and matching highlights repeat in order, followed by "Game Over - Play On," until the next accepted spin. Bet changes keep the previous round's awards intact; currency changes reformat them immediately. Idle replay pauses in hidden tabs and does not replay sounds, celebrations, or credit settlement.
- Seven display currencies use illustrative fixed conversion rates. Wagers and balances retain their USD-equivalent value.
- Outcome forcers are available only in development for demo testing; production sessions reject forced outcomes. Big Win selects an all-matching board, paying all 25 lines (670.5 times the wager under the current table). Saved replays retain their original paytable amounts and any historical bonus. The message line cycles through payline wins and Game Over only.
- Player sessions and the active player ID persist in browser storage. Refresh resumes the last saved state after the intro sound choice. Accepted rounds are saved before any reel animation, so reloading during a spin retains its exact final balance and outcome. New spins require working browser storage and reject acceptance if it is blocked or full. Existing v1 profiles migrate to separate v2 keys so an old pre-upgrade tab cannot overwrite the new ledger. Player IDs select local demo profiles, with no account authentication or cross-device session synchronization; portable round codes still work independently.

The natural game's theoretical RTP is **exactly 92%** (the rational return is 23/25). Its previous paytable returned **3.009829944368418%**. A completed **1,000,000,000-spin** audit returned **92.002354288%**, with a 95% confidence interval of **91.9824735945%–92.0222349815%** and a paying-spin rate of **12.0464238%**. The audit uses the same uniformly selected reel stops and scoring rules, checks its optimized scoring against 10,000 production-generated outcomes, and excludes developer forcers, replays, animations and bankroll stopping. The exact calculation includes overlapping paylines and per-line cent rounding. A finite sample can differ from 92%; the engine does not force a player's individual results to that percentage. See [the analysis](reports/RTP-ANALYSIS.md) and [the complete audit](reports/rtp-1billion.json). Scatter currently pays as an ordinary line symbol; wild substitution, free spins, and scatter bonuses are not implemented.

## Source layout

- `src/game.ts`: outcomes, paylines, forced boards, and guarded credit settlement.
- `src/roundId.ts` and `src/roundHistory.ts`: portable round snapshots, deterministic cosmetic randomness, and bounded local replay history.
- `src/players.ts`: unique player IDs, validated local session snapshots and player switching.
- `src/reelConfig.ts` and `src/paytable.ts`: reel and award configuration.
- `src/rtp.ts`, `scripts/rtp-audit.mjs` and `reports/`: exact RTP proof, reproducible simulations and recorded audit results.
- `src/assets.ts`: typed image imports and preloading; Vite packages the referenced assets.
- `src/presentation.ts` and `src/timing.ts`: reel animations, cancellation, and win presentation.
- `src/reelLanding.ts`: continuous reel-strip handoff and speed-matched normal braking.
- `src/roundMessages.ts`: cancellable idle replay of the last completed round's messages.
- `src/coinShower.ts` and `src/winRollup.ts`: full-screen coin fountain and shared rollup/effect completion.
- `src/audio.ts`: cached metallic reel-landing sound and browser audio activation.
- `src/reels.css`, `assets/reel-frame.svg`, and `assets/reel-background.svg`: stationary reel chrome, separator overlay, and shared background.
- `src/dialogs.ts`: modal focus containment and background isolation.
- `src/main.ts`: interface wiring, currency formatting, and session flow.

## Demo integrity and hosting

- Natural outcomes use `crypto.getRandomValues`; the fixed reel strips, paytable and 92% theoretical RTP are unchanged.
- An origin-wide Web Lock is acquired before loading player data and held for the page lifetime. A second tab shows a close-other-tab message and a retry button. Browsers without Web Locks fail closed. HTTPS (or localhost) and a current browser are required. Returning from the browser back/forward cache reloads instead of reusing an unlocked, stale session.
- Netlify build settings are in `netlify.toml`. `security-headers.json` is the single policy source: the build emits `dist/_headers`, and the production preview applies the same headers. They restrict scripts to the same origin, prohibit plugins and framing, prevent MIME sniffing, restrict referrers, and disable unused sensitive browser permissions. Inline styles remain permitted because the game sets animation and layout styles dynamically; inline scripts and eval are not permitted.
- Player IDs select local profiles and are not authentication. Demo credits remain editable by the browser owner. Replay codes are unsigned, labelled unverified, and balance-neutral; their checksum detects typos, not fraud. These deliberate demo limits require server-authoritative accounts, records and balances if the product ever supports anything of monetary value.

This is a client-only demo with virtual credits and no backend or payment integration.
