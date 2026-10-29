export const SYMBOLS = ["Pic1", "Pic2", "Pic3", "Pic4", "Pic5", "Scatter", "King", "Queen", "Jack", "Ace", "Ten"] as const;
export type SymbolName = typeof SYMBOLS[number];
export const REEL_STRIP: readonly number[] = [1, 7, 4, 9, 3, 4, 8, 9, 8, 8, 6, 1, 1, 2, 8, 2, 6, 4, 3, 9, 9, 2, 4, 1, 0, 6, 3, 0, 2, 3, 2, 10, 8, 4, 0, 1, 6, 5, 7, 9, 8, 1, 0, 0, 5, 3, 0, 10, 0, 3, 7, 8, 6, 0, 8, 2, 7, 4, 5, 7, 8, 6, 5, 0, 3, 0, 3, 10, 9, 4, 7, 2, 9, 4, 10, 3, 10, 5, 10, 5, 1, 10, 7, 5, 2, 5, 0, 5, 8, 9, 5, 9, 6, 7, 6, 5, 4, 6, 1, 1, 4, 10, 7, 5, 8, 6, 1, 3, 2, 4, 7, 10, 9, 10, 2, 5, 8, 1, 10, 6, 9, 2, 7, 7, 1, 6, 10, 4, 0, 3, 0, 9, 3, 2, 6, 7, 1, 2, 3, 4];
export const REEL_STRIP_LENGTH = REEL_STRIP.length;
export const REEL_STRIPS: readonly (readonly number[])[] = Array.from({ length: 5 }, () => REEL_STRIP);
