import * as THREE from 'three';

const G = 9.81;
const DEFAULT_MAX_SOURCES = 96;
const WAKE_LIFETIME = 22;
const WAKE_DECAY_TIME = 8.5;
const DEVELOP_START = 0.08;
const DEVELOP_END = 0.72;
const CREST_SKEW = 0.38;
const TRAIL_NORMALIZATION = 1 / (1.6 * Math.sqrt(Math.PI));

export const WAKE_RENDER_SOURCES = 16;

function makeSource() {
  return {
    active: false,
    x: 0,
    z: 0,
    fx: 0,
    fz: 1,
    beam: 1,
    amplitude: 0,
    wavelength: 1,
    alongScale: 1,
    spreadSpeed: 1,
    age: WAKE_LIFETIME,
  };
}

// A bounded world-space trail shared by CPU buoyancy and GPU water displacement.
export class WakeField {
  constructor(maxSources = DEFAULT_MAX_SOURCES) {
    this.sources = Array.from({ length: maxSources }, makeSource);
    this.activeCount = 0;
    this._writeIndex = 0;
    this._hasLastStern = false;
    this._lastEmitter = new THREE.Vector2();
    this._emitter = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._current = new THREE.Vector3();
    this._distanceCarry = 0;
    this._selected = new Int16Array(WAKE_RENDER_SOURCES);
  }

  clear() {
    for (const source of this.sources) source.active = false;
    this.activeCount = 0;
    this._writeIndex = 0;
    this._hasLastStern = false;
    this._distanceCarry = 0;
  }

  _emit(x, z, fx, fz, boat, speed, spacing) {
    const source = this.sources[this._writeIndex];
    if (!source.active) this.activeCount++;
    this._writeIndex = (this._writeIndex + 1) % this.sources.length;

    const length = Math.max(boat.spec.length, 1);
    const beam = Math.max(boat.spec.beam, 0.5);
    const froude = speed / Math.sqrt(G * length);
    const speedEnergy = THREE.MathUtils.clamp((froude - 0.08) / 1.65, 0, 1);
    const amplitude = THREE.MathUtils.clamp(
      beam * (0.006 + Math.pow(speedEnergy, 1.35) * 0.078)
        * Math.min(boat.wet * 1.4, 1),
      0.012,
      0.65,
    );

    source.active = true;
    source.x = x;
    source.z = z;
    source.fx = fx;
    source.fz = fz;
    source.beam = beam;
    source.amplitude = amplitude;
    source.wavelength = THREE.MathUtils.clamp(
      beam * 1.35 + amplitude * 7,
      1.2,
      14,
    );
    // Kelvin's deep-water wake cusp sits at about 19.5 degrees.  Moving the
    // packets laterally at this fraction of the emission speed keeps the
    // persistent trail on that angle, even after the boat has turned away.
    source.spreadSpeed = THREE.MathUtils.clamp(speed * 0.46, 1.05, 7.2);
    source.alongScale = Math.max(spacing * 4, beam * 2.2);
    source.age = 0;
  }

  update(dt, boat, waterField = null) {
    if (dt <= 0) return;
    if (waterField && typeof waterField.currentAt === 'function') {
      waterField.currentAt(boat.pos.x, boat.pos.z, this._current);
    } else {
      this._current.set(0, 0, 0);
    }

    for (const source of this.sources) {
      if (!source.active) continue;
      source.age += dt;
      if (source.age >= WAKE_LIFETIME) {
        source.active = false;
        this.activeCount--;
        continue;
      }
      source.x += this._current.x * dt;
      source.z += this._current.z * dt;
    }

    this._forward.set(0, 0, 1).applyQuaternion(boat.quat);
    const forwardLength = Math.hypot(this._forward.x, this._forward.z) || 1;
    const fx = this._forward.x / forwardLength;
    const fz = this._forward.z / forwardLength;
    // The divergent wave is born just ahead of the physical bow, where the
    // hull first parts the water.  Propeller foam remains a separate stern FX.
    const yawRate = Math.abs(boat.angVelB?.y || 0);
    const turnBlend = THREE.MathUtils.smoothstep(yawRate, 0.06, 0.45);
    const bowFraction = THREE.MathUtils.lerp(0.54, 0.5, turnBlend);
    const bowOffset = Math.max(boat.spec.length, 1) * bowFraction;
    this._emitter.set(
      boat.pos.x + fx * bowOffset,
      boat.pos.y,
      boat.pos.z + fz * bowOffset,
    );
    const sx = this._emitter.x;
    const sz = this._emitter.z;

    if (!this._hasLastStern) {
      this._lastEmitter.set(sx, sz);
      this._hasLastStern = true;
      return;
    }

    const dx = sx - this._lastEmitter.x;
    const dz = sz - this._lastEmitter.y;
    const distance = Math.hypot(dx, dz);
    const teleportDistance = Math.max(30, boat.spec.length * 3);
    if (distance > teleportDistance) {
      this.clear();
      this._lastEmitter.set(sx, sz);
      this._hasLastStern = true;
      return;
    }

    const speed = boat.speedKn / 1.94384;
    if (speed > 1.8 && boat.wet > 0.04 && distance > 1e-5) {
      const spacing = THREE.MathUtils.clamp(
        Math.max(boat.spec.beam * 0.5, speed * 0.18),
        0.55,
        3.2,
      );
      let nextDistance = spacing - this._distanceCarry;
      let emitted = 0;
      while (nextDistance <= distance && emitted < 14) {
        const t = nextDistance / distance;
        this._emit(
          this._lastEmitter.x + dx * t,
          this._lastEmitter.y + dz * t,
          fx,
          fz,
          boat,
          speed,
          spacing,
        );
        nextDistance += spacing;
        emitted++;
      }
      this._distanceCarry = (this._distanceCarry + distance) % spacing;
    } else if (speed <= 1.8 || boat.wet <= 0.04) {
      this._distanceCarry = 0;
    }

    this._lastEmitter.set(sx, sz);
  }

