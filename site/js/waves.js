import * as THREE from 'three';

const G = 9.81;
const TAU = Math.PI * 2;
const REFERENCE_HS = 1.5;

export const SEA_PRESETS = {
  1: { name: 'Calm', hs: 0.35, tp: 4.5 },
  2: { name: 'Rolling', hs: 0.9, tp: 5.4 },
  3: { name: 'Rough', hs: 2.4, tp: 6.1 },
  4: { name: 'Stormy', hs: 5.2, tp: 6.4 },
};

function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function jonswapShape(ratio) {
  const sigma = ratio <= 1 ? 0.07 : 0.09;
  const peak = Math.exp(-((ratio - 1) ** 2) / (2 * sigma * sigma));
  return ratio ** -5 * Math.exp(-1.25 * ratio ** -4) * 3.3 ** peak;
}

// Energy is normalized to significant wave height after shaping the spectrum.
function makeSpectrum() {
  const rnd = makeRng(987654321);
  const windDir = Math.atan2(0.18, 1.0);
  const components = [];

  const primaryCount = 12;
  for (let i = 0; i < primaryCount; i++) {
    const t = i / (primaryCount - 1);
    const ratio = 0.56 * (2.65 / 0.56) ** t;
    const spread = THREE.MathUtils.lerp(0.08, 0.62,
      THREE.MathUtils.smoothstep(ratio, 0.65, 2.4));
    components.push({
      ratio,
      weight: Math.sqrt(Math.max(jonswapShape(ratio) * ratio, 1e-7)),
      direction: windDir + (rnd() - 0.5) * 2 * spread,
      phase: rnd() * TAU,
    });
  }

  const crossDir = windDir + THREE.MathUtils.degToRad(52);
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const ratio = THREE.MathUtils.lerp(0.58, 1.12, t);
    components.push({
      ratio,
      weight: Math.sqrt(Math.max(jonswapShape(ratio) * ratio, 1e-7)) * 0.34,
      direction: crossDir + (rnd() - 0.5) * 0.16,
      phase: rnd() * TAU,
    });
  }

  return components.sort((a, b) => a.ratio - b.ratio);
}

export class WaveField {
  constructor() {
    this.time = 0;
    this.preset = 2;
    this.significantWaveHeight = SEA_PRESETS[2].hs;
    this.peakPeriod = SEA_PRESETS[2].tp;
    this.targetHs = this.significantWaveHeight;
    this.targetTp = this.peakPeriod;
    this.seaState = this.significantWaveHeight / REFERENCE_HS;

    this.waves = makeSpectrum().map(component => ({
      ...component,
      dx: Math.cos(component.direction),
      dz: Math.sin(component.direction),
      k: 0,
      A: 0,
      Q: 0,
      omega: 0,
    }));
    this._dirs = this.waves.map(() => new THREE.Vector4());
    this._amps = this.waves.map(() => new THREE.Vector3());
    this._tmp = new THREE.Vector3();
    this._material = new THREE.Vector3();
    this._velocityTmp = new THREE.Vector3();
    this._syncSpectrum(0);
  }

  setSeaPreset(index) {
    const preset = SEA_PRESETS[index];
    if (!preset) return;
    this.preset = index;
    this.targetHs = preset.hs;
    this.targetTp = preset.tp;
  }

  setSeaState(scale) {
    this.targetHs = THREE.MathUtils.clamp(scale * REFERENCE_HS, 0.15, 3.4);
  }

  update(dt, anchorX = 0, anchorZ = 0) {
    this.time += dt;
    const heightEase = 1 - Math.exp(-dt * 0.55);
    // Period changes stay deliberately slower than height changes; otherwise every
    // wavelength resizes at once and the ocean appears to slide under the boat.
    const periodEase = 1 - Math.exp(-dt * 0.09);
    this.significantWaveHeight = THREE.MathUtils.lerp(
      this.significantWaveHeight, this.targetHs, heightEase);
    this.peakPeriod = THREE.MathUtils.lerp(
      this.peakPeriod, this.targetTp, periodEase);
    this.seaState = this.significantWaveHeight / REFERENCE_HS;
    this._syncSpectrum(dt, anchorX, anchorZ);
  }

