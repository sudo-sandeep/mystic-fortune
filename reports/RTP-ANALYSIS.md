# Mystic Fortune RTP analysis

The current fixed paytable has **exactly 92% theoretical RTP** at all nine supported wagers. The game engine runs in the browser; this project has no server backend. RTP means total awards divided by total stakes, including losing spins.

| Configuration | Theoretical RTP | Observed RTP, 1 billion spins |
| --- | ---: | ---: |
| Previous paytable | 3.009829944368418% | 3.009895858% |
| Current paytable | 92% | 92.002354288% |

The same one billion natural outcomes were evaluated with both paytables. The current return per 100 wagered averaged **92.002354288**, against a theoretical expectation of **92**. The observed 95% confidence interval is 91.9824735945%–92.0222349815%. The observed paying-spin rate is 12.0464238%; a high RTP is different from a high win frequency.

## Fixed awards

| Consecutive matching reels, from the left | Award per winning line, as a multiple of the total bet |
| --- | ---: |
| 3 | 3.62× |
| 4 | 11.14× |
| 5 | 26.82× |

All 25 supplied payline paths remain unchanged. Every symbol uses this table. All simultaneously winning lines are paid. No outcome is changed in response to a player's balance, wins, losses, ID, or observed RTP. Old replay IDs retain their recorded original awards; replaying them does not alter the balance. Developer forcers are excluded from natural RTP.

## Exact calculation

Each independent reel has 140 uniformly selected stops. Eight symbols occur 13 times per reel and three symbols occur 12 times. Every visible row is a circular shift of the strip, so its marginal symbol probabilities are identical. There are 140⁵ = **53,782,400,000** equally likely stop combinations.

For any one payline, the numbers of stop combinations producing exactly 3, exactly 4 and exactly 5 initial matching symbols are:

- 3: **405,398,560** (the fourth symbol must differ; the fifth is unrestricted).
- 4: **36,980,600** (the fifth symbol must differ).
- 5: **3,716,840**.

At a unit bet, the line awards in cents are 362, 1114 and 2682. Therefore:

```text
RTP = 25 × (405398560 × 362 + 36980600 × 1114 + 3716840 × 2682)
      / (53782400000 × 100)
    = 23 / 25
    = 92%
```

This uses linearity of expectation: overlapping lines are correlated, but each line's expected award still contributes to the total. Integer-cent rounding is included. The supported wagers are all integer multiples of the unit bet, so the same exact ratio applies to each.

## Simulation and validation

The recorded run used 4 Node.js worker threads and completed in 46.295451 seconds. It simulated **1,000,000,000** independent natural outcomes, using the production `Math.random`/floor mapping to reel stops. An optimized prefix table skips non-winning paths; it was checked against `createBoard` and `scoreBoard` for 10,000 generated outcomes, including all supported bets on a subset. It does not allocate UI animations or round IDs and does not stop when a finite bankroll runs out.

The unit tests independently compare the analytical formula with exhaustive scoring on short, unequal reel strips, verify exact 23/25 return at every supported wager, test settlement accounting and preserve legacy replay awards.

Reproduce from the project directory:

```sh
npm test
npm run build
npm run audit:rtp -- --spins 1000000000 --workers 4 --output reports/rtp-1billion.json
```

The simulation uses random draws, so a rerun will have different observed results. Exactly 92% is the configured mathematical expectation, not a forced return for a finite sample or an individual player. The complete machine-readable results are in `rtp-1billion.json`.
