import type { Exoplanet } from "./types";

export interface TapRow {
  pl_name?: string | null;
  pl_orbper?: number | null;
  pl_rade?: number | null;
  pl_eqt?: number | null;
  st_teff?: number | null;
}

/**
 * Fill a missing equilibrium temperature from the host star: assume a roughly
 * solar-sized star and Kepler's third law for the semi-major axis, then
 * T_eq = T_star * sqrt(R_star / 2a). Crude, but it keeps the pitch mapping
 * physical instead of defaulting everything to one note.
 */
function deriveEqt(teff: number | null, orbperDays: number): number {
  if (teff == null || teff <= 0) return 700; // default when the star is unknown
  const aAu = Math.pow(orbperDays / 365.25, 2 / 3);
  const eqt = (teff * 0.0482) / Math.sqrt(Math.max(aAu, 0.005));
  return Math.min(Math.max(eqt, 60), 3200);
}

export function normalizeExoplanets(rows: TapRow[]): Exoplanet[] {
  if (!Array.isArray(rows)) return [];
  const out: Exoplanet[] = [];
  for (const r of rows) {
    const orbper = typeof r.pl_orbper === "number" ? r.pl_orbper : null;
    const rade = typeof r.pl_rade === "number" ? r.pl_rade : null;
    if (!r.pl_name || orbper == null || orbper <= 0 || rade == null || rade <= 0) continue;
    const teff = typeof r.st_teff === "number" ? r.st_teff : null;
    const eqt = typeof r.pl_eqt === "number" && r.pl_eqt > 0 ? r.pl_eqt : deriveEqt(teff, orbper);
    out.push({ name: r.pl_name, orbper, rade, eqt, teff });
  }
  return out;
}
