// The three globe modes. Only the sphere mesh/material swaps between modes —
// flashes and the starfield live elsewhere in the scene and never change.

import * as THREE from "three";

export type GlobeMode = "realistic" | "wireframe" | "glow";

export const GLOBE_RADIUS = 5;

// §14 glow shader, verbatim.
const GLOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  float t = uTime * 0.005;

  vec3 viewDir = normalize(cameraPosition - vPosition);
  float fresnel = 1.0 - max(dot(viewDir, vNormal), 0.0);
  fresnel = pow(fresnel, 3.0);
  vec3 c1 = uColor1 * 0.8;
  vec3 c2 = uColor2;
  // Subtle vertex displacement
  vec3 pos = vPosition + vNormal * fresnel * 0.02;

  vec3 color = mix(c1, c2, fresnel);
  color += sin(t * 1.5 + pos.x * 0.2) * color * 0.2;
  color += sin(t * 2.0 + pos.y * 0.1) * color * 0.1;

  // Rim glow
  float intensity = fresnel * 0.6;
  color *= intensity;

  gl_FragColor = vec4(color, 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 pos = modelViewMatrix * vec4(position, 1.0);
  vPosition = pos.xyz;
  gl_Position = projectionMatrix * pos;
}
`;

// NOTE: the fragment shader computes fresnel in view space, where the fresnel
// term collapses to near-zero at the center — the dark core is intentional.

export interface Globe {
  group: THREE.Group;
  setMode(mode: GlobeMode): void;
  /**
   * `audioLevel` (0..1) is the impacts-bus RMS: it brightens the glow rim and
   * warms the realistic-mode light so the planet visibly reacts to the sound.
   */
  update(elapsedSeconds: number, audioLevel: number): void;
  dispose(): void;
}

const GLOW_RIM_BASE = new THREE.Color("#2196f3");

export function createGlobe(texture: THREE.Texture | null): Globe {
  const group = new THREE.Group();

  // --- realistic ---
  const realistic = new THREE.Group();
  let realisticLight: THREE.DirectionalLight | null = null;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
    realistic.add(new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64), mat));
    realisticLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
    realisticLight.position.set(8, 3, 6);
    realistic.add(realisticLight);
    realistic.add(new THREE.AmbientLight(0x223344, 1.2));
  }

  // --- wireframe / abstract: dark sphere + lat/long grid, additive ---
  const wireframe = new THREE.Group();
  const darkCore = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS * 0.995, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x03060c }),
  );
  const gridPts: number[] = [];
  const SEG = 96;
  for (let m = 0; m < 16; m++) {
    // meridians
    const az = (m / 16) * Math.PI * 2;
    for (let i = 0; i < SEG; i++) {
      for (const j of [i, i + 1]) {
        const p = (j / SEG) * Math.PI;
        gridPts.push(
          GLOBE_RADIUS * Math.sin(p) * Math.cos(az),
          GLOBE_RADIUS * Math.cos(p),
          GLOBE_RADIUS * Math.sin(p) * Math.sin(az),
        );
      }
    }
  }
  for (let q = 1; q < 9; q++) {
    // parallels
    const p = (q / 9) * Math.PI;
    for (let i = 0; i < SEG; i++) {
      for (const j of [i, i + 1]) {
        const az = (j / SEG) * Math.PI * 2;
        gridPts.push(
          GLOBE_RADIUS * Math.sin(p) * Math.cos(az),
          GLOBE_RADIUS * Math.cos(p),
          GLOBE_RADIUS * Math.sin(p) * Math.sin(az),
        );
      }
    }
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  const edges = new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({
      color: 0x2b6fb0,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  wireframe.add(darkCore, edges);

  // --- glow / minimal ---
  const glowUniforms = {
    uTime: { value: 0 },
    uColor1: { value: new THREE.Color("#020c1b") },
    uColor2: { value: GLOW_RIM_BASE.clone() },
  };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowUniforms,
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
  });
  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96), glowMat);

  // Atmosphere halo behind the limb: a slightly larger back-facing shell with
  // its own inverted-fresnel shader. The §14 fragment shader above stays
  // verbatim — this is a separate mesh that gives the mode its depth.
  const haloUniforms = {
    uColor: { value: GLOW_RIM_BASE.clone() },
    uBoost: { value: 1 },
  };
  const haloMat = new THREE.ShaderMaterial({
    uniforms: haloUniforms,
    vertexShader: GLOW_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBoost;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        // Back-face shell: the region behind the globe is depth-occluded, so
        // only an annulus around the silhouette draws. |dot| is largest at
        // the inner edge and falls to zero at the shell's own limb, giving a
        // halo that hugs the planet and fades outward.
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float rim = pow(abs(dot(viewDir, vNormal)), 2.0);
        gl_FragColor = vec4(uColor * rim * 0.55 * uBoost, rim);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 1.18, 64, 64), haloMat);
  const glow = new THREE.Group();
  glow.add(glowSphere, halo);

  group.add(realistic, wireframe, glow);

  let mode: GlobeMode = "glow";
  function setMode(next: GlobeMode) {
    // No committed texture → realistic falls back to the glow mode (§7).
    mode = next === "realistic" && !texture ? "glow" : next;
    realistic.visible = mode === "realistic";
    wireframe.visible = mode === "wireframe";
    glow.visible = mode === "glow";
  }
  setMode("glow");

  return {
    group,
    setMode,
    update(elapsed, audioLevel) {
      // uTime is scaled *0.005 inside the shader; feed it a value that keeps
      // the pulse visible on a human timescale.
      glowUniforms.uTime.value = elapsed * 200;
      // Audio-reactive rim: modulate the uniform, not the shader.
      glowUniforms.uColor2.value
        .copy(GLOW_RIM_BASE)
        .multiplyScalar(1 + audioLevel * 2.2);
      haloUniforms.uBoost.value = 1 + audioLevel * 2.5;
      (edges.material as THREE.LineBasicMaterial).opacity = 0.45 + audioLevel * 0.5;
      if (realisticLight) realisticLight.intensity = 2.4 + audioLevel * 3;
      // Rotation and the audio pulse-scale live on the scene's shared planet
      // group so flash markers stay glued to their geography.
    },
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const m = obj.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((mm) => mm.dispose());
        }
      });
      texture?.dispose();
    },
  };
}
