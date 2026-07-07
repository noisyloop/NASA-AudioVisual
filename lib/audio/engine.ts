// AudioContext plumbing: master bus, per-layer buses, a generated-impulse
// reverb send, a subtle "station echo" delay, and analyser taps that let the
// visuals sync to what is actually sounding.

export interface AudioLevels {
  /** 0..1-ish RMS of each bus, smoothed by the analyser. */
  master: number;
  impacts: number;
  drones: number;
}

export interface Engine {
  ctx: AudioContext;
  master: GainNode;
  impactsBus: GainNode;
  dronesBus: GainNode;
  /** Feed this to add reverb; per-voice send gains connect here. */
  reverbIn: GainNode;
  setMasterVolume(v: number): void;
  setImpactsVolume(v: number): void;
  setDronesVolume(v: number): void;
  setReverbLevel(v: number): void;
  setEchoLevel(v: number): void;
  getLevels(): AudioLevels;
  dispose(): void;
}

/** Exponential-decay noise burst — a classic synthetic reverb impulse. */
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // Squared falloff reads as a big, dark hull — more station, less hall.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
  }
  return buf;
}

export function createEngine(): Engine {
  const ctx = new AudioContext();

  const master = ctx.createGain();
  master.gain.value = 0.8;
  // Gentle glue compression so stacked impacts never clip the output.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 20;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;

  const masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = 512;
  masterAnalyser.smoothingTimeConstant = 0.6;

  master.connect(comp);
  comp.connect(masterAnalyser);
  masterAnalyser.connect(ctx.destination);

  const impactsBus = ctx.createGain();
  const dronesBus = ctx.createGain();
  impactsBus.gain.value = 0.9;
  dronesBus.gain.value = 0.7;
  impactsBus.connect(master);
  dronesBus.connect(master);

  // Per-layer analysers tap the buses so visuals can react to each layer
  // separately (impacts pump the globe, drones shimmer the starfield).
  const impactsAnalyser = ctx.createAnalyser();
  const dronesAnalyser = ctx.createAnalyser();
  for (const a of [impactsAnalyser, dronesAnalyser]) {
    a.fftSize = 512;
    a.smoothingTimeConstant = 0.5;
  }
  impactsBus.connect(impactsAnalyser);
  dronesBus.connect(dronesAnalyser);

  // Reverb send/return.
  const reverbIn = ctx.createGain();
  reverbIn.gain.value = 1;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 4);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.6;
  reverbIn.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);

  // "Station echo": a slow ping-pong delay fed lightly from both buses —
  // distant clangs down a corridor.
  const echoSend = ctx.createGain();
  echoSend.gain.value = 0.12;
  const delayL = ctx.createDelay(2);
  const delayR = ctx.createDelay(2);
  delayL.delayTime.value = 0.41;
  delayR.delayTime.value = 0.63;
  const fbL = ctx.createGain();
  const fbR = ctx.createGain();
  fbL.gain.value = 0.35;
  fbR.gain.value = 0.35;
  const echoFilter = ctx.createBiquadFilter();
  echoFilter.type = "lowpass";
  echoFilter.frequency.value = 1500;
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.7;
  panR.pan.value = 0.7;
  impactsBus.connect(echoSend);
  dronesBus.connect(echoSend);
  echoSend.connect(echoFilter);
  echoFilter.connect(delayL);
  delayL.connect(fbL);
  fbL.connect(delayR); // cross-feed = ping-pong
  delayR.connect(fbR);
  fbR.connect(delayL);
  delayL.connect(panL);
  delayR.connect(panR);
  panL.connect(master);
  panR.connect(master);

  const buf = new Uint8Array(masterAnalyser.fftSize);
  function rms(analyser: AnalyserNode): number {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  const ramp = (param: AudioParam, v: number) => {
    param.setTargetAtTime(v, ctx.currentTime, 0.03);
  };

  return {
    ctx,
    master,
    impactsBus,
    dronesBus,
    reverbIn,
    setMasterVolume: (v) => ramp(master.gain, v),
    setImpactsVolume: (v) => ramp(impactsBus.gain, v),
    setDronesVolume: (v) => ramp(dronesBus.gain, v),
    setReverbLevel: (v) => ramp(reverbReturn.gain, v),
    setEchoLevel: (v) => ramp(echoSend.gain, v),
    getLevels: () => ({
      master: rms(masterAnalyser),
      impacts: rms(impactsAnalyser),
      drones: rms(dronesAnalyser),
    }),
    dispose: () => {
      void ctx.close();
    },
  };
}
