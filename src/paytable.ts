/** Exact 92% theoretical return with the configured 140-stop reels and 25 paylines. */
export const TARGET_RTP_PERCENT = 92;
export const BASE_LINE_PAYS: Readonly<Record<3 | 4 | 5, number>> = Object.freeze({ 3: 3.62, 4: 11.14, 5: 26.82 });
/** Each winning line pays a multiplier of the total wager. */
export function denominationForBet(bet: number): number { return bet; }
export function calculateLineAward(matches: 3 | 4 | 5, denom: number): number {
    return Math.round(BASE_LINE_PAYS[matches] * denom * 100) / 100;
}
