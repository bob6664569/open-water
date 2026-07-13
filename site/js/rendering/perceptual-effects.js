import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const RIPPLE_COUNT = 96;
const LENS_DROP_COUNT = 72;
const RIPPLE_LIFETIME = 0.68;

function makeRippleGeometry() {
  const ring = new THREE.RingGeometry(0.82, 1, 20, 1);
  ring.rotateX(-Math.PI / 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = ring.index;
  for (const [name, attribute] of Object.entries(ring.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(
    new Float32Array(RIPPLE_COUNT * 3), 3,
  ));
  geometry.setAttribute('aBirth', new THREE.InstancedBufferAttribute(
    new Float32Array(RIPPLE_COUNT).fill(-100), 1,
  ));
  geometry.setAttribute('aRadius', new THREE.InstancedBufferAttribute(
    new Float32Array(RIPPLE_COUNT), 1,
  ));
  geometry.instanceCount = RIPPLE_COUNT;
  ring.dispose();
  return geometry;
}

function makeRippleMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec3 aCenter;
      attribute float aBirth;
      attribute float aRadius;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        float age = clamp((uTime - aBirth) / ${RIPPLE_LIFETIME.toFixed(2)}, 0.0, 1.0);
        float alive = step(0.0, uTime - aBirth) * (1.0 - step(0.995, age));
        float radius = aRadius * (0.08 + age * 0.92);
        vec3 transformed = position;
        transformed.xz *= radius;
        transformed += aCenter;
        transformed.y += 0.025 + sin(age * 3.14159265) * 0.012;
        vAlpha = alive * sin(age * 3.14159265) * (1.0 - age * 0.58);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uStorm;
      varying float vAlpha;
      void main() {
        float alpha = vAlpha * uStorm * 0.38;
        gl_FragColor = vec4(0.78, 0.9, 0.96, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function makeWetLensPass(maskTexture) {
  const pass = new ShaderPass({
    name: 'WetLensShader',
    uniforms: {
      tDiffuse: { value: null },
      uLensMask: { value: maskTexture },
      uMaskTexel: { value: new THREE.Vector2(1 / 512, 1 / 288) },
      uWetness: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform sampler2D uLensMask;
      uniform vec2 uMaskTexel;
      uniform float uWetness;
      varying vec2 vUv;
      void main() {
        vec4 source = texture2D(tDiffuse, vUv);
        float mask = texture2D(uLensMask, vUv).a;
        if (mask < 0.0005) {
          gl_FragColor = source;
          return;
        }
        vec2 dx = vec2(uMaskTexel.x * 2.25, 0.0);
        vec2 dy = vec2(0.0, uMaskTexel.y * 2.25);
        float left = texture2D(uLensMask, vUv - dx).a;
        float right = texture2D(uLensMask, vUv + dx).a;
        float down = texture2D(uLensMask, vUv - dy).a;
        float up = texture2D(uLensMask, vUv + dy).a;
        vec2 gradient = vec2(right - left, up - down);
        float neighbourMean = (left + right + down + up) * 0.25;
        float curvature = mask - neighbourMean;
        float body = smoothstep(0.008, 0.13, mask) * min(mask * 1.15, 1.0);
        vec2 offset = gradient * (
          0.045 + body * (0.064 + uWetness * 0.055)
        );
        vec2 refractedUv = clamp(vUv + offset, vec2(0.002), vec2(0.998));
        vec2 blurStep = uMaskTexel * (2.0 + body * 2.5);
        vec3 refracted = texture2D(tDiffuse, refractedUv).rgb * 0.46;
        refracted += texture2D(tDiffuse, clamp(refractedUv + blurStep, vec2(0.002), vec2(0.998))).rgb * 0.135;
        refracted += texture2D(tDiffuse, clamp(refractedUv - blurStep, vec2(0.002), vec2(0.998))).rgb * 0.135;
        refracted += texture2D(tDiffuse, clamp(refractedUv + vec2(blurStep.x, -blurStep.y), vec2(0.002), vec2(0.998))).rgb * 0.135;
        refracted += texture2D(tDiffuse, clamp(refractedUv + vec2(-blurStep.x, blurStep.y), vec2(0.002), vec2(0.998))).rgb * 0.135;

        vec3 normal = normalize(vec3(-gradient * 7.0, 0.5));
        vec3 lensLight = normalize(vec3(-0.48, 0.72, 0.78));
        float rim = smoothstep(0.035, 0.34, length(gradient));
        float facing = dot(normal, lensLight);
        float fresnel = pow(1.0 - max(normal.z, 0.0), 3.0) * rim;
        float caustic = smoothstep(0.015, 0.18, curvature) * body;
        float tangentLight = dot(normal.xy, normalize(lensLight.xy));
        vec3 color = mix(source.rgb, refracted, body * 0.96);
        float edgeLight = max(tangentLight, 0.0);
        float edgeShade = max(-tangentLight, 0.0);
        color *= 1.0 + edgeLight * rim * body * (0.22 + uWetness * 0.22);
        color *= 1.0 - edgeShade * rim * body * (0.16 + uWetness * 0.16);
        color += vec3(0.56, 0.69, 0.75)
          * pow(edgeLight, 1.6) * rim * body * (0.055 + uWetness * 0.12);
        color += vec3(0.62, 0.74, 0.79)
          * (fresnel * 0.028 + caustic * max(facing, 0.0) * 0.045);
        gl_FragColor = vec4(color, source.a);
      }
    `,
  });
  pass.enabled = false;
  return pass;
}

export class PerceptualEffects {
  constructor({
    scene,
    camera,
    boat,
    waveField,
    document = globalThis.document,
    viewportWidth = () => globalThis.innerWidth ?? 1,
    viewportHeight = () => globalThis.innerHeight ?? 1,
    devicePixelRatio = () => globalThis.devicePixelRatio ?? 1,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.boat = boat;
    this.waveField = waveField;
    this.document = document;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.devicePixelRatio = devicePixelRatio;
    this.time = 0;
    this.rainScale = 1;
    this.activeRippleCount = RIPPLE_COUNT;
    this.rippleCursor = 0;
    this.rippleAccumulator = 0;
    this.rainDropAccumulator = 0;
    this.plumeDropAccumulator = 0;
    this.turnDropAccumulator = 0;
    this.cameraSprayDropAccumulator = 0;
    this.lastCameraSprayExposure = 0;
    this.turnSide = 0;
    this.sprayVeil = 0;
    this.horizonOcclusion = 0;
    this.lastSlam = boat.slam ?? 0;
    this.lensDrops = [];

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._sample = new THREE.Vector3();
    this._toCamera = new THREE.Vector3();
    this._projectedHorizon = new THREE.Vector3();

    this.rippleUniforms = {
      uTime: { value: 0 },
      uStorm: { value: 0 },
    };
    this.rippleGeometry = makeRippleGeometry();
    this.rippleMaterial = makeRippleMaterial(this.rippleUniforms);
    this.ripples = new THREE.Mesh(this.rippleGeometry, this.rippleMaterial);
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 3;
    this.ripples.visible = false;
    scene.add(this.ripples);

    this.lensCanvas = document.createElement('canvas');
    this.lensContext = this.lensCanvas.getContext('2d');
    this.lensTexture = new THREE.CanvasTexture(this.lensCanvas);
    this.lensTexture.colorSpace = THREE.NoColorSpace;
    this.lensTexture.minFilter = THREE.LinearFilter;
    this.lensTexture.magFilter = THREE.LinearFilter;
    this.lensTexture.generateMipmaps = false;
    this.lensPass = makeWetLensPass(this.lensTexture);
    this._lensWasActive = false;

    this.lensOverlay = document.createElement('canvas');
    Object.assign(this.lensOverlay.style, {
      position: 'fixed', inset: '0', zIndex: '5', pointerEvents: 'none',
      opacity: '0', filter: 'blur(.28px)',
    });
    document.body.appendChild(this.lensOverlay);
    this.lensOverlayContext = this.lensOverlay.getContext('2d');

    this.sprayLayer = document.createElement('div');
    Object.assign(this.sprayLayer.style, {
      position: 'fixed', inset: '0', zIndex: '4', pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(ellipse at 50% 42%, rgba(232,246,250,.02) 0 28%, rgba(210,232,240,.18) 67%, rgba(232,247,251,.38) 100%)',
      backdropFilter: 'blur(2.4px) saturate(.72) contrast(.94)',
      webkitBackdropFilter: 'blur(2.4px) saturate(.72) contrast(.94)',
    });
    document.body.appendChild(this.sprayLayer);

    this.horizonLayer = document.createElement('div');
    Object.assign(this.horizonLayer.style, {
      position: 'fixed', left: '0', width: '100%', height: '30vh', zIndex: '2',
      pointerEvents: 'none', opacity: '0', transform: 'translateY(-50%)',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(112,145,157,.44), rgba(108,139,151,.14) 48%, transparent 76%)',
      backdropFilter: 'blur(3.2px) saturate(.74)',
      webkitBackdropFilter: 'blur(3.2px) saturate(.74)',
      maskImage: 'linear-gradient(to bottom, transparent, black 32%, black 68%, transparent)',
      webkitMaskImage: 'linear-gradient(to bottom, transparent, black 32%, black 68%, transparent)',
    });
    document.body.appendChild(this.horizonLayer);

    this.resize();
  }

  setPerformanceBudget({ rainScale = 1 } = {}) {
    this.rainScale = rainScale;
    this.activeRippleCount = Math.max(28, Math.floor(RIPPLE_COUNT * rainScale));
    this.rippleGeometry.instanceCount = this.activeRippleCount;
  }

  resize() {
    this.width = Math.max(1, this.viewportWidth());
    this.height = Math.max(1, this.viewportHeight());
    const maskWidth = THREE.MathUtils.clamp(Math.round(this.width * 0.46), 320, 720);
    const maskHeight = Math.max(180, Math.round(maskWidth * this.height / this.width));
    this.lensCanvas.width = maskWidth;
    this.lensCanvas.height = maskHeight;
    this.lensOverlay.width = maskWidth;
    this.lensOverlay.height = maskHeight;
    this.lensOverlay.style.width = `${this.width}px`;
    this.lensOverlay.style.height = `${this.height}px`;
    this.lensPass.uniforms.uMaskTexel.value.set(1 / maskWidth, 1 / maskHeight);
    this.lensTexture.needsUpdate = true;
  }

  update(dt, storm = 0, cameraMode = 0, cameraSprayExposure = 0) {
    this.time += dt;
    this.rippleUniforms.uTime.value = this.time;
    this.rippleUniforms.uStorm.value = storm;
    this.ripples.visible = storm > 0.025;
    if (dt <= 0) return;

    const lensStorm = this.waveField.preset === 4 ? Math.max(storm, 0.86) : storm;
    this._updateRainRipples(dt, storm);
    this._updateLens(dt, lensStorm, cameraMode, cameraSprayExposure);
    this._updateHorizon(dt, cameraMode);
  }

  _updateRainRipples(dt, storm) {
    if (storm <= 0.025) return;
    const rate = (16 + this.rainScale * 92) * Math.pow(storm, 1.45);
    this.rippleAccumulator += dt * rate;
    const count = Math.min(10, Math.floor(this.rippleAccumulator));
    this.rippleAccumulator -= count;
    for (let i = 0; i < count; i++) this._spawnRipple(storm);
  }

  _spawnRipple(storm) {
    const index = this.rippleCursor++ % this.activeRippleCount;
    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 0.001) this._forward.set(0, 0, 1);
    this._forward.normalize();
    this._right.set(this._forward.z, 0, -this._forward.x);
    const distance = 2.5 + Math.pow(Math.random(), 0.68) * 34;
    const side = (Math.random() - 0.5) * (8 + distance * 1.45);
    const center = this.rippleGeometry.attributes.aCenter;
    const x = this.camera.position.x + this._forward.x * distance + this._right.x * side;
    const z = this.camera.position.z + this._forward.z * distance + this._right.z * side;
    center.setXYZ(index, x, this.waveField.heightAt(x, z), z);
    this.rippleGeometry.attributes.aBirth.setX(index, this.time);
    this.rippleGeometry.attributes.aRadius.setX(
      index, 0.12 + Math.random() * (0.22 + storm * 0.24),
    );
    center.needsUpdate = true;
    this.rippleGeometry.attributes.aBirth.needsUpdate = true;
    this.rippleGeometry.attributes.aRadius.needsUpdate = true;
  }

  _updateLens(dt, storm, cameraMode, cameraSprayExposure = 0) {
    const { boat, camera } = this;
    const speed = boat.vel.length();
    const cameraDistance = camera.position.distanceTo(boat.pos);
    const nearStart = Math.max(2.5, boat.spec.length * 0.12);
    const nearEnd = Math.max(9, boat.spec.length * 0.78);
    const cameraNearness = cameraMode === 2
      ? 0 : 1 - THREE.MathUtils.smoothstep(cameraDistance, nearStart, nearEnd);
    const slam = boat.slam ?? 0;
    const impactRise = Math.max(0, slam - this.lastSlam);
    const impactEnergy = cameraNearness
      * THREE.MathUtils.smoothstep(speed, 2.5, 17)
      * THREE.MathUtils.smoothstep(impactRise, 0.08, 0.9);
    if (impactEnergy > 0.02) {
      this.sprayVeil = Math.max(this.sprayVeil, 0.16 + impactEnergy * 0.72);
      const droplets = Math.min(14, 2 + Math.floor(impactEnergy * 14));
      for (let i = 0; i < droplets; i++) this._spawnLensDrop('spray', impactEnergy);
    }
    this.lastSlam = slam;

    const roughness = THREE.MathUtils.smoothstep(
      this.waveField.significantWaveHeight, 1.8, 5.4,
    );
    const rearPlume = this._rearPlumeExposure(speed, cameraMode);
    const turnSpray = this._turnSprayExposure(speed, roughness, cameraNearness, cameraMode);
    const continuousSpray = Math.max(
      cameraNearness * roughness * THREE.MathUtils.smoothstep(speed, 7, 25) * 0.14,
      rearPlume * 0.64,
      turnSpray * 0.16,
    );
    const directSpray = THREE.MathUtils.clamp(cameraSprayExposure, 0, 1);
    const directSprayRise = Math.max(0, directSpray - this.lastCameraSprayExposure);
    const enteredSpray = directSpray > 0.08 && this.lastCameraSprayExposure <= 0.08;
    const impactDrops = enteredSpray
      ? 10 + Math.floor(directSpray * 18)
      : Math.floor(directSprayRise * 16);
    for (let i = 0; i < impactDrops; i++) {
      this._spawnLensDrop('cameraSpray', directSpray);
    }
    this.cameraSprayDropAccumulator += dt * directSpray * (24 + directSpray * 92);
    const cameraSprayDrops = Math.min(7, Math.floor(this.cameraSprayDropAccumulator));
    this.cameraSprayDropAccumulator -= cameraSprayDrops;
    for (let i = 0; i < cameraSprayDrops; i++) {
      this._spawnLensDrop('cameraSpray', directSpray);
    }
    this.lastCameraSprayExposure = directSpray;
    this.sprayVeil = Math.max(
      continuousSpray,
      directSpray * 0.94,
      this.sprayVeil * Math.exp(-dt * 1.38),
    );
    this.sprayLayer.style.opacity = String(Math.min(0.62, this.sprayVeil * 0.68));
    this.lensPass.uniforms.uWetness.value = THREE.MathUtils.clamp(
      Math.max(storm, this.sprayVeil * 1.25), 0, 1,
    );

    this.plumeDropAccumulator += dt * (1.4 + this.rainScale * 7.5) * rearPlume;
    const plumeDrops = Math.min(5, Math.floor(this.plumeDropAccumulator));
    this.plumeDropAccumulator -= plumeDrops;
    for (let i = 0; i < plumeDrops; i++) this._spawnLensDrop('plume', rearPlume);

    this.turnDropAccumulator += dt * (3 + roughness * 16) * turnSpray;
    const turnDrops = Math.min(8, Math.floor(this.turnDropAccumulator));
    this.turnDropAccumulator -= turnDrops;
    for (let i = 0; i < turnDrops; i++) {
      this._spawnLensDrop('turn', turnSpray, this.turnSide);
    }

    let rainOnLens = 0;
    for (const drop of this.lensDrops) {
      if (drop.kind === 'rain') rainOnLens++;
    }
    const stormMinimum = Math.round(14 + this.rainScale * 20);
    const stormDeficit = storm > 0.68
      ? Math.max(0, stormMinimum - rainOnLens) * storm * 4 : 0;
    this.rainDropAccumulator += dt * (
      (6 + this.rainScale * 24) * Math.pow(storm, 1.1) + stormDeficit
    );
    const rainDrops = Math.min(5, Math.floor(this.rainDropAccumulator));
    this.rainDropAccumulator -= rainDrops;
    for (let i = 0; i < rainDrops; i++) this._spawnLensDrop('rain', storm);

    const windDrying = 0.72 + Math.min(speed, 32) * 0.025;
    for (let i = this.lensDrops.length - 1; i >= 0; i--) {
      const drop = this.lensDrops[i];
      drop.age += dt * windDrying;
      const progress = THREE.MathUtils.clamp(drop.age / drop.life, 0, 1);
      const draining = THREE.MathUtils.smoothstep(progress, 0.42, 0.88);
      drop.fade = 1 - THREE.MathUtils.smoothstep(progress, 0.55, 1);
      drop.vy += dt * (
        0.14 + drop.r * 0.0018 + draining * (0.22 + drop.r * 0.0025)
      );
      if (draining > 0.34 && drop.r > 5) drop.streak = true;
      const previousX = drop.x;
      const previousY = drop.y;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      if (drop.streak && drop.vy > 0.02) {
        drop.trailClock += dt;
        if (drop.trailClock >= 0.045) {
          drop.trailClock %= 0.045;
          drop.trail.push({ x: previousX, y: previousY });
          if (drop.trail.length > 14) drop.trail.shift();
        }
      }
      if (drop.age >= drop.life || drop.y > 1.18 || drop.x < -0.15 || drop.x > 1.15) {
        this.lensDrops.splice(i, 1);
      }
    }
    this._drawLens();
  }

  _spawnLensDrop(kind, energy, side = 0) {
    if (this.lensDrops.length >= LENS_DROP_COUNT) {
      let oldest = 0;
      let oldestProgress = -Infinity;
      for (let i = 0; i < this.lensDrops.length; i++) {
        const progress = this.lensDrops[i].age / this.lensDrops[i].life;
        if (progress > oldestProgress) {
          oldestProgress = progress;
          oldest = i;
        }
      }
      if (oldestProgress < 0.72) return null;
      this.lensDrops.splice(oldest, 1);
    }
    const spray = kind !== 'rain';
    const turning = kind === 'turn';
    const direct = kind === 'cameraSpray';
    const radius = spray
      ? 7 + Math.random() * (12 + energy * 18)
      : 5 + Math.random() * 14;
    const life = spray ? 1.8 + Math.random() * 2.5 : 4 + Math.random() * 4.5;
    const drop = {
      kind,
      x: turning
        ? THREE.MathUtils.clamp(0.5 + side * (0.14 + Math.random() * 0.28)
          + (Math.random() - 0.5) * 0.18, 0.04, 0.96)
        : direct ? 0.03 + Math.random() * 0.94
          : spray ? 0.18 + Math.random() * 0.64 : Math.random(),
      y: direct ? 0.1 + Math.random() * 0.88
        : spray ? 0.5 + Math.random() * 0.48 : Math.random() * 0.86,
      r: radius,
      age: 0,
      life,
      vx: (Math.random() - 0.5) * (spray ? 0.06 : 0.012),
      vy: spray ? -0.035 - Math.random() * 0.09 : 0.018 + Math.random() * 0.055,
      streak: Math.random() < (spray ? 0.56 : 0.28),
      seed: Math.random() * Math.PI * 2,
      fade: 1,
      trailClock: 0,
      trail: [],
    };
    this.lensDrops.push(drop);
    return drop;
  }

  _turnSprayExposure(speed, roughness, cameraNearness, cameraMode) {
    if (cameraMode === 2) return 0;
    const yawRate = this.boat.angVelB?.y ?? 0;
    const effectiveSteer = this.boat._effSteer ?? this.boat.steer ?? 0;
    this.turnSide = Math.sign(yawRate || effectiveSteer);
    const turning = Math.max(
      THREE.MathUtils.smoothstep(Math.abs(yawRate), 0.018, 0.22),
      THREE.MathUtils.smoothstep(Math.abs(effectiveSteer), 0.025, 0.2) * 0.72,
    );
    const motion = THREE.MathUtils.smoothstep(speed, 0.8, 12);
    const seaGain = 0.3 + roughness * 0.7;
    const cameraExposure = cameraMode === 0
      ? 0.82 : cameraMode === 1 ? cameraNearness : 0.35;
    return turning * motion * seaGain * cameraExposure;
  }

  _rearPlumeExposure(speed, cameraMode) {
    const { boat, camera } = this;
    if (cameraMode === 2 || speed < 10) return 0;
    this._forward.set(0, 0, 1).applyQuaternion(boat.quat);
    this._right.set(1, 0, 0).applyQuaternion(boat.quat);
    this._toCamera.copy(camera.position).sub(boat.pos);
    const behind = -this._toCamera.dot(this._forward);
    const length = Math.max(boat.spec.length, 1);
    if (behind <= length * 0.2) return 0;

    const side = Math.abs(this._toCamera.dot(this._right));
    const coneWidth = Math.max(boat.spec.beam ?? length * 0.2, 1) * 0.68
      + behind * 0.2;
    const centered = 1 - THREE.MathUtils.smoothstep(
      side, coneWidth * 0.62, coneWidth * 1.18,
    );
    const longitudinal = THREE.MathUtils.smoothstep(
      behind, length * 0.24, length * 0.72,
    ) * (1 - THREE.MathUtils.smoothstep(behind, length * 1.8, length * 4));
    const verticalReach = 1.6 + speed * 0.075;
    const vertical = 1 - THREE.MathUtils.smoothstep(
      Math.abs(this._toCamera.y), verticalReach * 0.62, verticalReach * 1.15,
    );
    const drive = THREE.MathUtils.smoothstep(
      Math.abs(boat.throttle ?? 1) * (boat.propWet ?? 1), 0.18, 0.82,
    );
    const speedEnergy = THREE.MathUtils.smoothstep(speed, 13, 64);
    return centered * longitudinal * vertical * drive * speedEnergy;
  }

  _drawLens() {
    const ctx = this.lensContext;
    const overlay = this.lensOverlayContext;
    if (!ctx || !overlay) return;
    const maskWidth = this.lensCanvas.width;
    const maskHeight = this.lensCanvas.height;
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, maskWidth, maskHeight);
    overlay.setTransform?.(1, 0, 0, 1, 0, 0);
    overlay.clearRect(0, 0, maskWidth, maskHeight);
    if (!this.lensDrops.length) {
      if (this._lensWasActive) this.lensTexture.needsUpdate = true;
      this._lensWasActive = false;
      this.lensPass.enabled = false;
      this.lensOverlay.style.opacity = '0';
      return;
    }
    const screenScale = maskWidth / this.width;
    ctx.globalCompositeOperation = 'lighter';
    for (const drop of this.lensDrops) {
      const life = drop.fade ?? Math.max(0, 1 - drop.age / drop.life);
      const x = drop.x * maskWidth;
      const y = drop.y * maskHeight;
      const radius = drop.r * screenScale * (0.86 + life * 0.14);
      ctx.globalAlpha = life * 0.94;
      if (drop.trail.length > 1) {
        const oldest = drop.trail[0];
        const trailGradient = ctx.createLinearGradient(
          oldest.x * maskWidth, oldest.y * maskHeight, x, y,
        );
        trailGradient.addColorStop(0, 'rgba(255,255,255,.04)');
        trailGradient.addColorStop(0.58, 'rgba(255,255,255,.24)');
        trailGradient.addColorStop(1, 'rgba(255,255,255,.66)');
        ctx.globalAlpha = life * 0.82;
        ctx.strokeStyle = trailGradient;
        ctx.lineWidth = Math.max(1, radius * 0.42);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(oldest.x * maskWidth, oldest.y * maskHeight);
        for (let i = 1; i < drop.trail.length; i++) {
          const previous = drop.trail[i - 1];
          const point = drop.trail[i];
          ctx.quadraticCurveTo(
            previous.x * maskWidth, previous.y * maskHeight,
            (previous.x + point.x) * 0.5 * maskWidth,
            (previous.y + point.y) * 0.5 * maskHeight,
          );
        }
        const latest = drop.trail[drop.trail.length - 1];
        ctx.quadraticCurveTo(
          latest.x * maskWidth, latest.y * maskHeight, x, y,
        );
        ctx.stroke();
        ctx.globalAlpha = life * 0.94;
      }
      const lobes = drop.r > 12 ? 4 : 3;
      for (let lobe = 0; lobe < lobes; lobe++) {
        const phase = drop.seed + lobe * 1.71;
        const lobeRadius = radius * (lobe === 0 ? 1 : 0.68 - lobe * 0.1);
        const offset = lobe === 0 ? 0 : radius * (0.3 + lobe * 0.09);
        const lx = x + Math.cos(phase) * offset;
        const ly = y + Math.sin(phase) * offset * 0.8;
        const gradient = ctx.createRadialGradient(
          lx - lobeRadius * 0.16, ly - lobeRadius * 0.2, lobeRadius * 0.06,
          lx, ly, lobeRadius,
        );
        gradient.addColorStop(0, 'rgba(255,255,255,.94)');
        gradient.addColorStop(0.48, 'rgba(255,255,255,.8)');
        gradient.addColorStop(0.76, 'rgba(255,255,255,.34)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const irregularity = 0.5 + 0.5 * Math.sin(drop.seed * 2.31 + lobe * 1.37);
        const squash = drop.streak
          ? 0.46 + irregularity * 0.18
          : 0.58 + irregularity * 0.22;
        ctx.ellipse(
          lx, ly, lobeRadius * squash, lobeRadius,
          phase * 0.31, 0, Math.PI * 2,
        );
        ctx.fill();
      }

      const tilt = drop.seed * 0.17;
      const rx = radius * (drop.streak ? 0.7 : 0.88);
      overlay.globalAlpha = life;
      overlay.lineCap = 'round';
      overlay.lineWidth = Math.max(0.65, radius * 0.095);
      overlay.strokeStyle = 'rgba(232,248,253,.34)';
      overlay.beginPath();
      overlay.ellipse(
        x - radius * 0.08, y - radius * 0.08,
        rx * 0.9, radius * 0.92, tilt,
        Math.PI * 1.12, Math.PI * 1.43,
      );
      overlay.stroke();
      overlay.lineWidth = Math.max(0.55, radius * 0.075);
      overlay.strokeStyle = 'rgba(13,42,57,.24)';
      overlay.beginPath();
      overlay.ellipse(
        x + radius * 0.06, y + radius * 0.09,
        rx, radius, tilt,
        Math.PI * 0.14, Math.PI * 0.45,
      );
      overlay.stroke();

      if (drop.streak && drop.vy > 0.02) {
        const trail = Math.min(88, 10 + drop.vy * 210) * screenScale;
        const trailGradient = overlay.createLinearGradient(x, y - trail, x, y);
        trailGradient.addColorStop(0, 'rgba(230,247,252,0)');
        trailGradient.addColorStop(1, 'rgba(220,242,249,.22)');
        overlay.strokeStyle = trailGradient;
        overlay.lineWidth = Math.max(0.7, radius * 0.13);
        overlay.beginPath();
        overlay.moveTo(x - drop.vx * 70, y - trail);
        overlay.quadraticCurveTo(x + drop.vx * 35, y - trail * 0.4, x, y);
        overlay.stroke();
      }

    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    overlay.globalAlpha = 1;
    this.lensTexture.needsUpdate = true;
    this.lensPass.enabled = true;
    this.lensOverlay.style.opacity = '1';
    this._lensWasActive = true;
  }

  _updateHorizon(dt, cameraMode) {
    let target = 0;
    const height = this.waveField.significantWaveHeight;
    if (cameraMode !== 2 && height > 2.1) {
      this.camera.getWorldDirection(this._forward);
      this._forward.y = 0;
      if (this._forward.lengthSq() > 0.001) {
        this._forward.normalize();
        const localWater = this.waveField.heightAt(
          this.camera.position.x, this.camera.position.z,
        );
        let crest = -Infinity;
        for (const distance of [7, 11, 17, 25, 36]) {
          const x = this.camera.position.x + this._forward.x * distance;
          const z = this.camera.position.z + this._forward.z * distance;
          crest = Math.max(crest, this.waveField.heightAt(x, z));
        }
        const trough = THREE.MathUtils.smoothstep(-localWater, 0.15, height * 0.34);
        const crestRise = THREE.MathUtils.smoothstep(
          crest - localWater, height * 0.2, height * 0.58,
        );
        const eyeClearance = this.camera.position.y - localWater;
        const lowEye = 1 - THREE.MathUtils.smoothstep(eyeClearance, 3.5, 9.5);
        target = trough * crestRise * lowEye
          * THREE.MathUtils.smoothstep(height, 2.1, 5.8);

        this._projectedHorizon.copy(this.camera.position)
          .addScaledVector(this._forward, 1000);
        this._projectedHorizon.y = 0;
        this._projectedHorizon.project(this.camera);
        const horizonY = THREE.MathUtils.clamp(
          (1 - this._projectedHorizon.y) * 0.5 * this.height,
          this.height * 0.18,
          this.height * 0.82,
        );
        this.horizonLayer.style.top = `${horizonY}px`;
      }
    }
    this.horizonOcclusion = THREE.MathUtils.damp(
      this.horizonOcclusion, target, target > this.horizonOcclusion ? 5.5 : 2.3, dt,
    );
    this.horizonLayer.style.opacity = String(this.horizonOcclusion * 0.62);
  }
}
