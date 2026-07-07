"use client";

// The whole instrument: Three.js canvas + transport + synth control panel.
//
// Sync design: the transport schedules each fireball's audio a fixed
// SYNC_AHEAD into the future on the AudioContext clock, and queues the
// matching visual flash stamped with that same audio time. The render loop
// (scene frame callback) pops flashes only when ctx.currentTime reaches their
// stamp, and feeds live analyser levels back into the visuals — so light and
// sound stay locked to one clock, like a visualizer riding the mix.

import { useCallback, useEffect, useRef, useState } from "react";
import { createEngine, type Engine, type AudioLevels } from "@/lib/audio/engine";
import { ImpactSynth, defaultImpactSettings } from "@/lib/audio/impacts";
import { DroneBed, defaultDroneSettings } from "@/lib/audio/drones";
import { createScene, type SceneHandle } from "@/lib/visual/scene";
import type { GlobeMode } from "@/lib/visual/globe";
import { normalizeFireballs, type FireballPayload } from "@/lib/data/fireballs";
import { normalizeExoplanets, type TapRow } from "@/lib/data/exoplanets";
import type { Fireball, Exoplanet } from "@/lib/data/types";

const SYNC_AHEAD = 0.06; // seconds of audio-clock lookahead for AV lock
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const ZERO_LEVELS: AudioLevels = { master: 0, impacts: 0, drones: 0 };

interface Transport {
  playing: boolean;
  speed: number; // real years per second of playback
  thresholdKt: number;
  impactsOn: boolean;
  dronesOn: boolean;
}

function fmtKt(v: number): string {
  return v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
}

