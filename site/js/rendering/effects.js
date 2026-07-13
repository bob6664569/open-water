import * as THREE from 'three';
import { showInRefraction } from './render-layers.js';

export function turnSpraySpeedBoost(forwardSpeed) {
  const highSpeed = THREE.MathUtils.smoothstep(forwardSpeed, 48, 103);
  return 1 + highSpeed * (1.7 + highSpeed * 1.3);
}

function makeDropletTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 10 + Math.random() * 44, y = 10 + Math.random() * 44;
    const r = 1.5 + Math.random() * 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(240,250,255,0.7)');
    g.addColorStop(1, 'rgba(240,250,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

function makeMistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const image = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const nx = (x - 64) / 61, ny = (y - 64) / 43;
      const r = Math.hypot(nx, ny);
      const noise = 0.5 + 0.2 * Math.sin(x * 0.17 + y * 0.09)
                    + 0.15 * Math.sin(x * 0.07 - y * 0.19)
                    + 0.1 * Math.sin((x + y) * 0.31);
      const edge = Math.max(0, 1 - r);
      const alpha = Math.max(0, Math.min(1, edge * edge * noise * 0.52));
      const i = (y * 128 + x) * 4;
      image.data[i] = 242; image.data[i + 1] = 250;
      image.data[i + 2] = 255; image.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(c);
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(48, 48, 3, 48, 48, 46);
  g.addColorStop(0, 'rgba(205,212,216,0.5)');
  g.addColorStop(0.38, 'rgba(165,177,183,0.25)');
  g.addColorStop(1, 'rgba(115,128,136,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 96, 96);
  return new THREE.CanvasTexture(c);
}

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 22);
  g.addColorStop(0, 'rgba(255,255,225,1)');
  g.addColorStop(0.18, 'rgba(255,188,62,0.95)');
  g.addColorStop(0.52, 'rgba(255,66,8,0.5)');
  g.addColorStop(1, 'rgba(125,8,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);
  return new THREE.CanvasTexture(c);
}

function makeImpactFoamTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 22 + Math.random() * 84, y = 24 + Math.random() * 80;
    const r = 12 + Math.random() * 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(238,249,255,0.075)');
    g.addColorStop(1, 'rgba(238,249,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 38; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.pow(Math.random(), 0.65) * 48;
    const x = 64 + Math.cos(angle) * radius;
    const y = 66 + Math.sin(angle) * radius * 0.78;
    const r = 1.2 + Math.pow(Math.random(), 2.2) * 7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(245,252,255,${0.45 + Math.random() * 0.4})`);
    g.addColorStop(0.45, 'rgba(238,249,255,0.42)');
    g.addColorStop(1, 'rgba(238,249,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBubbleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(27, 24, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.12, 'rgba(220,244,255,0.55)');
  g.addColorStop(0.42, 'rgba(170,224,246,0.18)');
  g.addColorStop(1, 'rgba(130,205,235,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SPRAY_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(-mv.z, 1.0));
    vAlpha = aAlpha;
    vSeed = aSeed;
    gl_Position = projectionMatrix * mv;
  }
`;
const SPRAY_FRAG = /* glsl */`
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uRotation;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float angle = (vSeed - 0.5) * 6.2831853
                + uTime * uRotation * (vSeed * 2.0 - 1.0);
    float ca = cos(angle), sa = sin(angle);
    uv = mat2(ca, -sa, sa, ca) * uv;
    if (max(abs(uv.x), abs(uv.y)) > 0.5) discard;
    vec4 t = texture2D(uTex, uv + 0.5);
    float a = t.a * vAlpha;
    if (a < 0.012) discard;
    gl_FragColor = vec4(t.rgb * vec3(0.94, 0.98, 1.0), a);
  }
`;

class ParticleSystem {
  constructor(scene, max, texture, {
    gravity = 9.81, drag = 0, turbulence = 0, rotation = 0, fadeIn = 0,
  } = {}) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.turbulence = turbulence;
    this.fadeIn = fadeIn;
    this.time = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.activeIndices = new Int32Array(max);
    this.activeSlot = new Int32Array(max);
    this.activeSlot.fill(-1);
    this.activeCount = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -60;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texture }, uTime: { value: 0 }, uRotation: { value: rotation },
      },
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this._dynamicDirty = false;
    this._seedDirty = false;
    this.points.onBeforeRender = () => this._flushGpuUpdates();
    scene.add(this.points);
    this.cursor = 0;
    this.activeLimit = max;
  }

  setBudget(scale) {
    const next = Math.max(32, Math.floor(this.max * scale));
    if (next === this.activeLimit) return;
    this.activeLimit = next;
    this.cursor %= next;
    this.points.geometry.setDrawRange(0, next);
    this.clear();
  }

  spawn(x, y, z, vx, vy, vz, life, size, alpha, grow = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;
    if (this.activeSlot[i] < 0) {
      this.activeSlot[i] = this.activeCount;
      this.activeIndices[this.activeCount++] = i;
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.alpha0[i] = alpha; this.grow[i] = grow;
    this.seed[i] = Math.random();
    this._dynamicDirty = true;
    this._seedDirty = true;
  }

  _removeActiveAt(activeIndex) {
    const removed = this.activeIndices[activeIndex];
    const lastIndex = --this.activeCount;
    this.activeSlot[removed] = -1;
    if (activeIndex === lastIndex) return;
    const last = this.activeIndices[lastIndex];
    this.activeIndices[activeIndex] = last;
    this.activeSlot[last] = activeIndex;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
    this.activeSlot.fill(-1);
    this.activeCount = 0;
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -60;
    this._dynamicDirty = true;
  }

  _flushGpuUpdates() {
    const at = this.points.geometry.attributes;
    if (this._dynamicDirty) {
      at.position.needsUpdate = true;
      at.aSize.needsUpdate = true;
      at.aAlpha.needsUpdate = true;
      this._dynamicDirty = false;
    }
    if (this._seedDirty) {
      at.aSeed.needsUpdate = true;
      this._seedDirty = false;
    }
  }

  update(dt, wf = null) {
    this.time += dt;
    this.points.material.uniforms.uTime.value = this.time;
    if (this.activeCount === 0) return;
    const dragK = Math.max(0, 1 - this.drag * dt);
    for (let activeIndex = this.activeCount - 1; activeIndex >= 0; activeIndex--) {
      const i = this.activeIndices[activeIndex];
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -60;
        this.size[i] = 0;
        this.alpha[i] = 0;
        this._removeActiveAt(activeIndex);
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity * dt;
      if (this.turbulence > 0) {
        const age = this.maxLife[i] - this.life[i];
        const phase = this.seed[i] * 31.7 + age * (4.1 + this.seed[i] * 2.3);
        this.vel[i * 3] += Math.sin(phase) * this.turbulence * dt;
        this.vel[i * 3 + 2] += Math.cos(phase * 1.17) * this.turbulence * dt;
      }
      this.vel[i * 3] *= dragK; this.vel[i * 3 + 1] *= dragK; this.vel[i * 3 + 2] *= dragK;
      const x = this.pos[i * 3] += this.vel[i * 3] * dt;
      const y = this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      const z = this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (wf && this.vel[i * 3 + 1] < 0 && y < wf.heightAt(x, z) + 0.03) {
        this.life[i] = 0; this.pos[i * 3 + 1] = -60; this.size[i] = 0; this.alpha[i] = 0;
        this._removeActiveAt(activeIndex);
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      const ageN = 1 - t;
      const birth = this.fadeIn > 0 ? Math.min(ageN / this.fadeIn, 1) : 1;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      this.alpha[i] = this.alpha0[i] * birth * (t * t * (3 - 2 * t));
    }
    this._dynamicDirty = true;
  }

  exposureAt(point, radius, weight = 1) {
    const radiusSq = radius * radius;
    let density = 0;
    for (let activeIndex = 0; activeIndex < this.activeCount; activeIndex++) {
      const i = this.activeIndices[activeIndex];
      const offset = i * 3;
      const dx = this.pos[offset] - point.x;
      const dy = this.pos[offset + 1] - point.y;
      const dz = this.pos[offset + 2] - point.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq >= radiusSq) continue;
      const falloff = 1 - distanceSq / radiusSq;
      const particleWeight = 0.35 + Math.min(this.size0[i], 2.5) * 0.26;
      density += falloff * particleWeight * weight;
    }
    return density;
  }
}

