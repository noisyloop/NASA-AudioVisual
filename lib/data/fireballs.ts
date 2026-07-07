import type { Fireball } from "./types";

// The signature version this mapping was written against. If JPL bumps it the
// field layout may have changed — we log loudly but still try to parse.
export const EXPECTED_FIREBALL_VERSION = "1.2";

export interface FireballPayload {
  signature?: { source?: string; version?: string };
  count?: string | number;
  fields?: string[];
  data?: (string | null)[][];
}

function num(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a raw fireball.api payload into typed rows. Columns are resolved
 * by NAME via the `fields` array — never by position, since the layout
 * depends on query params.
 */
export function normalizeFireballs(payload: FireballPayload): Fireball[] {
  const version = payload?.signature?.version;
  if (version !== EXPECTED_FIREBALL_VERSION) {
    console.warn(
      `fireball.api signature.version is ${version ?? "missing"}, ` +
        `mapping was written against ${EXPECTED_FIREBALL_VERSION} — field layout may have changed`,
    );
  }
  const fields = payload?.fields;
  const data = payload?.data;
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];

  const idx: Record<string, number> = {};
  fields.forEach((name, i) => (idx[name] = i));
  const col = (row: (string | null)[], name: string) =>
    idx[name] === undefined ? null : row[idx[name]];

  const out: Fireball[] = [];
  for (const row of data) {
    const dateStr = col(row, "date");
    const impactE = num(col(row, "impact-e"));
    const lat = num(col(row, "lat"));
    const lon = num(col(row, "lon"));
    if (!dateStr || impactE == null || lat == null || lon == null) continue;
    const time = Date.parse(dateStr.replace(" ", "T") + "Z"); // API times are UTC
    if (!Number.isFinite(time)) continue;
    const latDir = col(row, "lat-dir");
    const lonDir = col(row, "lon-dir");
    out.push({
      time,
      dateStr,
      energy: num(col(row, "energy")) ?? 1,
      impactE,
      lat: latDir === "S" ? -lat : lat,
      lon: lonDir === "W" ? -lon : lon,
      alt: num(col(row, "alt")),
      vel: num(col(row, "vel")),
    });
  }
  // Ascending by time — the transport maps this span onto a loopable playhead.
  out.sort((a, b) => a.time - b.time);
  return out;
}
