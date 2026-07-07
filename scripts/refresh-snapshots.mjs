// Refetch the committed fallback snapshots from the live NASA services.
// Run on a network that can reach ssd-api.jpl.nasa.gov and
// exoplanetarchive.ipac.caltech.edu:  npm run refresh-snapshots
//
// Requests are made one at a time, per JPL fair-use guidance.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), "lib", "fallback");

const FIREBALLS =
  "https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true&req-vel=true&limit=400&sort=-date";

const ADQL =
  "select top 800 pl_name,pl_orbper,pl_rade,pl_eqt,st_teff " +
  "from pscomppars where pl_orbper is not null and pl_rade is not null";
const EXOPLANETS =
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=" +
  encodeURIComponent(ADQL) +
  "&format=json";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

await mkdir(outDir, { recursive: true });

const fireballs = await fetchJson(FIREBALLS);
if (fireballs?.signature?.version !== "1.2") {
  console.warn(
    `warning: fireball.api signature.version is ${fireballs?.signature?.version}, ` +
      "the app's mapping was written against 1.2",
  );
}
await writeFile(path.join(outDir, "fireballs.json"), JSON.stringify(fireballs, null, 1));
console.log(`fireballs.json: ${fireballs?.count ?? "?"} events`);

const exoplanets = await fetchJson(EXOPLANETS);
if (!Array.isArray(exoplanets)) throw new Error("unexpected TAP response shape");
await writeFile(path.join(outDir, "exoplanets.json"), JSON.stringify(exoplanets, null, 1));
console.log(`exoplanets.json: ${exoplanets.length} planets`);
