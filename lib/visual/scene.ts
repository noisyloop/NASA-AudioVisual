// Scene orchestrator: renderer, camera drift, the three-mode globe, pooled
// impact flashes and the exoplanet starfield — one render loop, with a frame
// callback the instrument uses to pump audio levels and audio-clock-synced
// events into the visuals.

import * as THREE from "three";
import { createGlobe, type Globe, type GlobeMode } from "./globe";
import { ImpactFx } from "./impactFx";
import { Starfield } from "./starfield";
import { latLonToVector3 } from "./latlon";
import type { Exoplanet } from "../data/types";
import type { AudioLevels } from "../audio/engine";

export interface SceneHandle {
  start(): void;
  stop(): void;
  setGlobeMode(mode: GlobeMode): void;
  setPlanets(planets: Exoplanet[]): void;
  setActivePlanets(names: string[]): void;
  spawnImpact(lat: number, lon: number, energyKt: number, vel: number | null): void;
  setReducedMotion(reduced: boolean): void;
  /** Called once per frame before render; return the current bus levels so
   * the visuals track the audio. */
  setFrameCallback(cb: ((dt: number) => AudioLevels) | null): void;
  dispose(): void;
}

const ZERO_LEVELS: AudioLevels = { master: 0, impacts: 0, drones: 0 };

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // perf cap
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01030a);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  camera.position.set(0, 2.5, 13.5);

  // Globe + flashes share this group so flashes stay pinned to geography as
  // the planet slowly turns and pulses with the impact bus.
  const planetGroup = new THREE.Group();
  scene.add(planetGroup);

  const impactFx = new ImpactFx();
  planetGroup.add(impactFx.group);

  const starfield = new Starfield();
  scene.add(starfield.group);

  let globe: Globe | null = null;
  let pendingMode: GlobeMode = "glow";
  new THREE.TextureLoader().load(
    "/earth.jpg",
    (tex) => {
      globe = createGlobe(tex);
      globe.setMode(pendingMode);
      planetGroup.add(globe.group);
    },
    undefined,
    () => {
      // Texture missing → globe without realistic mode (falls back to glow).
      globe = createGlobe(null);
      globe.setMode(pendingMode);
      planetGroup.add(globe.group);
    },
  );

  let reducedMotion = false;
  let frameCb: ((dt: number) => AudioLevels) | null = null;
  let running = false;
  let raf = 0;
  const clock = new THREE.Clock(false);
  let elapsed = 0;

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;

    const levels = frameCb ? frameCb(dt) : ZERO_LEVELS;

    // Camera drift, damped hard under reduced motion.
    const driftSpeed = reducedMotion ? 0.006 : 0.045;
    const a = elapsed * driftSpeed;
    camera.position.set(
      Math.sin(a) * 13.5,
      2.5 + Math.sin(a * 0.7) * (reducedMotion ? 0.15 : 1.2),
      Math.cos(a) * 13.5,
    );
    camera.lookAt(0, 0, 0);

    planetGroup.rotation.y = elapsed * (reducedMotion ? 0.002 : 0.01);
    // The whole planet breathes with the percussion bus — the core of the
    // "visualizer locked to the audio" feel.
    planetGroup.scale.setScalar(1 + levels.impacts * (reducedMotion ? 0.015 : 0.05));

    globe?.update(elapsed, levels.impacts);
    starfield.update(elapsed, levels.drones);
    impactFx.update(dt);

    renderer.render(scene, camera);
  }

  return {
    start() {
      if (running) return;
      running = true;
      clock.start();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      clock.stop();
    },
    setGlobeMode(mode) {
      pendingMode = mode;
      globe?.setMode(mode);
    },
    setPlanets(planets) {
      starfield.setPlanets(planets);
    },
    setActivePlanets(names) {
      starfield.setActive(names);
    },
    spawnImpact(lat, lon, energyKt, vel) {
      impactFx.spawn(latLonToVector3(lat, lon), energyKt, vel);
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      impactFx.reducedMotion = reduced;
    },
    setFrameCallback(cb) {
      frameCb = cb;
    },
    dispose() {
      this.stop();
      ro.disconnect();
      globe?.dispose();
      impactFx.dispose();
      starfield.dispose();
      renderer.dispose();
    },
  };
}