  sample(x, z, out) {
    let height = 0;
    let slopeX = 0;
    let slopeZ = 0;
    let verticalVelocity = 0;

    for (const source of this.sources) {
      if (!source.active || source.age <= DEVELOP_START) continue;
      const rx = x - source.x;
      const rz = z - source.z;
      const along = rx * source.fx + rz * source.fz;
      if (Math.abs(along) > source.alongScale * 3.2) continue;
      const px = -source.fz;
      const pz = source.fx;
      const lateral = rx * px + rz * pz;
      const lateralAbs = Math.abs(lateral);
      const lateralSign = lateral < 0 ? -1 : 1;

      const waveSpeed = source.spreadSpeed;
      const crestOffset = source.beam * 0.44
        + waveSpeed * (source.age - DEVELOP_START);
      const sigma = Math.max(source.beam * 0.25, 0.34)
        + Math.min(source.age * 0.065, 0.9);
      const outerGap = Math.max(source.wavelength * 0.58, source.beam * 0.65);
      const crestCoordinate = lateralAbs - crestOffset + along * CREST_SKEW;
      if (crestCoordinate < -sigma * 4
          || crestCoordinate > outerGap + sigma * 5.4) continue;

      const ridgeD = crestCoordinate / sigma;
      const ridge = Math.exp(-ridgeD * ridgeD);
      const ridgeDc = ridge * -2 * ridgeD / sigma;
      const outerSigma = sigma * 1.35;
      const outerD = (crestCoordinate - outerGap) / outerSigma;
      const outer = Math.exp(-outerD * outerD);
      const outerDc = outer * -2 * outerD / outerSigma;
      const troughWidth = Math.max(source.beam * 0.36, 0.34)
        + source.age * 0.04;
      const troughD = lateralAbs / troughWidth;
      const trough = Math.exp(-troughD * troughD);
      const troughDa = trough * -2 * troughD / troughWidth;

      const shape = ridge - outer * 0.28 - trough * 0.22;
      const shapeDc = ridgeDc - outerDc * 0.28;
      const shapeDa = shapeDc - troughDa * 0.22;
      const alongD = along / source.alongScale;
      const alongGaussian = Math.exp(-alongD * alongD);
      const frontT = THREE.MathUtils.clamp((alongD + 1.4) / 2.4, 0, 1);
      const frontSmooth = frontT * frontT * (3 - 2 * frontT);
      const frontWeight = 0.22 + frontSmooth * 0.78;
      const frontDerivative = frontT > 0 && frontT < 1
        ? 0.78 * 6 * frontT * (1 - frontT)
          / (2.4 * source.alongScale)
        : 0;
      const alongEnvelope = alongGaussian * frontWeight;
      const alongDerivative = alongGaussian
        * (-2 * along / (source.alongScale * source.alongScale) * frontWeight
          + frontDerivative);
      const developmentT = THREE.MathUtils.clamp(
        (source.age - DEVELOP_START) / (DEVELOP_END - DEVELOP_START), 0, 1,
      );
      const development = developmentT * developmentT * (3 - 2 * developmentT);
      const developmentDerivative = developmentT > 0 && developmentT < 1
        ? 6 * developmentT * (1 - developmentT) / (DEVELOP_END - DEVELOP_START)
        : 0;
      const decay = Math.exp(-source.age / WAKE_DECAY_TIME);
      const gain = source.amplitude * development * decay
        * TRAIL_NORMALIZATION;
      const contribution = gain * alongEnvelope * shape;
      const dAlong = gain * (alongDerivative * shape
        + alongEnvelope * shapeDc * CREST_SKEW);
      const dLateral = gain * alongEnvelope * shapeDa * lateralSign;

      height += contribution;
      slopeX += dAlong * source.fx + dLateral * px;
      slopeZ += dAlong * source.fz + dLateral * pz;
      verticalVelocity += -waveSpeed * gain * alongEnvelope * shapeDc
        + source.amplitude * decay * TRAIL_NORMALIZATION
          * developmentDerivative * alongEnvelope * shape
        - contribution / WAKE_DECAY_TIME;
    }

    return out.set(height, slopeX, slopeZ, verticalVelocity);
  }

  fillUniforms(
    focusX,
    focusZ,
    wakeUniforms,
    metaUniforms,
    extraUniforms,
    radius = 58,
  ) {
    this._selected.fill(-1);
    let selectedCount = 0;
    const radiusSq = radius * radius;

    for (let slot = 0; slot < WAKE_RENDER_SOURCES; slot++) {
      let bestIndex = -1;
      let bestDistance = radiusSq;
      for (let index = 0; index < this.sources.length; index++) {
        const source = this.sources[index];
        if (!source.active || source.age <= DEVELOP_START) continue;
        let alreadySelected = false;
        for (let i = 0; i < selectedCount; i++) {
          if (this._selected[i] === index) {
            alreadySelected = true;
            break;
          }
        }
        if (alreadySelected) continue;
        const dx = source.x - focusX;
        const dz = source.z - focusZ;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < bestDistance) {
          bestDistance = distanceSq;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) break;
      this._selected[selectedCount++] = bestIndex;
    }

    for (let i = 0; i < selectedCount; i++) {
      const source = this.sources[this._selected[i]];
      wakeUniforms[i].set(
        source.x, source.z, source.amplitude, source.age,
      );
      metaUniforms[i].set(
        source.fx, source.fz, source.beam, source.spreadSpeed,
      );
      extraUniforms[i].set(source.alongScale, source.wavelength);
    }
    return selectedCount;
  }
}
