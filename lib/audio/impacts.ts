// Percussive one-shot synth for fireballs: a pitch-swept sine "boom", a
// triangle body an octave-and-a-half up, and a noise "crack", all through one
// resonant low-pass. Voices are capped; the oldest is stolen when full.

import type { Engine } from "./engine";
import type { Fireball } from "../data/types";
import { map } from "./scale";

export interface ImpactSettings {
  /** Fundamental offset in semitones (−12..+12). */
  tune: number;
  /** Filter cutoff multiplier (0.25..4). */
  brightness: number;
  /** Filter resonance Q (0.5..12). */
  resonance: number;
  /** Noise ("crack") mix 0..1. */
  punch: number;
  /** Decay-time multiplier (0.4..2.5). */
  decay: number;
}

export const defaultImpactSettings: ImpactSettings = {
  tune: 0,
  brightness: 1,
  resonance: 1.5,
  punch: 0.5,
  decay: 1,
};

const MAX_VOICES = 24;

interface Voice {
  startedAt: number;
  gain: GainNode;
  stop(): void;
}

export class ImpactSynth {
  private engine: Engine;
  private voices: Voice[] = [];
  private noiseBuf: AudioBuffer;
  settings: ImpactSettings = { ...defaultImpactSettings };

  constructor(engine: Engine) {
    this.engine = engine;
    const ctx = engine.ctx;
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /**
   * Schedule one fireball at absolute AudioContext time `when`. The caller
   * spawns the matching visual flash off the same clock, which is what keeps
   * sound and light locked together.
   */
  trigger(fb: Fireball, when: number): void {
    const ctx = this.engine.ctx;
    const s = this.settings;

    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift()!;
      oldest.stop(); // steal: fast-release the oldest voice
    }

    const logE = Math.log10(Math.max(fb.impactE, 0.001));
    // Loudness: log-energy 0.05..500 kt → 0.12..1.0.
    const gainAmt = map(logE, Math.log10(0.05), Math.log10(500), 0.12, 1.0);
    // Register: bigger blasts sit lower (deeper boom).
    const tuneMul = 2 ** (s.tune / 12);
    const f0 = map(logE, Math.log10(0.05), Math.log10(500), 150, 34) * tuneMul;
    // Brightness from entry velocity; null → 1800 Hz default.
    const cutoff =
      (fb.vel == null ? 1800 : map(fb.vel, 11, 73, 400, 7000)) * s.brightness;
    // Decay 120–500 ms scaled by energy, times the knob.
    const decay = map(logE, Math.log10(0.05), Math.log10(500), 0.12, 0.5) * s.decay;
    // Reverb send from altitude: higher burst = wetter; null → mid send.
    const revSend = fb.alt == null ? 0.35 : map(fb.alt, 0, 80, 0.1, 0.8);
    const pan = Math.min(Math.max(fb.lon / 180, -1), 1) * 0.85;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(Math.max(cutoff, 60), 12000);
    lp.Q.value = s.resonance;

    const amp = ctx.createGain();
    amp.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const rev = ctx.createGain();
    rev.gain.value = revSend * gainAmt;

    lp.connect(amp);
    amp.connect(panner);
    panner.connect(this.engine.impactsBus);
    panner.connect(rev);
    rev.connect(this.engine.reverbIn);

    // Boom: sine swept down onto the fundamental.
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(f0 * 2.4, when);
    boom.frequency.exponentialRampToValueAtTime(Math.max(f0, 20), when + 0.09);
    const boomGain = ctx.createGain();
    boomGain.gain.value = 1;
    boom.connect(boomGain);
    boomGain.connect(lp);

    // Body: quiet triangle a fifth above, thickens the mid.
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = f0 * 3;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.25;
    body.connect(bodyGain);
    bodyGain.connect(lp);

    // Crack: short noise burst with its own fast envelope.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(s.punch * 0.8, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, when + Math.min(decay, 0.15));
    noise.connect(noiseGain);
    noiseGain.connect(lp);

    // Percussive amp envelope: few-ms attack, exponential decay.
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(gainAmt, when + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.001, when + 0.004 + decay);

    const stopAt = when + decay + 0.1;
    boom.start(when);
    body.start(when);
    noise.start(when);
    boom.stop(stopAt);
    body.stop(stopAt);
    noise.stop(stopAt);

    const voice: Voice = {
      startedAt: when,
      gain: amp,
      stop: () => {
        const now = ctx.currentTime;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(0, now, 0.015);
      },
    };
    this.voices.push(voice);

    boom.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i !== -1) this.voices.splice(i, 1);
      // Tear the one-shot graph down so nodes don't accumulate.
      amp.disconnect();
      panner.disconnect();
      rev.disconnect();
      lp.disconnect();
    };
  }

  dispose(): void {
    for (const v of this.voices) v.stop();
    this.voices = [];
  }
}
