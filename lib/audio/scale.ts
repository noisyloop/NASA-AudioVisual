// Pitch quantization: a just-intonation pentatonic set spanning 4 octaves.
// Every drone snaps to this lattice so the bed stays consonant no matter
// which planets are sounding together.

// 1 : 9/8 : 5/4 : 3/2 : 5/3 — a just major pentatonic.
const RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
const OCTAVES = 4;

/** Full ascending frequency set built on `root` Hz. */
export function buildScale(root: number): number[] {
  const freqs: number[] = [];
  for (let oct = 0; oct < OCTAVES; oct++) {
    for (const r of RATIOS) freqs.push(root * r * 2 ** oct);
  }
  return freqs;
}

/** Snap an arbitrary frequency to the nearest scale degree (log distance). */
export function quantize(freq: number, scale: number[]): number {
  let best = scale[0];
  let bestDist = Infinity;
  for (const f of scale) {
    const d = Math.abs(Math.log2(freq / f));
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

/** Linear map with clamping — used by every data→sound mapping. */
export function map(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = Math.min(Math.max((v - inMin) / (inMax - inMin), 0), 1);
  return outMin + t * (outMax - outMin);
}
