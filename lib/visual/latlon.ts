import * as THREE from "three";

/**
 * Signed lat/lon (degrees, N/E positive) → point on a sphere of `radius`.
 * Axis convention matches how three.js wraps an equirectangular texture, so
 * flashes land on the correct geography in realistic mode.
 */
export function latLonToVector3(lat: number, lon: number, radius = 1): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Direction-flag form, matching the raw JPL fields. */
export function latLonDirToVector3(
  lat: number,
  latDir: "N" | "S",
  lon: number,
  lonDir: "E" | "W",
  radius = 1,
): THREE.Vector3 {
  return latLonToVector3(latDir === "S" ? -lat : lat, lonDir === "W" ? -lon : lon, radius);
}
