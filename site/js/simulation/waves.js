import * as THREE from 'three';

const G = 9.81;
const TAU = Math.PI * 2;
const REFERENCE_HS = 1.5;
const DEG = Math.PI / 180;

// Wind/current directions point toward the flow and share the spectrum's +X angle origin.
export const SEA_PRESETS = {
  1: {
    name: 'Calm', hs: 0.35, tp: 4.5,
    windSpeed: 2.4, windDirection: 22 * DEG, gustiness: 0.12,
    currentSpeed: 0.12, currentDirection: 68 * DEG,
  },
  2: {
    name: 'Rolling', hs: 0.9, tp: 5.4,
    windSpeed: 6.2, windDirection: 12 * DEG, gustiness: 0.22,
    currentSpeed: 0.22, currentDirection: 72 * DEG,
  },
  3: {
    name: 'Rough', hs: 2.4, tp: 6.1,
    windSpeed: 11.8, windDirection: 4 * DEG, gustiness: 0.34,
    currentSpeed: 0.38, currentDirection: 78 * DEG,
  },
  4: {
    name: 'Stormy', hs: 5.2, tp: 6.4,
    windSpeed: 20.5, windDirection: -8 * DEG, gustiness: 0.48,
    currentSpeed: 0.62, currentDirection: 88 * DEG,
  },
};

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

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
    const initial = SEA_PRESETS[this.preset];
    this.significantWaveHeight = initial.hs;
    this.peakPeriod = initial.tp;
    this.targetHs = this.significantWaveHeight;
    this.targetTp = this.peakPeriod;
    this.seaState = this.significantWaveHeight / REFERENCE_HS;
    this.windSpeed = initial.windSpeed;
    this.windDirection = initial.windDirection;
    this.gustiness = initial.gustiness;
    this.targetWindSpeed = this.windSpeed;
    this.targetWindDirection = this.windDirection;
    this.targetGustiness = this.gustiness;
    this.currentSpeed = initial.currentSpeed;
    this.currentDirection = initial.currentDirection;
    this.targetCurrentSpeed = this.currentSpeed;
    this.targetCurrentDirection = this.currentDirection;
    this.gustFactor = 1;

    this.waves = makeSpectrum().map(component => ({
      ...component,
      dx: Math.cos(component.direction),
      dz: Math.sin(component.direction),
      k: 0,
      A: 0,
      Q: 0,
      omega: 0,
    }));
    this._spectrumVariance = this.waves.reduce(
      (sum, wave) => sum + wave.weight * wave.weight * 0.5, 0,
    );
    this.totalSteepness = 0;
    this._dirs = this.waves.map(() => new THREE.Vector4());
    this._amps = this.waves.map(() => new THREE.Vector3());
    this._tmp = new THREE.Vector3();
    this._material = new THREE.Vector3();
    this._velocityTmp = new THREE.Vector3();
    this._currentTmp = new THREE.Vector3();
    this._wakeTmp = new THREE.Vector4();
    this.wakeField = null;
    this._syncSpectrum(0);
  }

  setWakeField(wakeField) {
    this.wakeField = wakeField || null;
  }

  setSeaPreset(index) {
    const preset = SEA_PRESETS[index];
    if (!preset) return;
    this.preset = index;
    this.targetHs = preset.hs;
    this.targetTp = preset.tp;
    this.targetWindSpeed = preset.windSpeed;
    this.targetWindDirection = preset.windDirection;
    this.targetGustiness = preset.gustiness;
    this.targetCurrentSpeed = preset.currentSpeed;
    this.targetCurrentDirection = preset.currentDirection;
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
    const windEase = 1 - Math.exp(-dt * 0.38);
    const currentEase = 1 - Math.exp(-dt * 0.16);
    this.windSpeed = THREE.MathUtils.lerp(
      this.windSpeed, this.targetWindSpeed, windEase);
    this.windDirection += angleDelta(
      this.windDirection, this.targetWindDirection,
    ) * windEase;
    this.gustiness = THREE.MathUtils.lerp(
      this.gustiness, this.targetGustiness, windEase);
    this.currentSpeed = THREE.MathUtils.lerp(
      this.currentSpeed, this.targetCurrentSpeed, currentEase);
    this.currentDirection += angleDelta(
      this.currentDirection, this.targetCurrentDirection,
    ) * currentEase;
    this.gustFactor = this._gustFactorAt(anchorX, anchorZ);
    this._syncSpectrum(dt, anchorX, anchorZ);
  }

  _gustFactorAt(x, z) {
    const spatial = x * 0.0027 + z * 0.0019;
    const gust = Math.sin(this.time * 0.43 + spatial) * 0.56
      + Math.sin(this.time * 1.17 - spatial * 1.7 + 1.4) * 0.29
      + Math.sin(this.time * 2.63 + spatial * 3.1 + 4.2) * 0.15;
    return Math.max(0.52, 1 + gust * this.gustiness);
  }

  windAt(x, z, out) {
    const spatial = x * 0.0018 - z * 0.0023;
    const directionSway = this.gustiness * 0.16
      * Math.sin(this.time * 0.31 + spatial + 0.8);
    const direction = this.windDirection + directionSway;
    const speed = this.windSpeed * this._gustFactorAt(x, z);
    return out.set(
      Math.cos(direction) * speed,
      0,
      Math.sin(direction) * speed,
    );
  }

  currentAt(x, z, out) {
    const spatial = x * 0.0008 + z * 0.0011;
    const meander = Math.sin(this.time * 0.035 + spatial) * 0.1;
    const pulse = 0.94 + 0.06 * Math.sin(this.time * 0.071 - spatial * 1.8 + 2.1);
    const direction = this.currentDirection + meander;
    const speed = this.currentSpeed * pulse;
    return out.set(
      Math.cos(direction) * speed,
      0,
      Math.sin(direction) * speed,
    );
  }

  _syncSpectrum(dt, anchorX = 0, anchorZ = 0) {
    const energyScale = (this.significantWaveHeight / 4)
      / Math.sqrt(this._spectrumVariance);

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

    let totalSteepness = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      w.Q = 0.72 * qScale;
      totalSteepness += w.Q * w.k * w.A;
      w.phase -= w.omega * dt;
      w.phase = THREE.MathUtils.euclideanModulo(w.phase + Math.PI, TAU) - Math.PI;
      this._dirs[i].set(w.dx, w.dz, w.k, w.omega);
      this._amps[i].set(w.A, w.Q, w.phase);
    }
    this.totalSteepness = totalSteepness;
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
    const wakeHeight = this.wakeField
      ? this.wakeField.sample(x, z, this._wakeTmp).x : 0;
    return this._tmp.y + wakeHeight;
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
    this.currentAt(x, z, this._currentTmp);
    const wakeVertical = this.wakeField
      ? this.wakeField.sample(x, z, this._wakeTmp).w : 0;
    return out.set(
      vx + this._currentTmp.x,
      vy + wakeVertical,
      vz + this._currentTmp.z,
    );
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
    if (this.wakeField) {
      this.wakeField.sample(x, z, this._wakeTmp);
      nx -= this._wakeTmp.y;
      nz -= this._wakeTmp.z;
    }
    return out.set(nx, ny, nz).normalize();
  }

  sampleSurface(x, z, velocityOut, normalOut) {
    // heightAt() uses three inverse-displacement iterations while velocityAt()
    // and normalAt() use two. Share the first two iterations and the expensive
    // trigonometric evaluation at that material point without changing either
    // numerical model.
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) {
      this.displacement(px, pz, this._tmp);
      px = x - this._tmp.x;
      pz = z - this._tmp.z;
    }

    let dx = 0, dz = 0;
    let vx = 0, vy = 0, vz = 0;
    let nx = 0, ny = 1, nz = 0;
    for (const w of this.waves) {
      const phi = w.k * (w.dx * px + w.dz * pz) + w.phase;
      const c = Math.cos(phi), si = Math.sin(phi);
      const qa = w.Q * w.A;
      dx += qa * w.dx * c;
      dz += qa * w.dz * c;
      const orbital = qa * w.omega * si;
      vx += orbital * w.dx;
      vz += orbital * w.dz;
      vy -= w.A * w.omega * c;
      const ka = w.k * w.A;
      nx -= w.dx * ka * c;
      nz -= w.dz * ka * c;
      ny -= w.Q * ka * si;
    }
    this.currentAt(x, z, this._currentTmp);
    velocityOut.set(
      vx + this._currentTmp.x,
      vy,
      vz + this._currentTmp.z,
    );
    normalOut.set(nx, ny, nz).normalize();

    px = x - dx;
    pz = z - dz;
    let height = 0;
    for (const w of this.waves) {
      const phi = w.k * (w.dx * px + w.dz * pz) + w.phase;
      height += w.A * Math.sin(phi);
    }
    if (this.wakeField) {
      this.wakeField.sample(x, z, this._wakeTmp);
      height += this._wakeTmp.x;
      velocityOut.y += this._wakeTmp.w;
      normalOut.x -= this._wakeTmp.y;
      normalOut.z -= this._wakeTmp.z;
      normalOut.normalize();
    }
    return height;
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
