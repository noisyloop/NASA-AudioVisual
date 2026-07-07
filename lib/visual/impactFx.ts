// Impact flash FX: an expanding additive ring + a brief point-sprite bloom at
// the impact's lat/lon, with an optional incoming streak for fast entries.
// Everything is pooled up front — spawning never allocates.

import * as THREE from "three";
import { GLOBE_RADIUS } from "./globe";

const POOL_SIZE = 32;

function makeBloomTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,240,210,1)");
  grad.addColorStop(0.35, "rgba(255,170,80,0.7)");
  grad.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface FlashUnit {
  active: boolean;
  age: number;
  duration: number;
  scale: number;
  ring: THREE.Mesh;
  sprite: THREE.Sprite;
  streak: THREE.Mesh;
  useStreak: boolean;
}

export class ImpactFx {
  group = new THREE.Group();
  private pool: FlashUnit[] = [];
  private bloomTex: THREE.Texture;
  private ringGeo: THREE.RingGeometry;
  private streakGeo: THREE.CylinderGeometry;
  reducedMotion = false;

  constructor() {
    this.bloomTex = makeBloomTexture();
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 32);
    this.streakGeo = new THREE.CylinderGeometry(0.008, 0.03, 1, 6, 1, true);

    for (let i = 0; i < POOL_SIZE; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffb050,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(this.ringGeo, ringMat);
      const spriteMat = new THREE.SpriteMaterial({
        map: this.bloomTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const streakMat = new THREE.MeshBasicMaterial({
        color: 0xffe0b0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const streak = new THREE.Mesh(this.streakGeo, streakMat);
      ring.visible = sprite.visible = streak.visible = false;
      this.group.add(ring, sprite, streak);
      this.pool.push({
        active: false,
        age: 0,
        duration: 1,
        scale: 1,
        ring,
        sprite,
        streak,
        useStreak: false,
      });
    }
  }

  /** `position` is a point on the unit sphere; energy in kt, vel in km/s. */
  spawn(position: THREE.Vector3, energyKt: number, vel: number | null): void {
    let unit = this.pool.find((u) => !u.active);
    if (!unit) {
      // Pool exhausted: recycle the oldest flash.
      unit = this.pool.reduce((a, b) => (a.age > b.age ? a : b));
    }
    const logE = Math.log10(Math.max(energyKt, 0.01));
    const t = Math.min(Math.max((logE - Math.log10(0.05)) / (Math.log10(500) - Math.log10(0.05)), 0), 1);

    unit.active = true;
    unit.age = 0;
    // Fade 0.6–1.2 s scaled by energy; reduced motion = slower and softer.
    unit.duration = (0.6 + t * 0.6) * (this.reducedMotion ? 1.6 : 1);
    unit.scale = 0.25 + t * 1.4;

    const p = position.clone().multiplyScalar(GLOBE_RADIUS * 1.01);
    const normal = position.clone().normalize();

    unit.ring.position.copy(p);
    unit.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    unit.ring.visible = true;

    unit.sprite.position.copy(p);
    unit.sprite.visible = true;

    // Thin incoming streak along the surface normal for fast entries.
    unit.useStreak = !this.reducedMotion && vel != null && vel > 28;
    if (unit.useStreak) {
      const len = 1.2 + t * 1.5;
      unit.streak.scale.set(1, len, 1);
      unit.streak.position.copy(normal).multiplyScalar(GLOBE_RADIUS + len / 2);
      unit.streak.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      unit.streak.visible = true;
    } else {
      unit.streak.visible = false;
    }
  }

  update(dt: number): void {
    const soften = this.reducedMotion ? 0.5 : 1;
    for (const u of this.pool) {
      if (!u.active) continue;
      u.age += dt;
      const k = u.age / u.duration; // 0 → 1 over the flash lifetime
      if (k >= 1) {
        u.active = false;
        u.ring.visible = u.sprite.visible = u.streak.visible = false;
        continue;
      }
      const fade = (1 - k) * (1 - k);
      const ringScale = (0.2 + k * 2.2) * u.scale;
      u.ring.scale.setScalar(ringScale);
      (u.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.9 * soften;
      const spriteScale = u.scale * (1.2 - k * 0.5);
      u.sprite.scale.set(spriteScale, spriteScale, 1);
      (u.sprite.material as THREE.SpriteMaterial).opacity = fade * soften;
      if (u.useStreak) {
        (u.streak.material as THREE.MeshBasicMaterial).opacity =
          Math.max(0, 1 - k * 3) * 0.7;
      }
    }
  }

  dispose(): void {
    this.ringGeo.dispose();
    this.streakGeo.dispose();
    this.bloomTex.dispose();
    for (const u of this.pool) {
      (u.ring.material as THREE.Material).dispose();
      (u.sprite.material as THREE.Material).dispose();
      (u.streak.material as THREE.Material).dispose();
    }
  }
}