class PropellerWash {
  constructor(scene, waveField, max = 1700) {
    this.wf = waveField;
    this.max = max;
    this.cursor = 0;
    this.time = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.activeIndices = new Int32Array(max);
    this.activeSlot = new Int32Array(max);
    this.activeSlot.fill(-1);
    this.activeCount = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -60;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeBubbleTexture() }, uTime: { value: 0 }, uRotation: { value: 0.22 } },
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    showInRefraction(this.points);
    this._dynamicDirty = false;
    this._seedDirty = false;
    this.points.onBeforeRender = () => this._flushGpuUpdates();
    scene.add(this.points);
    this.activeLimit = max;
  }

  setBudget(scale) {
    const next = Math.max(32, Math.floor(this.max * scale));
    if (next === this.activeLimit) return;
    this.activeLimit = next;
    this.cursor %= next;
    this.points.geometry.setDrawRange(0, next);
    this.clear();
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.activeSlot.fill(-1);
    this.activeCount = 0;
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -60;
    this._dynamicDirty = true;
  }

  spawn(p, flow, right, up, strength) {
    const i = this.cursor++ % this.activeLimit;
    if (this.activeSlot[i] < 0) {
      this.activeSlot[i] = this.activeCount;
      this.activeIndices[this.activeCount++] = i;
    }
    const a = Math.random() * Math.PI * 2;
    const radius = (0.035 + Math.random() * 0.16) * (0.75 + strength * 0.62);
    const radialX = Math.cos(a), radialY = Math.sin(a);
    const tangentX = -radialY, tangentY = radialX;
    const swirl = (0.55 + Math.random() * 1.45) * strength;
    const jet = 1.35 + strength * (3.4 + Math.random() * 3.1);
    const o = i * 3;
    this.pos[o] = p.x + right.x * radialX * radius + up.x * radialY * radius;
    this.pos[o + 1] = p.y + right.y * radialX * radius + up.y * radialY * radius;
    this.pos[o + 2] = p.z + right.z * radialX * radius + up.z * radialY * radius;
    this.vel[o] = flow.x * jet + right.x * tangentX * swirl + up.x * tangentY * swirl;
    this.vel[o + 1] = flow.y * jet + right.y * tangentX * swirl + up.y * tangentY * swirl + 0.05;
    this.vel[o + 2] = flow.z * jet + right.z * tangentX * swirl + up.z * tangentY * swirl;
    this.maxLife[i] = this.life[i] = 0.85 + Math.random() * (1.05 + strength * 0.7);
    this.seed[i] = Math.random();
    this.size[i] = 0.24 + Math.random() * 0.42 + strength * 0.18;
    this.alpha[i] = 0;
    this._dynamicDirty = true;
    this._seedDirty = true;
  }

  _removeActiveAt(activeIndex) {
    const removed = this.activeIndices[activeIndex];
    const lastIndex = --this.activeCount;
    this.activeSlot[removed] = -1;
    if (activeIndex === lastIndex) return;
    const last = this.activeIndices[lastIndex];
    this.activeIndices[activeIndex] = last;
    this.activeSlot[last] = activeIndex;
  }

  _flushGpuUpdates() {
    const at = this.points.geometry.attributes;
    if (this._dynamicDirty) {
      at.position.needsUpdate = true;
      at.aSize.needsUpdate = true;
      at.aAlpha.needsUpdate = true;
      this._dynamicDirty = false;
    }
    if (this._seedDirty) {
      at.aSeed.needsUpdate = true;
      this._seedDirty = false;
    }
  }

  update(dt) {
    this.time += dt;
    this.points.material.uniforms.uTime.value = this.time;
    if (this.activeCount === 0) return;
    for (let activeIndex = this.activeCount - 1; activeIndex >= 0; activeIndex--) {
      const i = this.activeIndices[activeIndex];
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -60;
        this.alpha[i] = 0;
        this._removeActiveAt(activeIndex);
        continue;
      }
      const age = this.maxLife[i] - this.life[i];
      const phase = this.seed[i] * 37 + age * 8.5;
      this.vel[o] += Math.sin(phase) * 0.22 * dt;
      this.vel[o + 2] += Math.cos(phase * 1.13) * 0.22 * dt;
      this.vel[o + 1] += 0.13 * dt;
      const drag = Math.max(0, 1 - 0.48 * dt);
      this.vel[o] *= drag; this.vel[o + 1] *= drag; this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const water = this.wf.heightAt(this.pos[o], this.pos[o + 2]);
      if (this.pos[o + 1] > water - 0.015) {
        this.life[i] = 0; this.pos[o + 1] = -60; this.alpha[i] = 0;
        this._removeActiveAt(activeIndex);
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      const appear = Math.min(age / 0.07, 1);
      this.alpha[i] = appear * Math.min(1, t * 2.5) * (0.3 + this.seed[i] * 0.32);
      this.size[i] *= 1 + dt * 0.12;
    }
    this._dynamicDirty = true;
  }
}

