# Orrery — a NASA data audiovisual instrument

Real solar-system and exoplanet data, played as a coupled audiovisual piece in the
browser:

- **Fireballs → percussion.** Every hit is a real atmospheric impact from NASA/JPL's
  CNEOS fireball catalog, flashed on a 3D Earth at its reported coordinates the exact
  moment its sound starts. Impact energy sets loudness and boom depth, entry velocity
  sets filter brightness, burst altitude sets reverb, and longitude sets stereo pan.
- **Exoplanets → drones.** An ambient bed drawn from the NASA Exoplanet Archive.
  Equilibrium temperature sets pitch (quantized to a just-intonation pentatonic scale
  so the bed stays consonant), planet radius sets timbre and octave, and orbital
  period sets the tremolo rate. Up to 12 voices sound at once and slowly rotate
  through the catalog.

Sound and light share one clock: impact audio is scheduled on the `AudioContext`
timeline and each visual flash fires when that timestamp arrives, while analyser taps
on the impact and drone buses drive the globe's pulse, the glow rim, and the
starfield's shimmer — the visuals ride the mix like a visualizer.

## The synth

All synthesis is raw Web Audio — no samples, no audio libraries. A control panel
exposes real synthesizer parameters:

- **Impact synth** (percussive one-shots): tune, filter brightness, resonance (Q),
  noise punch, decay length. Each voice is a pitch-swept sine boom + triangle body +
  noise crack through a resonant low-pass, pooled at 24 voices with oldest-steal.
- **Drone synth** (sustained voices): root frequency, detune, filter cutoff,
  resonance, tremolo depth, attack, release.
- **Space**: a generated-impulse convolution reverb ("hull size") and a filtered
  ping-pong delay ("corridor echo") for that station-interior character.
- **Transport**: play/pause, playback speed (real years per second), timeline scrub,
  and a minimum-energy threshold for which blasts get heard.

## Visuals

Three.js, three switchable globe modes — realistic (NASA Blue Marble texture),
wireframe, and a fresnel-rim glow shader — plus pooled impact-flash FX and an
exoplanet starfield colored by temperature and sized by radius. Flash markers and the
starfield render identically in every mode. `prefers-reduced-motion` (and a manual
toggle) damps camera drift and softens flashes without touching the audio.

## Running it

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build
```

Next.js App Router + TypeScript. Dependencies are just `next`, `react`, `react-dom`,
and `three`.

## Data plumbing

The browser never calls NASA services directly. JPL's SSD/CNEOS API forbids embedding
the API in a page and sends no CORS headers, so two server routes act as the API
client:

- `/api/fireballs` → JPL fireball API (`req-loc`, `req-vel`, 400 most recent events)
- `/api/exoplanets` → NASA Exoplanet Archive TAP (`pscomppars`, ADQL `top 800`)

Both routes cache upstream responses for an hour, serialize upstream calls (JPL asks
for one request at a time), verify the payload's `signature.version` against the
version the field mapping was written for, and on any upstream failure fall back to
committed snapshots in `lib/fallback/` with an `x-data-source: fallback` header (the
UI shows a subtle "offline snapshot" note).

> **Note on the committed snapshots:** this repository was assembled in a sandbox
> that could not reach the NASA services, so `lib/fallback/*.json` currently contain
> *synthetic placeholder data* that exactly matches the real payload shapes and
> realistic statistical distributions (planet names are prefixed `Simulated-`).
> On a normal network the app plays live data and never touches them. To replace
> them with real snapshots, run:
>
> ```bash
> npm run refresh-snapshots
> ```

## Data credits

Fireball data: NASA/JPL-Caltech CNEOS. Exoplanet data: NASA Exoplanet Archive.

> This research has made use of the NASA Exoplanet Archive, which is operated by the
> California Institute of Technology, under contract with the National Aeronautics
> and Space Administration under the Exoplanet Exploration Program.

The bundled Earth texture (`public/earth.jpg`) is NASA Blue Marble imagery (NASA
Visible Earth), which is in the public domain.