/** Small labelled slider — the panel's "knob". */
function Knob(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="knob">
      <label>
        <span>{props.label}</span>
        <span className="value">{props.display}</span>
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function Instrument() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const impactsRef = useRef<ImpactSynth | null>(null);
  const dronesRef = useRef<DroneBed | null>(null);

  const fireballsRef = useRef<Fireball[]>([]);
  const planetsRef = useRef<Exoplanet[]>([]);
  const playheadRef = useRef(0); // ms since epoch, within the fireball span
  const nextIdxRef = useRef(0); // index of the next fireball to fire
  const visualQueueRef = useRef<{ at: number; fb: Fireball }[]>([]);
  const transportRef = useRef<Transport>({
    playing: true,
    speed: 2,
    thresholdKt: 0.7,
    impactsOn: true,
    dronesOn: true,
  });

  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [usingSnapshot, setUsingSnapshot] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [scrub, setScrub] = useState(0); // 0..1 across the fireball span
  const [playheadLabel, setPlayheadLabel] = useState("");
  // 0..100 log-mapped over 0.05..500 kt; 29 ≈ 0.7 kt. The catalog averages
  // ~35 fireballs/year, so an open threshold at 2 yr/s would be ~60 hits/s —
  // this default keeps the percussion articulate, and turning it down gives
  // the full micro-impact rain.
  const [thresholdStep, setThresholdStep] = useState(29);
  const [masterVol, setMasterVol] = useState(0.8);
  const [impactsVol, setImpactsVol] = useState(0.9);
  const [dronesVol, setDronesVol] = useState(0.7);
  const [reverb, setReverb] = useState(0.6);
  const [echo, setEcho] = useState(0.12);
  const [impactsOn, setImpactsOn] = useState(true);
  const [dronesOn, setDronesOn] = useState(true);
  const [globeMode, setGlobeMode] = useState<GlobeMode>("glow");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [impactKnobs, setImpactKnobs] = useState({ ...defaultImpactSettings });
  const [droneKnobs, setDroneKnobs] = useState({ ...defaultDroneSettings });

  // Threshold slider is log-mapped over 0.05..500 kt.
  const thresholdKt = 0.05 * Math.pow(500 / 0.05, thresholdStep / 100);

  const span = useCallback(() => {
    const fbs = fireballsRef.current;
    if (fbs.length < 2) return { t0: 0, t1: 1 };
    return { t0: fbs[0].time, t1: fbs[fbs.length - 1].time };
  }, []);

  // ---------- data ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // The browser only ever calls our own /api routes — JPL's API forbids
      // client-side embedding and sends no CORS headers.
      const [fbRes, exoRes] = await Promise.all([
        fetch("/api/fireballs"),
        fetch("/api/exoplanets"),
      ]);
      const fbPayload = (await fbRes.json()) as FireballPayload;
      const exoRows = (await exoRes.json()) as TapRow[];
      if (cancelled) return;
      const fromSnapshot =
        fbRes.headers.get("x-data-source") === "fallback" ||
        exoRes.headers.get("x-data-source") === "fallback";
      fireballsRef.current = normalizeFireballs(fbPayload);
      planetsRef.current = normalizeExoplanets(exoRows);
      playheadRef.current = fireballsRef.current[0]?.time ?? 0;
      nextIdxRef.current = 0;
      setUsingSnapshot(fromSnapshot);
      sceneRef.current?.setPlanets(planetsRef.current);
      dronesRef.current?.setPlanets(planetsRef.current);
      setLoaded(true);
    }
    load().catch((err) => console.error("data load failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- scene ----------
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = createScene(canvasRef.current);
    sceneRef.current = scene;
    if (planetsRef.current.length) scene.setPlanets(planetsRef.current);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMedia = () => {
      setReducedMotion(media.matches);
      scene.setReducedMotion(media.matches);
    };
    applyMedia();
    media.addEventListener("change", applyMedia);

    return () => {
      media.removeEventListener("change", applyMedia);
      scene.dispose();
      sceneRef.current = null;
      dronesRef.current?.dispose();
      engineRef.current?.dispose();
    };
  }, []);

  // ---------- transport core, driven from the scene's render loop ----------
  const frameCallback = useCallback(
    (dt: number): AudioLevels => {
      const engine = engineRef.current;
      const scene = sceneRef.current;
      if (!engine || !scene) return ZERO_LEVELS;

      const t = transportRef.current;
      const fbs = fireballsRef.current;
      const queue = visualQueueRef.current;

      if (t.playing && fbs.length > 1) {
        const { t0, t1 } = span();
        let head = playheadRef.current + dt * t.speed * MS_PER_YEAR;

        const fire = (fb: Fireball) => {
          if (!t.impactsOn || fb.impactE < t.thresholdKt) return;
          const at = engine.ctx.currentTime + SYNC_AHEAD;
          impactsRef.current?.trigger(fb, at);
          queue.push({ at, fb });
        };

        while (nextIdxRef.current < fbs.length && fbs[nextIdxRef.current].time <= head) {
          fire(fbs[nextIdxRef.current]);
          nextIdxRef.current++;
        }
        if (head > t1) {
          // Seamless loop: wrap the overflow back onto the start of the span.
          head = t0 + ((head - t0) % (t1 - t0));
          nextIdxRef.current = 0;
          while (nextIdxRef.current < fbs.length && fbs[nextIdxRef.current].time <= head) {
            // Don't re-fire everything on wrap; just advance the pointer.
            nextIdxRef.current++;
          }
        }
        playheadRef.current = head;
      }

      // Pop flashes whose audio start time has arrived — this is the sync.
      const now = engine.ctx.currentTime;
      while (queue.length && queue[0].at <= now) {
        const { fb } = queue.shift()!;
        scene.spawnImpact(fb.lat, fb.lon, fb.impactE, fb.vel);
      }

      return engine.getLevels();
    },
    [span],
  );

  // ---------- start gesture (autoplay policy: nothing sounds before this) ----------
  const handleStart = useCallback(() => {
    if (started) return;
    const engine = createEngine();
    void engine.ctx.resume(); // created inside the gesture, but be explicit
    engineRef.current = engine;
    impactsRef.current = new ImpactSynth(engine);
    const drones = new DroneBed(engine);
    drones.setPlanets(planetsRef.current);
    dronesRef.current = drones;
    if (transportRef.current.dronesOn) drones.start();

    const scene = sceneRef.current;
    scene?.setFrameCallback(frameCallback);
    scene?.start();
    setStarted(true);
  }, [started, frameCallback]);

  // ---------- push UI state down into the audio/visual modules ----------
  useEffect(() => {
    transportRef.current = { playing, speed, thresholdKt, impactsOn, dronesOn };
  }, [playing, speed, thresholdKt, impactsOn, dronesOn]);

  useEffect(() => {
    engineRef.current?.setMasterVolume(masterVol);
  }, [masterVol, started]);
  useEffect(() => {
    engineRef.current?.setImpactsVolume(impactsVol);
  }, [impactsVol, started]);
  useEffect(() => {
    engineRef.current?.setDronesVolume(dronesVol);
  }, [dronesVol, started]);
  useEffect(() => {
    engineRef.current?.setReverbLevel(reverb);
  }, [reverb, started]);
  useEffect(() => {
    engineRef.current?.setEchoLevel(echo);
  }, [echo, started]);

  useEffect(() => {
    if (impactsRef.current) impactsRef.current.settings = { ...impactKnobs };
  }, [impactKnobs, started]);

  useEffect(() => {
    const d = dronesRef.current;
    if (d) {
      d.settings = { ...droneKnobs };
      d.applySettings();
    }
  }, [droneKnobs, started]);

  useEffect(() => {
    const d = dronesRef.current;
    if (!d || !started) return;
    if (dronesOn) d.start();
    else d.stop();
  }, [dronesOn, started]);

  useEffect(() => {
    sceneRef.current?.setGlobeMode(globeMode);
  }, [globeMode]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // Slow UI pulse: playhead label, scrub position, active-drone halos.
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      const { t0, t1 } = span();
      const head = playheadRef.current;
      setScrub((head - t0) / Math.max(t1 - t0, 1));
      setPlayheadLabel(new Date(head).toISOString().slice(0, 10));
      sceneRef.current?.setActivePlanets(dronesRef.current?.activeNames() ?? []);
    }, 300);
    return () => window.clearInterval(id);
  }, [started, span]);

  const handleScrub = useCallback(
    (v: number) => {
      const { t0, t1 } = span();
      const head = t0 + v * (t1 - t0);
      playheadRef.current = head;
      const fbs = fireballsRef.current;
      let i = 0;
      while (i < fbs.length && fbs[i].time <= head) i++;
      nextIdxRef.current = i;
      visualQueueRef.current = []; // drop pending flashes from the old position
      setScrub(v);
      setPlayheadLabel(new Date(head).toISOString().slice(0, 10));
    },
    [span],
  );

  return (
    <div className="stage">
      <canvas ref={canvasRef} aria-label="Orrery visualization" />

      {!started && (
        <button className="start-overlay" onClick={handleStart} disabled={!loaded}>
          <h1>Orrery</h1>
          <p>
            A solar-system instrument. Fireball impacts strike a drum synth on a spinning
            Earth; distant exoplanets hold a drone chord that slowly rotates through the
            catalog. Sound and light share one clock.
          </p>
          <span className="begin">{loaded ? "Tap to begin" : "Loading data…"}</span>
        </button>
      )}

      <button
        className="btn panel-toggle"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((v) => !v)}
      >
        {panelOpen ? "Close controls" : "Controls"}
      </button>

      <div className={`panel ${panelOpen ? "open" : ""}`}>
        <h2>Orrery</h2>
        <p className="sub">fireballs → percussion · exoplanets → drones</p>
        {usingSnapshot && <span className="badge">offline snapshot</span>}

        <fieldset className="section">
          <legend>Transport</legend>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => setPlaying((v) => !v)}
              aria-pressed={playing}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span className="value">{playheadLabel || "—"}</span>
          </div>
          <Knob
            label="Playback speed"
            min={0.5}
            max={20}
            step={0.5}
            value={speed}
            display={`${speed} yr/s`}
            onChange={setSpeed}
          />
          <Knob
            label="Timeline"
            min={0}
            max={1}
            step={0.001}
            value={scrub}
            display={playheadLabel || "—"}
            onChange={handleScrub}
          />
          <Knob
            label="Smallest blast heard"
            min={0}
            max={100}
            step={1}
            value={thresholdStep}
            display={`${fmtKt(thresholdKt)} kt`}
            onChange={setThresholdStep}
          />
        </fieldset>

        <fieldset className="section">
          <legend>Layers</legend>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={impactsOn}
                onChange={(e) => setImpactsOn(e.target.checked)}
              />
              Impacts (percussion)
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={dronesOn}
                onChange={(e) => setDronesOn(e.target.checked)}
              />
              Drones (ambient bed)
            </label>
          </div>
        </fieldset>

        <fieldset className="section">
          <legend>Mixer</legend>
          <Knob label="Master volume" min={0} max={1} step={0.01} value={masterVol}
            display={masterVol.toFixed(2)} onChange={setMasterVol} />
          <Knob label="Impacts volume" min={0} max={1.2} step={0.01} value={impactsVol}
            display={impactsVol.toFixed(2)} onChange={setImpactsVol} />
          <Knob label="Drones volume" min={0} max={1.2} step={0.01} value={dronesVol}
            display={dronesVol.toFixed(2)} onChange={setDronesVol} />
        </fieldset>

        <fieldset className="section">
          <legend>Impact synth</legend>
          <Knob label="Tune (boom pitch)" min={-12} max={12} step={1} value={impactKnobs.tune}
            display={`${impactKnobs.tune > 0 ? "+" : ""}${impactKnobs.tune} st`}
            onChange={(v) => setImpactKnobs((s) => ({ ...s, tune: v }))} />
          <Knob label="Brightness (cutoff)" min={0.25} max={4} step={0.05} value={impactKnobs.brightness}
            display={`×${impactKnobs.brightness.toFixed(2)}`}
            onChange={(v) => setImpactKnobs((s) => ({ ...s, brightness: v }))} />
          <Knob label="Resonance" min={0.5} max={12} step={0.1} value={impactKnobs.resonance}
            display={`Q ${impactKnobs.resonance.toFixed(1)}`}
            onChange={(v) => setImpactKnobs((s) => ({ ...s, resonance: v }))} />
          <Knob label="Punch (noise crack)" min={0} max={1} step={0.01} value={impactKnobs.punch}
            display={impactKnobs.punch.toFixed(2)}
            onChange={(v) => setImpactKnobs((s) => ({ ...s, punch: v }))} />
          <Knob label="Decay length" min={0.4} max={2.5} step={0.05} value={impactKnobs.decay}
            display={`×${impactKnobs.decay.toFixed(2)}`}
            onChange={(v) => setImpactKnobs((s) => ({ ...s, decay: v }))} />
        </fieldset>

        <fieldset className="section">
          <legend>Drone synth</legend>
          <Knob label="Frequency (root)" min={40} max={120} step={1} value={droneKnobs.rootHz}
            display={`${droneKnobs.rootHz} Hz`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, rootHz: v }))} />
          <Knob label="Detune (beating)" min={0} max={30} step={0.5} value={droneKnobs.detune}
            display={`${droneKnobs.detune.toFixed(1)} ¢`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, detune: v }))} />
          <Knob label="Filter cutoff" min={200} max={6000} step={10} value={droneKnobs.cutoff}
            display={`${Math.round(droneKnobs.cutoff)} Hz`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, cutoff: v }))} />
          <Knob label="Resonance" min={0.3} max={10} step={0.1} value={droneKnobs.resonance}
            display={`Q ${droneKnobs.resonance.toFixed(1)}`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, resonance: v }))} />
          <Knob label="Shimmer (tremolo)" min={0} max={1} step={0.01} value={droneKnobs.shimmer}
            display={droneKnobs.shimmer.toFixed(2)}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, shimmer: v }))} />
          <Knob label="Attack (fade-in)" min={0.5} max={8} step={0.1} value={droneKnobs.attack}
            display={`${droneKnobs.attack.toFixed(1)} s`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, attack: v }))} />
          <Knob label="Release (fade-out)" min={1} max={10} step={0.1} value={droneKnobs.release}
            display={`${droneKnobs.release.toFixed(1)} s`}
            onChange={(v) => setDroneKnobs((s) => ({ ...s, release: v }))} />
        </fieldset>

        <fieldset className="section">
          <legend>Space</legend>
          <Knob label="Reverb (hull size)" min={0} max={1.2} step={0.01} value={reverb}
            display={reverb.toFixed(2)} onChange={setReverb} />
          <Knob label="Echo (corridor)" min={0} max={0.5} step={0.01} value={echo}
            display={echo.toFixed(2)} onChange={setEcho} />
        </fieldset>

        <fieldset className="section">
          <legend>Visual</legend>
          <div className="mode-group" role="group" aria-label="Globe mode">
            {(["realistic", "wireframe", "glow"] as const).map((m) => (
              <button
                key={m}
                className="btn"
                aria-pressed={globeMode === m}
                onClick={() => setGlobeMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={reducedMotion}
                onChange={(e) => setReducedMotion(e.target.checked)}
              />
              Reduce motion
            </label>
          </div>
        </fieldset>

        <button className="btn ghost" onClick={() => setAboutOpen(true)}>
          About &amp; data credits
        </button>
      </div>

      <footer className="attribution">
        <span>Fireball data: NASA/JPL-Caltech CNEOS. Exoplanet data: NASA Exoplanet Archive.</span>
        <span className="links">
          <button onClick={() => setAboutOpen(true)}>info</button>
        </span>
      </footer>

      {aboutOpen && (
        <div
          className="about-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="About Orrery"
          onClick={() => setAboutOpen(false)}
        >
          <div className="about" onClick={(e) => e.stopPropagation()}>
            <h3>Orrery</h3>
            <p>
              Every percussive hit is a real fireball — an asteroid burning up in Earth&apos;s
              atmosphere — placed at its reported coordinates, with its impact energy setting
              loudness and depth, entry velocity setting brightness, and burst altitude setting
              reverb. The drone bed is drawn from known exoplanets: equilibrium temperature
              sets pitch (quantized to a just-intonation pentatonic scale), planet radius sets
              timbre, and orbital period sets the tremolo rate.
            </p>
            <p>
              Fireball data: NASA/JPL-Caltech Center for Near-Earth Object Studies (CNEOS)
              Fireball Data API. Exoplanet data: NASA Exoplanet Archive.
            </p>
            <blockquote>
              This research has made use of the NASA Exoplanet Archive, which is operated by
              the California Institute of Technology, under contract with the National
              Aeronautics and Space Administration under the Exoplanet Exploration Program.
            </blockquote>
            {usingSnapshot && (
              <p>
                Currently playing from a bundled offline snapshot because the live services
                were unreachable.
              </p>
            )}
            <button className="btn" onClick={() => setAboutOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
