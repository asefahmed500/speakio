/**
 * IELTS band utilities shared by auto-graders and certificate issuance.
 */

/** Official-style academic raw-score (out of 40) to band mapping. */
const RAW_40_TO_BAND: Array<[number, number]> = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [32, 7.5],
  [29, 7.0],
  [26, 6.5],
  [22, 6.0],
  [18, 5.5],
  [14, 5.0],
  [12, 4.5],
  [9, 4.0],
  [7, 3.5],
  [5, 3.0],
  [3, 2.5],
];

/** Converts a raw score out of `total` into an approximate IELTS band (0.5 steps). */
export function rawToBand(correct: number, total: number): number {
  if (total <= 0) return 0;
  const scaled = Math.round((correct / total) * 40);
  for (const [threshold, band] of RAW_40_TO_BAND) {
    if (scaled >= threshold) return band;
  }
  return 2.0;
}

/** Rounds to the nearest 0.5 band, clamped to [0, 9]. */
export function roundToBand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(9, Math.max(0, value));
  return Math.round(clamped * 2) / 2;
}

/** IELTS overall band: mean of the four skills rounded to nearest 0.5. */
export function overallBandOf(bands: number[]): number {
  if (bands.length === 0) return 0;
  const avg = bands.reduce((acc, v) => acc + v, 0) / bands.length;
  return roundToBand(avg);
}

/** Validates a band value: 0–9 in 0.5 increments. */
export function isValidBand(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 9 &&
    (value * 2) % 1 === 0
  );
}

/** Clamps an arbitrary number to a valid band on the 0.5 grid. */
export function clampToBand(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return roundToBand(num);
}
