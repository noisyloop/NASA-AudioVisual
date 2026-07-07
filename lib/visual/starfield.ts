// Exoplanet orbs: one point per planet on a far shell, colored by equilibrium
// temperature and sized by radius. Planets whose drone voice is currently
// sounding get a bright halo sprite. A plain random-star backdrop sits behind
// everything. The whole field breathes with the drone-bus audio level.

import * as THREE from "three";
import type { Exoplanet } from "../data/types";

const SHELL_MIN = 34;
const SHELL_MAX = 60;

function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Blackbody-ish color from equilibrium temperature. */
function tempColor(eqt: number): THREE.Color {
  // 150 K (deep red) → 2500 K (blue-white), eased through amber.
  const t = Math.min(Math.max((eqt - 150) / (2500 - 150), 0), 1);
  const c = new THREE.Color();
  c.setHSL(0.02 + (1 - t) * 0.0 + t * 0.6, 0.85 - t * 0.25, 0.45 + t * 0.25);
  return c;
}

const POINTS_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uAudio;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vColor = aColor;
  // Twinkle rides on the drone-bus level so the field pulses with the bed.
  vTwinkle = 0.75 + 0.25 * sin(uTime * 1.7 + aPhase * 40.0) + uAudio * 1.5;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (140.0 / -mv.z) * (1.0 + uAudio * 0.7);
  gl_Position = projectionMatrix * mv;
}
`;

const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float alpha = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * vTwinkle, alpha * alpha);
}
`;

export class Starfield {
  group = new THREE.Group();
  private planets: Exoplanet[] = [];
  private positions = new Map<string, THREE.Vector3>();
  private points: THREE.Points | null = null;
  private pointsMat: THREE.ShaderMaterial | null = null;
  private backdrop: THREE.Points;
  private backdropMat: THREE.PointsMaterial;
  private halos: THREE.Sprite[] = [];
  private haloTex: THREE.Texture;

  constructor() {
    // Static random backdrop stars.
    const n = 1200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(70 + Math.random() * 40);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.backdropMat = new THREE.PointsMaterial({
      color: 0x8899bb,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.backdrop = new THREE.Points(geo, this.backdropMat);
    this.group.add(this.backdrop);

    this.haloTex = Starfield.makeHaloTexture();
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.haloTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      this.halos.push(s);
      this.group.add(s);
    }
  }

  private static makeHaloTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d")!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(200,230,255,1)");
    grad.addColorStop(0.4, "rgba(140,190,255,0.5)");
    grad.addColorStop(1, "rgba(100,160,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  setPlanets(planets: Exoplanet[]): void {
    this.disposePlanetPoints();
    this.planets = planets;
    this.positions.clear();

    const n = planets.length;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const color = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    planets.forEach((p, i) => {
      // Stable pseudo-random placement from the planet name.
      const u = hash01(p.name, 1) * 2 - 1;
      const az = hash01(p.name, 2) * Math.PI * 2;
      const r = SHELL_MIN + hash01(p.name, 3) * (SHELL_MAX - SHELL_MIN);
      const xy = Math.sqrt(1 - u * u);
      const v = new THREE.Vector3(xy * Math.cos(az), u, xy * Math.sin(az)).multiplyScalar(r);
      this.positions.set(p.name, v);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = 0.35 + Math.min(p.rade, 16) * 0.09;
      const c = tempColor(p.eqt);
      color.set([c.r, c.g, c.b], i * 3);
      phase[i] = hash01(p.name, 4);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAudio: { value: 0 } },
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pointsMat);
    this.group.add(this.points);
  }

  /** Highlight the planets whose drones are currently sounding. */
  setActive(names: string[]): void {
    this.halos.forEach((halo, i) => {
      const name = names[i];
      const p = name ? this.positions.get(name) : undefined;
      if (p) {
        halo.position.copy(p);
        halo.visible = true;
      } else {
        halo.visible = false;
      }
    });
  }

  update(elapsed: number, droneLevel: number): void {
    if (this.pointsMat) {
      this.pointsMat.uniforms.uTime.value = elapsed;
      this.pointsMat.uniforms.uAudio.value = droneLevel;
    }
    const haloOpacity = 0.35 + droneLevel * 1.6;
    for (const h of this.halos) {
      if (!h.visible) continue;
      (h.material as THREE.SpriteMaterial).opacity = Math.min(haloOpacity, 1);
      const s = 1.6 + Math.sin(elapsed * 1.2 + h.position.x) * 0.2 + droneLevel * 2;
      h.scale.set(s, s, 1);
    }
    this.group.rotation.y = elapsed * 0.004; // very slow parallax drift
  }

  private disposePlanetPoints(): void {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.pointsMat?.dispose();
      this.points = null;
      this.pointsMat = null;
    }
  }

  dispose(): void {
    this.disposePlanetPoints();
    this.backdrop.geometry.dispose();
    this.backdropMat.dispose();
    this.haloTex.dispose();
    for (const h of this.halos) (h.material as THREE.Material).dispose();
  }
}