function makeFlameGeometry(seed = 1) {
  const radialSegments = 12;
  const rings = [
    { z: 0, radius: 0.34 },
    { z: -0.1, radius: 0.72 },
    { z: -0.24, radius: 1 },
    { z: -0.43, radius: 0.68 },
    { z: -0.61, radius: 0.86 },
    { z: -0.79, radius: 0.4 },
    { z: -1, radius: 0.035 },
  ];
  const positions = [];
  const indices = [];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex];
    const along = ringIndex / (rings.length - 1);
    const drift = along * (0.055 + seed * 0.004);
    const cx = Math.sin(seed * 2.17 + ringIndex * 1.83) * drift;
    const cy = Math.cos(seed * 1.41 + ringIndex * 2.29) * drift;
    for (let i = 0; i < radialSegments; i++) {
      const angle = i / radialSegments * Math.PI * 2;
      const roughness = 1
        + Math.sin(angle * 3 + seed * 1.7 + ringIndex * 2.1) * 0.14
        + Math.sin(angle * 5 - seed * 0.9 + ringIndex * 0.7) * 0.08;
      positions.push(
        cx + Math.cos(angle) * ring.radius * roughness,
        cy + Math.sin(angle) * ring.radius * roughness,
        ring.z,
      );
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      const a = ring * radialSegments + i;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + i;
      const d = (ring + 1) * radialSegments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const FLAME_VERT = /* glsl */`
  varying float vAlong;
  varying float vAngle;
  void main() {
    vAlong = clamp(-position.z, 0.0, 1.0);
    vAngle = atan(position.y, position.x);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSeed;
  uniform vec3 uHot;
  uniform vec3 uCool;
  varying float vAlong;
  varying float vAngle;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float fast = sin(vAlong * 43.0 - uTime * 57.0 + vAngle * 3.0 + uSeed * 2.7);
    float torn = sin(vAlong * 21.0 + uTime * 31.0 - vAngle * 5.0 + uSeed * 4.1);
    float coarse = sin(vAlong * 9.0 - uTime * 19.0 + vAngle * 2.0 - uSeed);
    float noise = fast * 0.28 + torn * 0.24 + coarse * 0.18;
    float grain = hash21(vec2(floor(vAlong * 29.0), floor((vAngle + 3.2) * 8.0) + uSeed));
    float root = smoothstep(0.0, 0.025, vAlong);
    float tip = 1.0 - smoothstep(0.7, 1.0, vAlong);
    float breakup = smoothstep(-0.45, 0.48, noise + (1.0 - vAlong) * 0.22);
    float alpha = uOpacity * root * tip * (0.28 + breakup * 0.72);
    if (alpha < 0.055 + grain * mix(0.015, 0.12, vAlong)) discard;
    float heat = smoothstep(0.08, 0.9, vAlong + noise * 0.09);
    vec3 color = mix(uHot, uCool, heat);
    color *= 1.0 + fast * 0.08 + (1.0 - vAlong) * 0.16;
    gl_FragColor = vec4(color, alpha);
  }
`;

class ExhaustFlames {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'racer-exhaust-flames';
    this.group.visible = false;
    parent.add(this.group);

    const layers = [
      { hot: 0xffa01c, cool: 0xa80800, opacity: 0.38, radius: 0.36, length: 1.85 },
      { hot: 0xfff09a, cool: 0xff4b06, opacity: 0.62, radius: 0.23, length: 1.42 },
      { hot: 0xffffea, cool: 0xffb322, opacity: 0.86, radius: 0.105, length: 0.92 },
    ];
    this.ports = Array.from({ length: 2 }, (_, portIndex) => {
      const port = new THREE.Group();
      port.name = `racer-exhaust-flame-${portIndex + 1}`;
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];
        const seed = 1 + portIndex * 5.3 + layerIndex * 2.7;
        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
            uSeed: { value: seed },
            uHot: { value: new THREE.Color(layer.hot) },
            uCool: { value: new THREE.Color(layer.cool) },
          },
          vertexShader: FLAME_VERT,
          fragmentShader: FLAME_FRAG,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(makeFlameGeometry(seed), material);
        mesh.userData.flame = { ...layer, seed };
        // Keep exhaust fire out of the planar water pass: its saturated additive
        // color otherwise becomes a detached orange streak below the hull.
        port.add(mesh);
      }
      this.group.add(port);
      return port;
    });
    this.lights = Array.from({ length: 2 }, (_, index) => {
      const light = new THREE.PointLight(0xff641c, 0, 2.8, 2.4);
      light.name = `racer-exhaust-light-${index + 1}`;
      this.group.add(light);
      return light;
    });
  }

  update(points, strength, time) {
    const visible = Array.isArray(points) && points.length >= 2 && strength > 0.015;
    this.group.visible = visible;
    if (!visible) {
      for (const light of this.lights) light.intensity = 0;
      return;
    }
    for (let i = 0; i < this.ports.length; i++) {
      const port = this.ports[i];
      port.position.fromArray(points[i]);
      const sideFlicker = 0.68 + Math.random() * 0.34
        + Math.sin(time * (47 + i * 9) + i * 1.7) * 0.13
        + Math.sin(time * 19.3 - i * 2.1) * 0.08;
      for (const mesh of port.children) {
        const layer = mesh.userData.flame;
        const energy = Math.max(0.02, strength * sideFlicker);
        const phase = time * (31 + layer.seed * 1.7) + layer.seed;
        const radius = layer.radius * (0.7 + energy * 0.62)
          * (0.9 + Math.sin(phase * 0.73) * 0.1);
        const length = layer.length * energy
          * (0.74 + Math.sin(phase) * 0.16 + Math.sin(phase * 1.91) * 0.1);
        mesh.scale.set(radius, radius * (0.82 + Math.sin(phase * 1.37) * 0.1), length);
        mesh.rotation.z = Math.sin(phase * 0.61) * 0.22 + Math.sin(phase * 1.73) * 0.08;
        mesh.material.uniforms.uTime.value = time;
        mesh.material.uniforms.uOpacity.value = layer.opacity * Math.min(1, energy * 1.18);
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      light.position.set(points[i][0], points[i][1] + 0.02, points[i][2] - 0.28);
      const independentFlicker = 0.74 + Math.random() * 0.24
        + Math.sin(time * (39 + i * 8) + i * 2.3) * 0.08;
      light.intensity = 2.35 * strength * independentFlicker;
    }
  }

  clear() {
    this.group.visible = false;
    for (const light of this.lights) light.intensity = 0;
  }
}

export class BoatEffects {
  constructor(scene, waveField, boat) {
    this.boat = boat;
    this.wf = waveField;
    this.droplets = new ParticleSystem(scene, 1600, makeDropletTexture(),
      { gravity: 9.81, drag: 0.55, turbulence: 0.18, rotation: 0.7 });
    this.mist = new ParticleSystem(scene, 400, makeMistTexture(),
      { gravity: 0.9, drag: 1.6, turbulence: 0.4, rotation: 0.18, fadeIn: 0.12 });
    this.impactFoam = new ParticleSystem(scene, 1200, makeImpactFoamTexture(),
      { gravity: 4.8, drag: 0.95, turbulence: 1.15, rotation: 1.4, fadeIn: 0.07 });
    this.wakeFoam = new ParticleSystem(scene, 900, makeImpactFoamTexture(),
      { gravity: 2.4, drag: 1.25, turbulence: 0.5, rotation: 0.55, fadeIn: 0.05 });
    this.turnSheet = new ParticleSystem(scene, 2600, makeImpactFoamTexture(),
      { gravity: 6.4, drag: 0.38, turbulence: 1.45, rotation: 1.1, fadeIn: 0.025 });
    this.turnMist = new ParticleSystem(scene, 1200, makeMistTexture(),
      { gravity: 0.65, drag: 0.72, turbulence: 1.35, rotation: 0.34, fadeIn: 0.04 });
    this.turnSheet.points.renderOrder = 5;
    this.roosterTail = new ParticleSystem(scene, 3800, makeImpactFoamTexture(),
      { gravity: 5.2, drag: 0.22, turbulence: 0.9, rotation: 0.38, fadeIn: 0.025 });
    this.roosterMist = new ParticleSystem(scene, 1400, makeMistTexture(),
      { gravity: 0.42, drag: 0.52, turbulence: 1.1, rotation: 0.27, fadeIn: 0.045 });
    this.exhaustSmoke = new ParticleSystem(scene, 500, makeSmokeTexture(),
      { gravity: -0.18, drag: 1.15, turbulence: 0.55, rotation: 0.14, fadeIn: 0.08 });
    this.exhaustSparks = new ParticleSystem(scene, 650, makeSparkTexture(),
      { gravity: 0.75, drag: 0.7, turbulence: 0.32, rotation: 1.8, fadeIn: 0.02 });
    this.propWash = new PropellerWash(scene, waveField);
    this.exhaustFlames = new ExhaustFlames(boat.group || scene);
    this._bowAcc = 0;
    this._bowMistAcc = 0;
    this._sternAcc = 0;
    this._sternMistAcc = 0;
    this._wakeFoamAcc = 0;
    this._turnSprayAcc = 0;
    this._turnFoamAcc = 0;
    this._turnSheetAcc = 0;
    this._turnMistAcc = 0;
    this._turnBlastAcc = 0;
    this._turnBlastMistAcc = 0;
    this._turnPulse = 1;
    this._turnPulseTarget = 1;
    this._turnPulseTimer = 0;
    this._turnPrevOrigin = new THREE.Vector3();
    this._turnCurrentOrigin = new THREE.Vector3();
    this._turnOriginValid = false;
    this._propAcc = 0;
    this._roosterAcc = 0;
    this._roosterMistAcc = 0;
    this._exhaustSmokeAcc = 0;
    this._exhaustSparkAcc = 0;
    this._propPositions = [];
    this._bowContacts = [];
    this._up = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._waterVel = new THREE.Vector3();
    this._relVel = new THREE.Vector3();
    this._lastSpec = boat.spec.id;
    this.turnEnergy = 0;
    this.turnViolence = 0;
    this._impactCooldown = 0;
    this._impactQueue = [];
    this._effectTime = 0;
    this._lastForwardSpeed = 0;
    this._exhaustPopTimer = 0;
    this._exhaustBurstTime = 0;
    this._exhaustBurstDuration = 0.1;
    this._exhaustBurstStrength = 0;
    this._exhaustWorld = new THREE.Vector3();
    this._roosterPrevOrigin = new THREE.Vector3();
    this._roosterOriginValid = false;
    this._roosterPulse = 1;
    this._roosterPulseTarget = 1;
    this._roosterPulseTimer = 0;
    this._roosterSideBias = 0;
    this.onExhaustPop = null;
  }

  setPerformanceBudget({ particleScale = 1 } = {}) {
    this.droplets.setBudget(particleScale);
    this.mist.setBudget(particleScale);
    this.impactFoam.setBudget(particleScale);
    this.wakeFoam.setBudget(particleScale);
    const racerScale = Math.max(0.35, particleScale);
    const turnScale = this.boat.spec.id === 'boat'
      ? Math.max(0.45, particleScale) : particleScale;
    this.turnSheet.setBudget(turnScale);
    this.turnMist.setBudget(turnScale);
    this.roosterTail.setBudget(racerScale);
    this.roosterMist.setBudget(racerScale);
    this.exhaustSmoke.setBudget(particleScale);
    this.exhaustSparks.setBudget(particleScale);
    this.propWash.setBudget(particleScale);
  }