  _syncSpectrum(dt, anchorX = 0, anchorZ = 0) {
    let variance = 0;
    for (const w of this.waves) variance += w.weight * w.weight * 0.5;
    const energyScale = (this.significantWaveHeight / 4) / Math.sqrt(variance);

    let rawSteepness = 0;
    for (const w of this.waves) {
      const frequency = w.ratio / this.peakPeriod;
      const nextOmega = TAU * frequency;
      const nextK = (nextOmega * nextOmega) / G;
      if (w.k > 0 && nextK !== w.k) {
        // Preserve the phase at the boat while the wavelength changes.
        const anchorProjection = w.dx * anchorX + w.dz * anchorZ;
        w.phase += (w.k - nextK) * anchorProjection;
      }
      w.omega = nextOmega;
      w.k = nextK;
      w.A = w.weight * energyScale;
      rawSteepness += 0.72 * w.k * w.A;
    }
    const qScale = Math.min(1, 0.62 / Math.max(rawSteepness, 1e-6));

    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      w.Q = 0.72 * qScale;
      w.phase -= w.omega * dt;
      w.phase = THREE.MathUtils.euclideanModulo(w.phase + Math.PI, TAU) - Math.PI;
      this._dirs[i].set(w.dx, w.dz, w.k, w.omega);
      this._amps[i].set(w.A, w.Q, w.phase);
    }
  }

  displacement(x0, z0, out) {
    let dx = 0, dy = 0, dz = 0;
    for (const w of this.waves) {
      const phi = w.k * (w.dx * x0 + w.dz * z0) + w.phase;
      const c = Math.cos(phi), si = Math.sin(phi);
      const qa = w.Q * w.A;
      dx += qa * w.dx * c;
      dz += qa * w.dz * c;
      dy += w.A * si;
    }
    return out.set(dx, dy, dz);
  }

  _materialPointAt(x, z, iterations = 3) {
    let px = x, pz = z;
    for (let i = 0; i < iterations; i++) {
      this.displacement(px, pz, this._tmp);
      px = x - this._tmp.x;
      pz = z - this._tmp.z;
    }
    return this._material.set(px, 0, pz);
  }

  heightAt(x, z) {
    const p = this._materialPointAt(x, z, 3);
    this.displacement(p.x, p.z, this._tmp);
    return this._tmp.y;
  }

  velocityAt(x, z, out) {
    const p = this._materialPointAt(x, z, 2);
    let vx = 0, vy = 0, vz = 0;
    for (const w of this.waves) {
      const phi = w.k * (w.dx * p.x + w.dz * p.z) + w.phase;
      const c = Math.cos(phi), si = Math.sin(phi);
      const orbital = w.Q * w.A * w.omega * si;
      vx += orbital * w.dx;
      vz += orbital * w.dz;
      vy -= w.A * w.omega * c;
    }
    return out.set(vx, vy, vz);
  }

  verticalVelocityAt(x, z) {
    return this.velocityAt(x, z, this._velocityTmp).y;
  }

  normalAt(x, z, out) {
    const p = this._materialPointAt(x, z, 2);
    let nx = 0, ny = 1, nz = 0;
    for (const w of this.waves) {
      const phi = w.k * (w.dx * p.x + w.dz * p.z) + w.phase;
      const c = Math.cos(phi), si = Math.sin(phi);
      const ka = w.k * w.A;
      nx -= w.dx * ka * c;
      nz -= w.dz * ka * c;
      ny -= w.Q * ka * si;
    }
    return out.set(nx, ny, nz).normalize();
  }

  steepnessSum(count = this.waves.length) {
    let sum = 0;
    for (let i = 0; i < Math.min(count, this.waves.length); i++) {
      const w = this.waves[i];
      sum += w.Q * w.k * w.A;
    }
    return sum;
  }

  uniformData() {
    return { dirs: this._dirs, amps: this._amps, count: this.waves.length };
  }
}
