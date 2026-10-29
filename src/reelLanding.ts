export const NORMAL_LANDING_MS = 380;
export const SLAM_LANDING_MS = 650;
export const SPIN_CYCLE_SLOTS = 12;

/** Preserve the visible fractional row and join normal braking at the current spin speed. */
export function reelLandingPlan(currentY: number, slotHeight: number, slammed: boolean, spinDurationMs = 850) {
  if (!Number.isFinite(currentY) || !Number.isFinite(slotHeight) || slotHeight <= 0
    || !Number.isFinite(spinDurationMs) || spinDurationMs <= 0) throw new RangeError('Invalid reel landing geometry.');
  const position = Math.max(0, -currentY / slotHeight);
  const firstVisible = Math.floor(position);
  const fractional = position - firstVisible;
  const leadRows = slammed ? 4 : 3;
  const distance = leadRows + fractional;
  const duration = slammed ? SLAM_LANDING_MS : NORMAL_LANDING_MS;
  const startSlope = SPIN_CYCLE_SLOTS * duration / (spinDurationMs * distance);
  const controlY = Math.min(.95, .28 * startSlope);
  return {
    firstVisible, leadRows, fromY: -distance * slotHeight, duration,
    easing: slammed ? 'cubic-bezier(.26,.55,.30,1)' : `cubic-bezier(.28,${controlY},.58,1)`,
  };
}