  cameraSprayExposure(position) {
    const density =
      this.droplets.exposureAt(position, 1.05, 1.15)
      + this.mist.exposureAt(position, 2.4, 0.62)
      + this.turnSheet.exposureAt(position, 1.45, 1.2)
      + this.turnMist.exposureAt(position, 2.8, 0.72)
      + this.roosterTail.exposureAt(position, 1.5, 1.3)
      + this.roosterMist.exposureAt(position, 3.1, 0.78);
    return THREE.MathUtils.clamp(1 - Math.exp(-density * 0.42), 0, 1);
  }

  _burst(p, right, fwd, base, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const m = 1 + Math.random() * 2.5;
      this.droplets.spawn(
        p.x + (Math.random() - 0.5) * 0.8, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.8,
        base.x + Math.cos(a) * m, 1.6 + Math.random() * 2.4 + speed * 0.06,
        base.z + Math.sin(a) * m,
        0.6 + Math.random() * 0.6, 0.5 + Math.random() * 0.7, 0.75, 0.6,
      );
    }
  }

  _updateRacerExhaust(dt, boat, forwardSpeed, exhausts) {
    if (!Array.isArray(exhausts) || exhausts.length < 2 || dt <= 0) {
      this.exhaustFlames.clear();
      this._lastForwardSpeed = forwardSpeed;
      return;
    }
    const throttle = Math.max(boat.throttle, 0);
    const speedNorm = THREE.MathUtils.clamp(
      forwardSpeed / Math.max(boat.spec.maxPropSpeed, 1), 0, 1,
    );
    const acceleration = THREE.MathUtils.clamp(
      (forwardSpeed - this._lastForwardSpeed) / Math.max(dt, 1 / 240) / 5.5,
      0, 1,
    );
    this._lastForwardSpeed = forwardSpeed;
    const load = THREE.MathUtils.clamp(
      throttle * (0.3 + (1 - speedNorm) * 0.7) + acceleration * 0.7,
      0, 1,
    );

    this._exhaustBurstTime = Math.max(0, this._exhaustBurstTime - dt);
    this._exhaustPopTimer -= dt;
    if (throttle > 0.32 && load > 0.28 && this._exhaustPopTimer <= 0) {
      this._exhaustBurstDuration = 0.055 + Math.random() * (0.09 + load * 0.12);
      this._exhaustBurstTime = this._exhaustBurstDuration;
      this._exhaustBurstStrength = 0.55 + load * 0.8 + Math.random() * 0.32;
      this._exhaustPopTimer = (0.075 + Math.random() * 0.3) / (0.7 + load * 0.7);
      this._p.fromArray(exhausts[0]).lerp(this._v.fromArray(exhausts[1]), 0.5);
      boat.worldPoint(this._p, this._exhaustWorld);
      this.onExhaustPop?.(this._exhaustBurstStrength, this._exhaustWorld);
    }
    if (throttle <= 0.16) this._exhaustPopTimer = 0;

    const age = 1 - this._exhaustBurstTime / Math.max(this._exhaustBurstDuration, 0.001);
    const envelope = this._exhaustBurstTime > 0
      ? Math.max(0.28, Math.sin(Math.min(1, age) * Math.PI) ** 0.42) : 0;
    this.exhaustFlames.update(
      exhausts,
      this._exhaustBurstStrength * envelope,
      this._effectTime,
    );
    const flameEnergy = this._exhaustBurstStrength * envelope;
    if (flameEnergy > 0.06) {
      this._exhaustSmokeAcc += dt * (12 + flameEnergy * 58);
    } else {
      this._exhaustSmokeAcc = 0;
    }
    while (this._exhaustSmokeAcc >= 1 && flameEnergy > 0.06) {
      this._exhaustSmokeAcc -= 1;
      const exhaust = exhausts[Math.floor(Math.random() * exhausts.length)];
      this._p.fromArray(exhaust);
      boat.worldPoint(this._p, this._exhaustWorld);
      const backward = 0.6 + Math.random() * 2.3;
      const sideways = (Math.random() - 0.5) * 0.8;
      this.exhaustSmoke.spawn(
        this._exhaustWorld.x - this._f.x * Math.random() * 0.3,
        this._exhaustWorld.y + (Math.random() - 0.5) * 0.16,
        this._exhaustWorld.z - this._f.z * Math.random() * 0.3,
        boat.vel.x * 0.42 - this._f.x * backward + this._r.x * sideways,
        0.16 + Math.random() * 0.52,
        boat.vel.z * 0.42 - this._f.z * backward + this._r.z * sideways,
        0.48 + Math.random() * 0.62,
        0.32 + Math.random() * 0.58,
        0.07 + Math.random() * 0.1,
        1.1 + Math.random() * 1.1,
      );
    }
    if (flameEnergy > 0.18) this._exhaustSparkAcc += dt * (18 + flameEnergy * 85);
    else this._exhaustSparkAcc = 0;
    while (this._exhaustSparkAcc >= 1 && flameEnergy > 0.18) {
      this._exhaustSparkAcc -= 1;
      const exhaust = exhausts[Math.floor(Math.random() * exhausts.length)];
      this._p.fromArray(exhaust);
      boat.worldPoint(this._p, this._exhaustWorld);
      const backward = 3.5 + Math.random() * 9;
      const sideways = (Math.random() - 0.5) * 1.8;
      this.exhaustSparks.spawn(
        this._exhaustWorld.x - this._f.x * Math.random() * 0.18,
        this._exhaustWorld.y + (Math.random() - 0.5) * 0.12,
        this._exhaustWorld.z - this._f.z * Math.random() * 0.18,
        boat.vel.x * 0.48 - this._f.x * backward + this._r.x * sideways,
        (Math.random() - 0.35) * 1.5,
        boat.vel.z * 0.48 - this._f.z * backward + this._r.z * sideways,
        0.14 + Math.random() * 0.34,
        0.055 + Math.random() * 0.16,
        0.48 + Math.random() * 0.44,
        -0.35,
      );
    }
  }

  _emitRoosterTail(dt, boat, forwardSpeed, config) {
    if (!config || dt <= 0) {
      this._roosterAcc = 0;
      this._roosterMistAcc = 0;
      this._roosterOriginValid = false;
      return;
    }
    const speedStart = config.speedStart ?? 7;
    const speedEnergy = THREE.MathUtils.smoothstep(
      forwardSpeed, speedStart,
      Math.max(speedStart + 1, config.speedFull ?? boat.spec.maxPropSpeed * 0.82),
    );
    const drive = THREE.MathUtils.clamp(
      0.32 + Math.max(boat.throttle, 0) * 0.68,
      0, 1,
    );
    const wet = THREE.MathUtils.clamp(Math.max(boat.propWet, boat.wet * 1.8), 0.35, 1);
    const energy = speedEnergy * drive * wet;
    if (energy < 0.015) {
      this._roosterAcc = 0;
      this._roosterMistAcc = 0;
      this._roosterOriginValid = false;
      return;
    }

    this._p.fromArray(config.origin || [0, -boat.spec.restDraft, -boat.spec.length * 0.48]);
    boat.worldPoint(this._p, this._v);
    if (!this._roosterOriginValid) {
      this._roosterPrevOrigin.copy(this._v);
      this._roosterOriginValid = true;
    }
    const waterY = this.wf.heightAt(this._v.x, this._v.z);
    const rate = config.rate ?? 1;
    const velocityScale = config.velocity ?? 1;
    const sizeScale = config.size ?? 1;
    this._roosterPulseTimer -= dt;
    if (this._roosterPulseTimer <= 0) {
      this._roosterPulseTarget = 0.55 + Math.random() * 1.15;
      if (Math.random() < 0.24) this._roosterPulseTarget *= 1.35;
      this._roosterSideBias = (Math.random() - 0.5) * 0.9;
      this._roosterPulseTimer = 0.05 + Math.random() * 0.22;
    }
    this._roosterPulse += (this._roosterPulseTarget - this._roosterPulse)
      * (1 - Math.exp(-dt * 12));
    const pulse = this._roosterPulse;
    this._roosterAcc += dt * (180 + forwardSpeed * 46) * energy * rate * pulse;
    while (this._roosterAcc >= 1) {
      this._roosterAcc -= 1;
      const core = Math.random() < 0.68;
      const backward = (core
        ? 7 + Math.random() * (8 + energy * 10)
        : 4 + Math.random() * (14 + energy * 17)) * velocityScale;
      const upward = (3.4 + Math.pow(Math.random(), 0.58) * (7 + energy * 11))
        * (config.height ?? 1) * (0.82 + pulse * 0.18);
      const sideways = ((Math.random() - 0.5) * (core ? 3.2 : 11)
        + this._roosterSideBias * (core ? 1.2 : 3.5)) * (config.spread ?? 1);
      const across = (Math.random() - 0.5) * boat.spec.beam * (core ? 0.4 : 0.82);
      const behind = Math.random() * (core ? 0.42 : 0.95);
      const travel = Math.random();
      const originX = THREE.MathUtils.lerp(this._roosterPrevOrigin.x, this._v.x, travel);
      const originY = THREE.MathUtils.lerp(this._roosterPrevOrigin.y, this._v.y, travel);
      const originZ = THREE.MathUtils.lerp(this._roosterPrevOrigin.z, this._v.z, travel);
      this.roosterTail.spawn(
        originX + this._r.x * across - this._f.x * behind,
        Math.max(waterY, originY) + 0.08 + Math.random() * 0.22,
        originZ + this._r.z * across - this._f.z * behind,
        boat.vel.x * 0.07 - this._f.x * backward + this._r.x * sideways,
        upward,
        boat.vel.z * 0.07 - this._f.z * backward + this._r.z * sideways,
        1.35 + Math.random() * (0.95 + energy * 1.15),
        (core ? 1.1 + Math.random() * 1.7 : 0.55 + Math.random() * 1.45)
          * (0.9 + energy * 0.78) * sizeScale,
        core ? 0.25 + Math.random() * 0.24 : 0.14 + Math.random() * 0.2,
        (0.88 + Math.random() * 1.3) * sizeScale,
      );
    }

    this._roosterMistAcc += dt * (95 + forwardSpeed * 5.5) * energy * rate
      * (0.82 + pulse * 0.28);
    while (this._roosterMistAcc >= 1) {
      this._roosterMistAcc -= 1;
      const across = (Math.random() - 0.5) * boat.spec.beam * 0.74;
      const backward = (4.5 + Math.random() * (8 + energy * 8)) * velocityScale;
      const sideways = ((Math.random() - 0.5) * (4 + energy * 8)
        + this._roosterSideBias * 2.2) * (config.spread ?? 1);
      const travel = Math.random();
      const originX = THREE.MathUtils.lerp(this._roosterPrevOrigin.x, this._v.x, travel);
      const originY = THREE.MathUtils.lerp(this._roosterPrevOrigin.y, this._v.y, travel);
      const originZ = THREE.MathUtils.lerp(this._roosterPrevOrigin.z, this._v.z, travel);
      this.roosterMist.spawn(
        originX + this._r.x * across - this._f.x * Math.random() * 0.8,
        Math.max(waterY, originY) + 0.18 + Math.random() * 0.58,
        originZ + this._r.z * across - this._f.z * Math.random() * 0.8,
        boat.vel.x * 0.09 - this._f.x * backward + this._r.x * sideways,
        (2.4 + Math.random() * (4.5 + energy * 5.5)) * (config.height ?? 1),
        boat.vel.z * 0.09 - this._f.z * backward + this._r.z * sideways,
        1.05 + Math.random() * 1.5,
        (0.72 + Math.random() * 1.45) * (0.86 + energy * 0.34) * sizeScale,
        0.045 + Math.random() * 0.075,
        (1.1 + Math.random() * 1.05) * sizeScale,
      );
    }
    this._roosterPrevOrigin.copy(this._v);
  }

  update(dt) {
    const b = this.boat;
    if (this._lastSpec !== b.spec.id) {
      this.droplets.clear();
      this.mist.clear();
      this.impactFoam.clear();
      this.wakeFoam.clear();
      this.turnSheet.clear();
      this.turnMist.clear();
      this.roosterTail.clear();
      this.roosterMist.clear();
      this.exhaustSmoke.clear();
      this.exhaustSparks.clear();
      this.propWash.clear();
      this.exhaustFlames.clear();
      this._impactQueue.length = 0;
      this._bowAcc = this._bowMistAcc = this._sternAcc = 0;
      this._sternMistAcc = this._wakeFoamAcc = this._propAcc = 0;
      this._roosterAcc = this._roosterMistAcc = 0;
      this._exhaustSmokeAcc = this._exhaustSparkAcc = 0;
      this._turnSprayAcc = this._turnFoamAcc = 0;
      this._turnSheetAcc = this._turnMistAcc = 0;
      this._turnBlastAcc = this._turnBlastMistAcc = 0;
      this._turnPulse = this._turnPulseTarget = 1;
      this._turnPulseTimer = 0;
      this._turnOriginValid = false;
      this._lastForwardSpeed = 0;
      this._exhaustPopTimer = this._exhaustBurstTime = 0;
      this._roosterPulse = this._roosterPulseTarget = 1;
      this._roosterPulseTimer = 0;
      this._roosterOriginValid = false;
      this._lastSpec = b.spec.id;
    }
    const speed = b.speedKn / 1.94384;
    const fx = b.spec.effects;
    this.droplets.update(dt, this.wf);
    this.mist.update(dt);
    this.impactFoam.update(dt);
    this.wakeFoam.update(dt);
    this.turnSheet.update(dt, this.wf);
    this.turnMist.update(dt);
    this.roosterTail.update(dt, this.wf);
    this.roosterMist.update(dt);
    this.exhaustSmoke.update(dt);
    this.exhaustSparks.update(dt);
    this.propWash.update(dt);
    this._effectTime += dt;
    this._impactCooldown = Math.max(0, this._impactCooldown - dt);

    this._r.set(1, 0, 0).applyQuaternion(b.quat);
    this._f.set(0, 0, 1).applyQuaternion(b.quat);
    this._up.set(0, 1, 0).applyQuaternion(b.quat);
    this.wf.velocityAt(b.pos.x, b.pos.z, this._waterVel);
    this._relVel.copy(b.vel).sub(this._waterVel);
    const forwardSpeed = Math.max(0, this._relVel.dot(this._f));
    this._updateRacerExhaust(dt, b, forwardSpeed, fx.exhausts);
    this._emitRoosterTail(dt, b, forwardSpeed, fx.roosterTail);

    // Prefer detected model propeller hubs; use the hydrodynamic anchor as fallback.
    const rigProps = b.visualRig?.getPropellerWorldPositions(this._propPositions);
    if (!rigProps?.length) {
      this._propPositions.length = 1;
      this._propPositions[0] ||= new THREE.Vector3();
      b.worldPoint(fx.prop, this._propPositions[0]);
    }

    const propPower = Math.abs(b.throttle) * b.propWet;
    if (propPower > 0.035) {
      const speedFactor = THREE.MathUtils.clamp(speed / Math.max(b.spec.maxPropSpeed, 1), 0, 1);
      const intensity = THREE.MathUtils.clamp(propPower * (0.72 + speedFactor * 0.55), 0, 1.25);
      this._v.copy(this._f).multiplyScalar(b.throttle >= 0 ? -1 : 1).normalize();
      this._propAcc += dt * (30 + 255 * intensity * intensity) * this._propPositions.length;
      while (this._propAcc >= 1) {
        this._propAcc -= 1;
        const p = this._propPositions[Math.floor(Math.random() * this._propPositions.length)];
        const waterY = this.wf.heightAt(p.x, p.z);
        if (p.y < waterY - 0.015) this.propWash.spawn(p, this._v, this._r, this._up, intensity);
      }
    }

    for (let i = this._impactQueue.length - 1; i >= 0; i--) {
      const q = this._impactQueue[i];
      q.delay -= dt;
      if (q.delay > 0) continue;
      this.impactFoam.spawn(q.x, q.y, q.z, q.vx, q.vy, q.vz,
        q.life, q.size, q.alpha, q.grow);
      this._impactQueue.splice(i, 1);
    }

    this._bowContacts.length = 0;
    if (forwardSpeed > 2.2) {
      for (const contact of b.spec.buoyPoints) {
        if (contact.p.z < b.spec.length * 0.08) continue;
        b.worldPoint(contact.p, this._p);
        const depth = this.wf.heightAt(this._p.x, this._p.z) - this._p.y;
        if (depth > 0 && depth < b.spec.restDraft * 2.4) {
          this._bowContacts.push(contact);
        }
      }
    }
    if (this._bowContacts.length) {
      const contactGain = THREE.MathUtils.clamp(b.wet * 1.8, 0.2, 1);
      this._bowAcc += dt * (forwardSpeed - 2.2) * 2.2 * contactGain;
      while (this._bowAcc >= 1) {
        this._bowAcc -= 1;
        const contact = this._bowContacts[
          Math.floor(Math.random() * this._bowContacts.length)
        ];
        const side = Math.sign(contact.p.x) || (Math.random() < 0.5 ? -1 : 1);
        b.worldPoint(contact.p, this._p);
        const waterY = this.wf.heightAt(this._p.x, this._p.z);
        const across = (Math.random() - 0.5) * b.spec.beam * 0.09;
        const along = (Math.random() - 0.5) * b.spec.length * 0.055;
        const outward = side * (0.35 + Math.random() * 0.8 + forwardSpeed * 0.035);
        this.droplets.spawn(
          this._p.x + this._r.x * across + this._f.x * along,
          waterY + 0.025,
          this._p.z + this._r.z * across + this._f.z * along,
          b.vel.x * 0.56 + this._r.x * outward - this._f.x * Math.random() * 0.45,
          0.4 + Math.random() * 0.85 + forwardSpeed * 0.035,
          b.vel.z * 0.56 + this._r.z * outward - this._f.z * Math.random() * 0.45,
          0.28 + Math.random() * 0.32,
          (0.16 + Math.random() * 0.34) * (1 + forwardSpeed * 0.018),
          0.34 + Math.random() * 0.3,
          0.45,
        );
      }
      this._bowMistAcc += dt * Math.max(0, forwardSpeed - 5) * 0.32 * contactGain;
      while (this._bowMistAcc >= 1) {
        this._bowMistAcc -= 1;
        const contact = this._bowContacts[
          Math.floor(Math.random() * this._bowContacts.length)
        ];
        const side = Math.sign(contact.p.x) || 1;
        b.worldPoint(contact.p, this._p);
        const waterY = this.wf.heightAt(this._p.x, this._p.z);
        this.mist.spawn(
          this._p.x, waterY + 0.1, this._p.z,
          b.vel.x * 0.42 + this._r.x * side * 0.65,
          0.35 + Math.random() * 0.5,
          b.vel.z * 0.42 + this._r.z * side * 0.65,
          0.42 + Math.random() * 0.38, 0.42 + Math.random() * 0.48,
          0.055, 0.75,
        );
      }
    }

    const steerAmount = THREE.MathUtils.clamp(
      Math.abs(b._effSteer) / Math.max(b.spec.maxSteerRad, 0.001), 0, 1,
    );
    const yawAmount = THREE.MathUtils.clamp(
      Math.abs(b.angVelB.y) * b.spec.length / Math.max(forwardSpeed, 1.2), 0, 1,
    );
    const turnAmount = THREE.MathUtils.clamp(Math.max(
      Math.abs(b.steer) * 0.58,
      steerAmount,
      yawAmount * 1.35,
    ), 0, 1);
    const turnSpeed = THREE.MathUtils.smoothstep(
      forwardSpeed, 1.2, Math.max(4.5, b.spec.maxPropSpeed * 0.56),
    );
    // A planing hull can report dry buoyancy points while its drive still throws water.
    const turnWet = THREE.MathUtils.clamp(Math.max(
      b.wet * 2.2,
      b.propWet * 0.92,
    ), 0, 1);
    const turnEnergy = THREE.MathUtils.clamp(
      turnSpeed * Math.pow(turnAmount, 0.68) * turnWet, 0, 1,
    );
    const wallSpeed = Math.sqrt(THREE.MathUtils.clamp(
      (forwardSpeed - 0.8) / 102.2, 0, 1,
    ));
    const wallEnergy = Math.pow(wallSpeed, 0.9)
      * Math.pow(turnAmount, 0.55) * turnWet;
    this.turnEnergy = turnEnergy;
    if (turnEnergy > 0.025 || wallEnergy > 0.006) {
      const outsideSide = Math.abs(b.angVelB.y) > 0.018
        ? -Math.sign(b.angVelB.y)
        : (Math.sign(b.steer) || 1);
      const speedBoost = turnSpraySpeedBoost(forwardSpeed);
      const highSpeed = (speedBoost - 1) / 3;
      this._turnPulseTimer -= dt;
      if (this._turnPulseTimer <= 0) {
        this._turnPulseTarget = 0.68 + Math.random() * 0.78;
        this._turnPulseTimer = 0.055 + Math.random() * 0.13;
      }
      this._turnPulse += (this._turnPulseTarget - this._turnPulse)
        * (1 - Math.exp(-dt * 14));
      const pulse = 1 + highSpeed * (this._turnPulse - 1);
      const turnViolence = turnEnergy * speedBoost * pulse;
      this.turnViolence = Math.max(turnViolence, wallEnergy);

      this._p.set(
        outsideSide * b.spec.beam * 0.46,
        -b.spec.restDraft * 0.18,
        0,
      );
      b.worldPoint(this._p, this._turnCurrentOrigin);
      if (!this._turnOriginValid) {
        this._turnPrevOrigin.copy(this._turnCurrentOrigin);
        this._turnOriginValid = true;
      }
      const spawnTurnPoint = (out, alongJitter = 1) => {
        this._p.set(
          outsideSide * b.spec.beam * (0.41 + Math.random() * 0.08),
          -b.spec.restDraft * 0.18,
          b.spec.length * (-0.24 + Math.random() * 0.46 * alongJitter),
        );
        b.worldPoint(this._p, out);
        // Fill the distance travelled since the last frame. At 200 kn the boat
        // advances ~1.7 m per 60 Hz frame, otherwise spray appears in slices.
        this._v.copy(out).sub(this._turnCurrentOrigin);
        out.copy(this._turnPrevOrigin).lerp(
          this._turnCurrentOrigin, Math.random(),
        ).add(this._v);
        out.y = this.wf.heightAt(out.x, out.z);
      };

      // This ballistic sheet exists at every moving speed. Its continuous
      // speed curve grows from a low chine wash into a 150-200 kn water wall.
      const blastEnergy = wallEnergy;
      this._turnBlastAcc += dt * (28 + forwardSpeed * 55)
        * blastEnergy * pulse;
      while (this._turnBlastAcc >= 1) {
        this._turnBlastAcc -= 1;
        spawnTurnPoint(this._p, 1.2);
        const fan = Math.pow(Math.random(), 0.72);
        const outward = outsideSide * (
          1 + wallSpeed * 7
          + forwardSpeed * (0.06 + fan * (0.07 + wallSpeed * 0.16))
          + Math.random() * (1 + wallSpeed * 7)
        );
        const carry = 0.77 + wallSpeed * 0.14 + Math.random() * 0.055;
        this.turnSheet.spawn(
          this._p.x, this._p.y + 0.06 + Math.random() * 0.18, this._p.z,
          b.vel.x * carry + this._r.x * outward
            - this._f.x * Math.random() * 0.7,
          0.45 + wallSpeed * (2.8 + Math.random() * (4.5 + highSpeed * 8)),
          b.vel.z * carry + this._r.z * outward
            - this._f.z * Math.random() * 0.7,
          0.36 + wallSpeed * 0.18 + Math.random() * (0.22 + wallSpeed * 0.28),
          (0.3 + Math.random() * 1.4)
            * (0.75 + wallSpeed + highSpeed * 0.45),
          0.3 + Math.random() * 0.28,
          0.55 + Math.random() * 0.6,
        );
      }

      this._turnBlastMistAcc += dt * (8 + forwardSpeed * 8.5)
        * blastEnergy * pulse;
      while (this._turnBlastMistAcc >= 1) {
        this._turnBlastMistAcc -= 1;
        spawnTurnPoint(this._p, 1.1);
        const outward = outsideSide * (
          0.8 + wallSpeed * 4
          + forwardSpeed * (0.035 + Math.random() * 0.055 * wallSpeed)
        );
        const carry = 0.78 + wallSpeed * 0.12 + Math.random() * 0.06;
        this.turnMist.spawn(
          this._p.x, this._p.y + 0.15 + Math.random() * 0.45, this._p.z,
          b.vel.x * carry + this._r.x * outward,
          0.35 + wallSpeed * (2.2 + Math.random() * (2.8 + highSpeed * 3.7)),
          b.vel.z * carry + this._r.z * outward,
          0.5 + wallSpeed * 0.3 + Math.random() * 0.65,
          (0.45 + Math.random() * 1.55) * (0.8 + wallSpeed * 0.7),
          0.055 + Math.random() * 0.075,
          1.2 + Math.random() * 0.9,
        );
      }

      this._turnSprayAcc += dt * (19 + forwardSpeed * 11) * turnViolence;
      while (this._turnSprayAcc >= 1) {
        this._turnSprayAcc -= 1;
        spawnTurnPoint(this._p);
        const outward = outsideSide * (
          1.2 + Math.random() * (1.6 + turnEnergy * 5.8)
          + forwardSpeed * (0.11 + highSpeed * 0.1)
        );
        const backward = 0.08 + Math.random() * (0.32 + turnEnergy * 0.72);
        const forwardCarry = THREE.MathUtils.lerp(
          0.72 + Math.random() * 0.14,
          0.88 + Math.random() * 0.08,
          highSpeed,
        );
        this.droplets.spawn(
          this._p.x, this._p.y + 0.025, this._p.z,
          b.vel.x * forwardCarry
            + this._r.x * outward - this._f.x * backward,
          0.72 + Math.random() * (1.1 + turnEnergy * 4.1)
            + highSpeed * (2.8 + Math.random() * 5.4),
          b.vel.z * forwardCarry
            + this._r.z * outward - this._f.z * backward,
          0.34 + Math.random() * (0.32 + turnEnergy * 0.34),
          (0.23 + Math.random() * 0.5)
            * (0.84 + turnEnergy * 0.68 + highSpeed * 0.55),
          0.4 + Math.random() * 0.38,
          0.42 + turnEnergy * 0.32,
        );
      }

      this._turnFoamAcc += dt * (8 + forwardSpeed * 4.3) * turnEnergy
        * (1 + highSpeed * 1.8) * pulse;
      while (this._turnFoamAcc >= 1) {
        this._turnFoamAcc -= 1;
        spawnTurnPoint(this._p);
        const outward = outsideSide * (
          0.7 + Math.random() * (1.5 + turnEnergy * 3)
          + forwardSpeed * highSpeed * 0.08
        );
        const foamCarry = THREE.MathUtils.lerp(0.74, 0.89, highSpeed);
        this.wakeFoam.spawn(
          this._p.x, this._p.y + 0.035, this._p.z,
          b.vel.x * foamCarry + this._r.x * outward
            - this._f.x * (0.08 + Math.random() * 0.48),
          0.35 + Math.random() * (0.65 + turnEnergy * 1.25)
            + highSpeed * (1.2 + Math.random() * 2.4),
          b.vel.z * foamCarry + this._r.z * outward
            - this._f.z * (0.08 + Math.random() * 0.48),
          0.42 + Math.random() * 0.42,
          (0.34 + Math.random() * 0.56) * (0.85 + turnEnergy * 0.48),
          0.14 + Math.random() * 0.16,
          0.42 + Math.random() * 0.38,
        );
      }

      this._turnSheetAcc += dt * (3 + forwardSpeed * 1.8)
        * Math.pow(turnEnergy, 1.08) * (1 + highSpeed * 2.5) * pulse;
      while (this._turnSheetAcc >= 1) {
        this._turnSheetAcc -= 1;
        spawnTurnPoint(this._p, 0.78);
        const outward = outsideSide * (
          2.4 + Math.random() * (2.8 + turnEnergy * 7.2)
          + forwardSpeed * (0.12 + highSpeed * 0.13)
        );
        const backward = 0.12 + Math.random() * (0.38 + turnEnergy * 0.85);
        const sheetCarry = THREE.MathUtils.lerp(0.8, 0.92, highSpeed);
        this.impactFoam.spawn(
          this._p.x, this._p.y + 0.04, this._p.z,
          b.vel.x * sheetCarry + this._r.x * outward - this._f.x * backward,
          1.15 + Math.random() * (1.5 + turnEnergy * 4.8)
            + highSpeed * (3.8 + Math.random() * 6.2),
          b.vel.z * sheetCarry + this._r.z * outward - this._f.z * backward,
          0.48 + Math.random() * (0.38 + turnEnergy * 0.38),
          (0.58 + Math.random() * 0.82) * (0.9 + turnEnergy * 0.72),
          0.18 + Math.random() * 0.2,
          0.35 + turnEnergy * 0.38,
        );
      }

      this._turnMistAcc += dt * Math.max(0, turnEnergy - 0.2)
        * (2.7 + forwardSpeed * 0.72) * (1 + highSpeed * 2.2) * pulse;
      while (this._turnMistAcc >= 1) {
        this._turnMistAcc -= 1;
        spawnTurnPoint(this._p, 0.75);
        const outward = outsideSide * (
          0.8 + turnEnergy * 2.2 + forwardSpeed * highSpeed * 0.055
        );
        const mistCarry = THREE.MathUtils.lerp(0.78, 0.91, highSpeed);
        this.mist.spawn(
          this._p.x, this._p.y + 0.08, this._p.z,
          b.vel.x * mistCarry + this._r.x * outward - this._f.x * 0.16,
          0.45 + Math.random() * (0.55 + turnEnergy)
            + highSpeed * (1.6 + Math.random() * 2.8),
          b.vel.z * mistCarry + this._r.z * outward - this._f.z * 0.16,
          0.52 + Math.random() * 0.52,
          (0.58 + Math.random() * 0.8) * (0.8 + turnEnergy * 0.45),
          0.035 + Math.random() * 0.04,
          0.9,
        );
      }
      this._turnPrevOrigin.copy(this._turnCurrentOrigin);
    } else {
      this._turnSprayAcc = this._turnFoamAcc = 0;
      this._turnSheetAcc = this._turnMistAcc = 0;
      this._turnBlastAcc = this._turnBlastMistAcc = 0;
      this._turnOriginValid = false;
      this.turnViolence = 0;
    }

    const forwardPower = Math.max(b.throttle, 0) * b.propWet;
    const sternEnergy = THREE.MathUtils.clamp(
      Math.max(0, forwardSpeed - 1.4) / Math.max(b.spec.maxPropSpeed, 1) * 0.75
        + forwardPower * 0.72,
      0, 1.35,
    );
    if (sternEnergy > 0.025 && this._propPositions.length) {
      const propGain = Math.sqrt(this._propPositions.length);
      this._sternAcc += dt * (12 + forwardSpeed * 6.2) * sternEnergy * propGain;
      while (this._sternAcc >= 1) {
        this._sternAcc -= 1;
        const prop = this._propPositions[
          Math.floor(Math.random() * this._propPositions.length)
        ];
        const waterY = this.wf.heightAt(prop.x, prop.z);
        const across = (Math.random() - 0.5) * b.spec.beam * 0.16;
        const behind = 0.08 + Math.random() * (0.35 + sternEnergy * 0.35);
        const backward = 1.4 + Math.random() * (2.4 + sternEnergy * 4.2);
        const spread = (Math.random() - 0.5) * (1.2 + sternEnergy * 1.8);
        this.droplets.spawn(
          prop.x + this._r.x * across - this._f.x * behind,
          waterY + 0.035,
          prop.z + this._r.z * across - this._f.z * behind,
          b.vel.x * 0.16 - this._f.x * backward + this._r.x * spread,
          0.65 + Math.random() * (1.25 + sternEnergy * 2.4),
          b.vel.z * 0.16 - this._f.z * backward + this._r.z * spread,
          0.42 + Math.random() * 0.48,
          (0.28 + Math.random() * 0.48) * (0.85 + sternEnergy * 0.45),
          0.46 + Math.random() * 0.34,
          0.72,
        );
      }

      this._wakeFoamAcc += dt * (5 + forwardSpeed * 2.4) * sternEnergy * propGain;
      while (this._wakeFoamAcc >= 1) {
        this._wakeFoamAcc -= 1;
        const prop = this._propPositions[
          Math.floor(Math.random() * this._propPositions.length)
        ];
        const waterY = this.wf.heightAt(prop.x, prop.z);
        const across = (Math.random() - 0.5) * b.spec.beam * 0.3;
        const behind = Math.random() * 0.5;
        const backward = 0.8 + Math.random() * (1.8 + sternEnergy * 2.2);
        this.wakeFoam.spawn(
          prop.x + this._r.x * across - this._f.x * behind,
          waterY + 0.02,
          prop.z + this._r.z * across - this._f.z * behind,
          b.vel.x * 0.1 - this._f.x * backward + this._r.x * (Math.random() - 0.5),
          0.3 + Math.random() * (0.75 + sternEnergy),
          b.vel.z * 0.1 - this._f.z * backward + this._r.z * (Math.random() - 0.5),
          0.38 + Math.random() * 0.45,
          (0.3 + Math.random() * 0.5) * (0.9 + sternEnergy * 0.35),
          0.12 + Math.random() * 0.14,
          0.35 + Math.random() * 0.35,
        );
      }

      this._sternMistAcc += dt * (1.4 + forwardSpeed * 0.7) * sternEnergy * propGain;
      while (this._sternMistAcc >= 1) {
        this._sternMistAcc -= 1;
        const prop = this._propPositions[
          Math.floor(Math.random() * this._propPositions.length)
        ];
        const waterY = this.wf.heightAt(prop.x, prop.z);
        const spread = (Math.random() - 0.5) * b.spec.beam * 0.35;
        const behind = Math.random() * 0.55;
        const backward = 0.7 + Math.random() * 1.4;
        this.mist.spawn(
          prop.x + this._r.x * spread - this._f.x * behind,
          waterY + 0.08,
          prop.z + this._r.z * spread - this._f.z * behind,
          b.vel.x * 0.08 - this._f.x * backward,
          0.32 + Math.random() * 0.72,
          b.vel.z * 0.08 - this._f.z * backward,
          0.62 + Math.random() * 0.6,
          (0.72 + Math.random() * 0.95) * (0.85 + sternEnergy * 0.35),
          0.07 + Math.random() * 0.055,
          0.95,
        );
      }
    }

    if (b.slam > 0.8 && this._impactCooldown <= 0) {
      const impact = THREE.MathUtils.clamp((b.slam - 0.65) / 1.35, 0, 1);
      const speedEnergy = THREE.MathUtils.clamp((speed - 2) / 13, 0.15, 1);
      const energy = impact * (0.55 + speedEnergy * 0.7);
      const hitX = b.slamPoint.x, hitY = b.slamPoint.y, hitZ = b.slamPoint.z;
      this._n.copy(b.slamNormal).normalize();
      this._v.copy(b.slamPoint).sub(b.pos);
      const localSide = THREE.MathUtils.clamp(
        this._v.dot(this._r) / Math.max(b.spec.beam * 0.5, 0.1), -1, 1);
      const hitSide = Math.abs(localSide) > 0.12 ? Math.sign(localSide) : 0;
      const n = Math.min(76, Math.round(20 + energy * 38 + speed * 1.1));
      this._p.set(hitX, hitY + 0.04, hitZ);
      this._burst(this._p, this._r, this._f, b.vel, n * 2, speed);

      const lobes = 120 + Math.round(energy * 180);
      for (let i = 0; i < lobes; i++) {
        const spraySide = hitSide === 0 || Math.random() < 0.12
          ? (Math.random() < 0.5 ? -1 : 1) : hitSide;
        const across = (Math.random() - 0.5) * b.spec.beam * 0.24;
        const along = (Math.random() - 0.5) * b.spec.length * 0.075;
        const outward = spraySide * (1.1 + Math.random() * (3.2 + energy * 4.5))
                        + (Math.random() - 0.5) * 1.4;
        const forward = 0.18 + Math.random() * 0.2;
        const highJet = Math.random() < 0.11;
        const cloudy = Math.random() < 0.18;
        const normalKick = 0.7 + Math.random() * (1.2 + energy * 1.8);
        this._impactQueue.push({
          delay: Math.pow(Math.random(), 1.6) * (0.12 + energy * 0.11),
          x: hitX + this._r.x * across + this._f.x * along,
          y: hitY + 0.04 + Math.random() * 0.2,
          z: hitZ + this._r.z * across + this._f.z * along,
          vx: b.vel.x * forward + this._r.x * outward
              + this._n.x * normalKick - this._f.x * (0.4 + Math.random() * 1.4),
          vy: this._n.y * (1.1 + energy * 2.1)
              + (highJet ? 2.5 + Math.random() * 3.5 : Math.random() * 2),
          vz: b.vel.z * forward + this._r.z * outward
              + this._n.z * normalKick - this._f.z * (0.4 + Math.random() * 1.4),
          life: 0.42 + Math.random() * 0.66,
          size: (cloudy ? 0.62 + Math.random() * 0.48 : 0.2 + Math.random() * 0.5)
                * (0.8 + energy * 0.42),
          alpha: cloudy ? 0.1 + Math.random() * 0.1 : 0.2 + Math.random() * 0.2,
          grow: 0.22 + Math.random() * 0.55,
        });
      }

      const crown = 44 + Math.round(energy * 80);
      for (let i = 0; i < crown; i++) {
        const side = hitSide === 0 || Math.random() < 0.18
          ? (Math.random() < 0.5 ? -1 : 1) : hitSide;
        const across = (Math.random() - 0.5) * b.spec.beam * 0.2;
        const along = (Math.random() - 0.5) * b.spec.length * 0.06;
        const outward = side * (3 + Math.random() * (4 + energy * 5));
        this.droplets.spawn(
          hitX + this._r.x * across + this._f.x * along, hitY + 0.1,
          hitZ + this._r.z * across + this._f.z * along,
          b.vel.x * 0.32 + this._r.x * outward + this._n.x * 1.3
            - this._f.x * Math.random() * 2,
          2.2 + Math.random() * (3.5 + energy * 4.5),
          b.vel.z * 0.32 + this._r.z * outward + this._n.z * 1.3
            - this._f.z * Math.random() * 2,
          0.75 + Math.random() * 0.75,
          0.22 + Math.random() * 0.46,
          0.55 + Math.random() * 0.38,
          0.45,
        );
      }
      this._impactCooldown = 0.24;
      const mistPuffs = 12 + Math.round(energy * 10);
      for (let i = 0; i < mistPuffs; i++) {
        const side = hitSide || (Math.random() < 0.5 ? -1 : 1);
        const across = (Math.random() - 0.5) * b.spec.beam * 0.26;
        const along = (Math.random() - 0.5) * b.spec.length * 0.08;
        const outward = side * (1.2 + energy * 3.2) + (Math.random() - 0.5) * 1.4;
        this.mist.spawn(
          hitX + this._r.x * across + this._f.x * along,
          hitY + 0.18 + Math.random() * 0.4,
          hitZ + this._r.z * across + this._f.z * along,
          b.vel.x * 0.25 + this._r.x * outward + this._n.x,
          0.8 + Math.random() * (1.5 + energy),
          b.vel.z * 0.25 + this._r.z * outward + this._n.z,
          0.85 + Math.random() * 0.8, 1.15 + Math.random() * 1.15,
          0.035 + Math.random() * 0.055, 1.0 + Math.random() * 0.7);
      }
    }
  }
}
