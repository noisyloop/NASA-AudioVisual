import { NextResponse } from "next/server";
import fallback from "@/lib/fallback/exoplanets.json";

// ADQL uses `top N` (not `limit`); pscomppars has one composite row per
// planet, avoiding the duplicate rows the `ps` table returns.
const ADQL =
  "select top 800 pl_name,pl_orbper,pl_rade,pl_eqt,st_teff " +
  "from pscomppars where pl_orbper is not null and pl_rade is not null";
const UPSTREAM =
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=" +
  encodeURIComponent(ADQL) +
  "&format=json";

// Serialize upstream calls (same courtesy as the fireball route).
let upstreamQueue: Promise<unknown> = Promise.resolve();

function serializedFetch(): Promise<unknown> {
  const next = upstreamQueue
    .catch(() => undefined)
    .then(async () => {
      const res = await fetch(UPSTREAM, { next: { revalidate: 3600 } });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error("unexpected TAP response shape");
      return rows;
    });
  upstreamQueue = next.catch(() => undefined);
  return next;
}

export async function GET() {
  try {
    const rows = await serializedFetch();
    return NextResponse.json(rows, {
      headers: {
        "x-data-source": "live",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.warn("exoplanets upstream failed, serving snapshot:", err);
    return NextResponse.json(fallback, {
      headers: { "x-data-source": "fallback", "Cache-Control": "public, s-maxage=300" },
    });
  }
}
