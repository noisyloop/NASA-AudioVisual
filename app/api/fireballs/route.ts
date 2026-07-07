import { NextResponse } from "next/server";
import fallback from "@/lib/fallback/fireballs.json";
import { EXPECTED_FIREBALL_VERSION } from "@/lib/data/fireballs";

// JPL SSD/CNEOS forbids embedding the API in a page and sends no CORS
// headers, so this route is the API client — the browser only ever talks to
// us. Cached for an hour so we rarely hit upstream at all.
const UPSTREAM =
  "https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true&req-vel=true&limit=400&sort=-date";

// JPL fair use asks for one request at a time: chain every upstream call on a
// module-level promise so a single server instance never fans out.
let upstreamQueue: Promise<unknown> = Promise.resolve();

function serializedFetch(): Promise<unknown> {
  const next = upstreamQueue
    .catch(() => undefined) // a previous failure must not poison the chain
    .then(async () => {
      const res = await fetch(UPSTREAM, { next: { revalidate: 3600 } });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return res.json();
    });
  upstreamQueue = next.catch(() => undefined);
  return next;
}

export async function GET() {
  try {
    const payload = (await serializedFetch()) as { signature?: { version?: string } };
    const version = payload?.signature?.version;
    if (version !== EXPECTED_FIREBALL_VERSION) {
      console.warn(
        `fireball.api version changed: got ${version}, expected ${EXPECTED_FIREBALL_VERSION}`,
      );
    }
    return NextResponse.json(payload, {
      headers: {
        "x-data-source": "live",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    // Never throw to the client — serve the committed snapshot instead.
    console.warn("fireballs upstream failed, serving snapshot:", err);
    return NextResponse.json(fallback, {
      headers: { "x-data-source": "fallback", "Cache-Control": "public, s-maxage=300" },
    });
  }
}
