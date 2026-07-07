// Shared typed shapes for normalized NASA data.

export interface Fireball {
  /** Peak-brightness timestamp, ms since epoch (UTC). */
  time: number;
  dateStr: string;
  /** Total radiated energy, units of 1e10 J. */
  energy: number;
  /** Total impact energy, kt TNT. Guaranteed present. */
  impactE: number;
  /** Signed degrees: N/E positive, S/W negative. */
  lat: number;
  lon: number;
  /** km; null when not reported. */
  alt: number | null;
  /** km/s; null when not reported. */
  vel: number | null;
}

export interface Exoplanet {
  name: string;
  /** Orbital period, days. */
  orbper: number;
  /** Planet radius, Earth radii. */
  rade: number;
  /** Equilibrium temperature, K — always resolved (archive value, derived from
   * the host star, or a default). */
  eqt: number;
  /** Host star effective temperature, K; null when not reported. */
  teff: number | null;
}

export interface DataMeta {
  /** True when the payload came from the committed offline snapshot. */
  fallback: boolean;
}
