// Sustained drone bed for exoplanets: each active planet is a small
// subtractive voice — two detuned oscillators (waveform by planet size)
// through a resonant low-pass, with an orbital-period tremolo. Voices rotate
// slowly through the catalog so the bed evolves without CPU blowup.

import type { Engine } from "./engine";
import type { Exoplanet } from "../data/types";
import { buildScale, quantize, map } from "./scale";

export interface DroneSettings {
  /** Scale root frequency, Hz (40..120). */
  rootHz: number;
  /** Oscillator detune spread, cents (0..30). */
  detune: number;
  /** Low-pass cutoff, Hz (200..6000). */
  cutoff: number;
  /** Filter resonance Q (0.3..10). */
  resonance: number;
  /** Tremolo depth 0..1. */
  shimmer: number;
  /** Voice fade-in, seconds. */
  attack: number;
  /** Voice fade-out, seconds. */
  release: number;
}

export const defaultDroneSettings: DroneSettings = {
  rootHz: 55,
  detune: 9,
  cutoff: 1400,
  resonance: 1.2,
  shimmer: 0.45,
  attack: 4,
  release: 6,
};

const MAX_VOICES = 12;
const ROTATE_SECONDS = 7; // crossfade one voice out/in this often

/** Cheap deterministic hash → 0..1, used to give each planet a stable pan. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

interface DroneVoice {
  planet: Exoplanet;
  oscs: OscillatorNode[];
  filter: BiquadFilterNode;
  lfoDepth: GainNode;
  amp: GainNode;
  baseGain: number;
  release(seconds: number): void;
}

export class DroneBed {
  private engine: Engine;
  private planets: Exoplanet[] = [];
  private voices: DroneVoice[] = [];
  private rotateTimer: number | null = null;
  private running = false;
  settings: DroneSettings = { ...defaultDroneSettings };

  constructor(engine: Engine) {
    this.engine = engine;
  }

  setPlanets(planets: Exoplanet[]): void {
    this.planets = planets;
    if (this.running && this.voices.length === 0) this.fill();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.fill();
    this.rotateTimer = window.setInterval(() => this.rotate(), ROTATE_SECONDS * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.rotateTimer != null) window.clearInterval(this.rotateTimer);
    this.rotateTimer = null;
    for (const v of this.voices) v.release(Math.min(this.settings.release, 1.5));
    this.voices = [];
  }

  /** Names of currently sounding planets — the starfield highlights these. */
  activeNames(): string[] {
    return this.voices.map((v) => v.planet.name);
  }

  applySettings(): void {
    const { ctx } = this.engine;
    const s = this.settings;
    const scale = buildScale(s.rootHz);
    for (const v of this.voices) {
      const freq = this.pitchFor(v.planet, scale);
      v.filter.frequency.setTargetAtTime(s.cutoff, ctx.currentTime, 0.1);
      v.filter.Q.setTargetAtTime(s.resonance, ctx.currentTime, 0.1);
      v.lfoDepth.gain.setTargetAtTime(s.shimmer * 0.5, ctx.currentTime, 0.1);
      v.oscs.forEach((osc, i) => {
        osc.frequency.setTargetAtTime(freq * (i === 2 ? 0.5 : 1), ctx.currentTime, 0.3);
        osc.detune.setTargetAtTime((i === 0 ? -1 : 1) * s.detune, ctx.currentTime, 0.1);
      });
    }
  }

  private pitchFor(p: Exoplanet, scale: number[]): number {
    // Hotter = higher: clamp T_eq to 150..2500 K, map onto the scale span,
    // then quantize so simultaneous drones stay consonant.
    const t = Math.min(Math.max(p.eqt, 150), 2500);
    const raw = map(Math.log(t), Math.log(150), Math.log(2500), scale[0], scale[scale.length - 1]);
    let freq = quantize(raw, scale);
    if (p.rade > 6) freq *= 0.5; // giants drop an octave
    return freq;
  }

  private fill(): void {
    const target = Math.min(MAX_VOICES, this.planets.length);
    while (this.voices.length < target) {
      const p = this.pickPlanet();
      if (!p) break;
      this.spawn(p);
    }
  }

  private pickPlanet(): Exoplanet | null {
    if (this.planets.length === 0) return null;
    const active = new Set(this.activeNames());
    for (let tries = 0; tries < 20; tries++) {
      const p = this.planets[Math.floor(Math.random() * this.planets.length)];
      if (!active.has(p.name)) return p;
    }
    return null;
  }

  private rotate(): void {
    if (!this.running || this.planets.length === 0) return;
    if (this.voices.length >= Math.min(MAX_VOICES, this.planets.length)) {
      const oldest = this.voices.shift();
      oldest?.release(this.settings.release);
    }
    const p = this.pickPlanet();
    if (p) this.spawn(p);
  }

  private spawn(planet: Exoplanet): void {
    const { ctx } = this.engine;
    const s = this.settings;
    const scale = buildScale(s.rootHz);
    const freq = this.pitchFor(planet, scale);

    // Bigger planet = fuller waveform (more harmonics for the filter to work
    // with); the third oscillator adds a sub octave only for large planets.
    const wave: OscillatorType =
      planet.rade < 2 ? "sine" : planet.rade < 6 ? "triangle" : "sawtooth";
    const baseGain = map(planet.rade, 0.5, 16, 0.05, 0.11);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = s.cutoff;
    filter.Q.value = s.resonance;

    // Tremolo: LFO rate from orbital period (short period = fast pulse).
    const lfoHz = map(Math.log(Math.min(Math.max(planet.orbper, 0.2), 4000)),
      Math.log(0.2), Math.log(4000), 4.0, 0.05);
    const trem = ctx.createGain();
    trem.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = lfoHz;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = s.shimmer * 0.5;
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);

    const amp = ctx.createGain();
    amp.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = hash01(planet.name) * 1.6 - 0.8;
    const rev = ctx.createGain();
    rev.gain.value = 0.5 * baseGain;

    filter.connect(trem);
    trem.connect(amp);
    amp.connect(panner);
    panner.connect(this.engine.dronesBus);
    panner.connect(rev);
    rev.connect(this.engine.reverbIn);

    const oscs: OscillatorNode[] = [];
    const now = ctx.currentTime;
    for (let i = 0; i < (planet.rade > 6 ? 3 : 2); i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? "sine" : wave;
      osc.frequency.value = freq * (i === 2 ? 0.5 : 1);
      osc.detune.value = (i === 0 ? -1 : 1) * s.detune;
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.6 : 1;
      osc.connect(og);
      og.connect(filter);
      osc.start(now);
      oscs.push(osc);
    }
    lfo.start(now);

    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(baseGain, now + s.attack);

    const voice: DroneVoice = {
      planet,
      oscs,
      filter,
      lfoDepth,
      amp,
      baseGain,
      release: (seconds: number) => {
        const t = ctx.currentTime;
        amp.gain.cancelScheduledValues(t);
        amp.gain.setTargetAtTime(0, t, Math.max(seconds / 4, 0.05));
        const stopAt = t + seconds + 0.5;
        for (const osc of oscs) osc.stop(stopAt);
        lfo.stop(stopAt);
        oscs[0].onended = () => {
          amp.disconnect();
          panner.disconnect();
          rev.disconnect();
          filter.disconnect();
          trem.disconnect();
          lfoDepth.disconnect();
        };
      },
    };
    this.voices.push(voice);
  }

  dispose(): void {
    this.stop();
  }
}
