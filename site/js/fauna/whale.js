import * as THREE from 'three';
import { loadGLTFDeferred } from '../runtime/deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// Storm encounters combine a skinned whale with a tail-driven wake and wind-blown spout.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

const WHALE_PRESETS = new Set([4]);
const MODEL_URL = './assets/animals/blue_whale_-_textured.glb';
const TARGET_LEN = 20;
const MODEL_FLIP = 0;
const SPAWN = [80, 140];
const DESPAWN = 185;
const DESPAWN_SQ = DESPAWN * DESPAWN;
const EMERGE = 0.35;
const BLOW_FWD = 0.30;
const TAIL_FWD = -0.46;
const TAU = Math.PI * 2;
const SPOUT_CORE = 0;
const SPOUT_MIST = 1;
const SPOUT_DROP = 2;
const WAKE_PATCHES = 28;
const WAKE_COLS = 3;
const WAKE_ROWS = 5;

const rhash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = rhash(xi, yi), b = rhash(xi + 1, yi), c = rhash(xi, yi + 1), d = rhash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function dropletTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function contactTexture() {
  if (typeof document === 'undefined') return null;
  const W = 128, H = 192;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const z = (y + 0.5) / H * 2 - 1;
    const longitudinal = Math.exp(-((z / 0.72) ** 4));
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5) / W * 2 - 1;
      const oval = dx * dx / 0.76 ** 2 + z * z / 0.92 ** 2;
      const brokenEdge = Math.exp(-(((Math.sqrt(oval) - 0.72) / 0.19) ** 2));
      const coarse = vnoise(x * 0.105 + 7.1, y * 0.075 - 3.4);
      const fine = vnoise(x * 0.34 - 8.7, y * 0.29 + 5.2);
      const breakup = THREE.MathUtils.smoothstep(
        coarse * 0.66 + fine * 0.34, 0.46, 0.79,
      );
      const a = brokenEdge * breakup * longitudinal * 0.72;
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function wakeTexture() {
  if (typeof document === 'undefined') return null;
  const W = 160, H = 224;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const z = (y + 0.5) / H * 2 - 1;
    const end = Math.exp(-((z / 0.9) ** 4));
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / W * 2 - 1;
      const radial = Math.exp(-(px * px * 2.5 + z * z * 1.15));
      const coarse = vnoise(x * 0.07 + 17.3, y * 0.055 - 9.4);
      const medium = vnoise(x * 0.18 - 3.8, y * 0.15 + 12.1);
      const fine = vnoise(x * 0.47 + 5.6, y * 0.39 - 4.2);
      const turbulence = coarse * 0.52 + medium * 0.33 + fine * 0.15;
      const aeration = THREE.MathUtils.smoothstep(turbulence, 0.48, 0.72);
      const sweep = px - (coarse - 0.5) * 0.46
        - Math.sin(z * 4.6 + medium * 2.8) * 0.09;
      const filamentA = Math.exp(-(((sweep - 0.08) / 0.21) ** 2))
        * THREE.MathUtils.smoothstep(medium, 0.43, 0.73);
      const filamentB = Math.exp(-(((sweep + 0.4 + (fine - 0.5) * 0.16) / 0.15) ** 2))
        * THREE.MathUtils.smoothstep(coarse, 0.54, 0.8);
      const white = Math.max(
        aeration * radial * 0.92,
        filamentA * 0.76 * end,
        filamentB * 0.52 * end,
      );
      const slick = radial * (0.4 + coarse * 0.2);
      const alpha = Math.min(0.84, slick * 0.22 + white * 0.82) * end;
      const tone = THREE.MathUtils.clamp(white * 1.7, 0, 1);
      const i = (y * W + x) * 4;
      d[i] = THREE.MathUtils.lerp(70, 242, tone);
      d[i + 1] = THREE.MathUtils.lerp(125, 249, tone);
      d[i + 2] = THREE.MathUtils.lerp(136, 250, tone);
      d[i + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

class Spout {
  constructor(scene, max = 900) {
    this.max = max; this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.psize = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.coreAcc = 0;
    this.mistAcc = 0;
    this.dropAcc = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.psize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dropletTexture() } },
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute float alpha; attribute float psize; varying float vA;
        void main(){ vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=psize*(320.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA;
        void main(){ vec4 t=texture2D(map, gl_PointCoord); gl_FragColor=vec4(vec3(0.95,0.97,0.99), t.a*vA); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  _spawn(type, x, y, z, forwardX, forwardZ) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const a = rand(0, TAU);
    const radius = type === SPOUT_MIST ? rand(0.03, 0.26) : rand(0, 0.13);
    const spread = type === SPOUT_DROP ? rand(0.7, 2.5)
      : type === SPOUT_MIST ? rand(0.3, 1.25) : rand(0.08, 0.48);
    this.pos[i * 3] = x + Math.cos(a) * radius;
    this.pos[i * 3 + 1] = y + rand(0, 0.2);
    this.pos[i * 3 + 2] = z + Math.sin(a) * radius;
    this.vel[i * 3] = Math.cos(a) * spread + forwardX * rand(0.25, 0.85);
    this.vel[i * 3 + 2] = Math.sin(a) * spread + forwardZ * rand(0.25, 0.85);
    if (type === SPOUT_MIST) {
      this.vel[i * 3 + 1] = rand(7.5, 10.5);
      this.life[i] = this.maxLife[i] = rand(1.45, 2.15);
      this.baseSize[i] = rand(2.6, 4.8);
      this.baseAlpha[i] = rand(0.18, 0.36);
    } else if (type === SPOUT_DROP) {
      this.vel[i * 3 + 1] = rand(8, 12.5);
      this.life[i] = this.maxLife[i] = rand(1.1, 1.9);
      this.baseSize[i] = rand(0.85, 1.8);
      this.baseAlpha[i] = rand(0.48, 0.78);
    } else {
      this.vel[i * 3 + 1] = rand(11, 14);
      this.life[i] = this.maxLife[i] = rand(1.05, 1.55);
      this.baseSize[i] = rand(1.25, 2.45);
      this.baseAlpha[i] = rand(0.55, 0.82);
    }
    this.kind[i] = type;
    this.psize[i] = this.baseSize[i];
    this.alpha[i] = 0;
  }

  _emitCount(type, count, x, y, z, forwardX, forwardZ) {
    for (let i = 0; i < count; i++) {
      this._spawn(type, x, y, z, forwardX, forwardZ);
    }
  }

  begin(x, y, z, forwardX, forwardZ) {
    this.coreAcc = this.mistAcc = this.dropAcc = 0;
    this._emitCount(SPOUT_CORE, 26, x, y, z, forwardX, forwardZ);
    this._emitCount(SPOUT_MIST, 22, x, y, z, forwardX, forwardZ);
    this._emitCount(SPOUT_DROP, 14, x, y, z, forwardX, forwardZ);
  }

  emit(x, y, z, dt, envelope, forwardX, forwardZ) {
    this.coreAcc += dt * 180 * envelope;
    this.mistAcc += dt * 125 * Math.max(envelope, 0.12);
    this.dropAcc += dt * 30 * envelope;
    const core = Math.floor(this.coreAcc);
    const mist = Math.floor(this.mistAcc);
    const drops = Math.floor(this.dropAcc);
    this.coreAcc -= core; this.mistAcc -= mist; this.dropAcc -= drops;
    this._emitCount(SPOUT_CORE, core, x, y, z, forwardX, forwardZ);
    this._emitCount(SPOUT_MIST, mist, x, y, z, forwardX, forwardZ);
    this._emitCount(SPOUT_DROP, drops, x, y, z, forwardX, forwardZ);
  }

  update(dt, windX, windZ) {
    const p = this.pos, v = this.vel, al = this.alpha, ps = this.psize, t = this.time = (this.time || 0) + dt;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { al[i] = 0; continue; }
      this.life[i] -= dt; live++;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      const type = this.kind[i];
      const age = 1 - f;
      const gravity = type === SPOUT_MIST ? 4.2 : type === SPOUT_DROP ? 9.81 : 8;
      const windGrip = type === SPOUT_MIST ? 1.7 : type === SPOUT_CORE ? 0.48 : 0.2;
      v[i * 3 + 1] -= gravity * dt;
      v[i * 3] += (windX - v[i * 3]) * windGrip * dt;
      v[i * 3 + 2] += (windZ - v[i * 3 + 2]) * windGrip * dt;
      const billow = age * (type === SPOUT_MIST ? 5.5 : 2.2);
      v[i * 3] += (vnoise(p[i * 3] * 0.48 + t, p[i * 3 + 2] * 0.48) - 0.5) * billow * dt;
      v[i * 3 + 2] += (vnoise(p[i * 3] * 0.48, p[i * 3 + 2] * 0.48 - t) - 0.5) * billow * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const growth = type === SPOUT_MIST ? 1 + age * 1.25 : 1 + age * 0.38;
      ps[i] = this.baseSize[i] * growth;
      const fadeIn = THREE.MathUtils.smoothstep(age, 0, type === SPOUT_MIST ? 0.13 : 0.045);
      const fadeOut = THREE.MathUtils.smoothstep(f, 0, type === SPOUT_MIST ? 0.55 : 0.32);
      al[i] = this.baseAlpha[i] * fadeIn * fadeOut;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
    this.points.geometry.attributes.psize.needsUpdate = true;
    return live;
  }
}

class ContactFoam {
  constructor(scene, waveField) {
    const geo = new THREE.PlaneGeometry(1, 1, 4, 10);
    geo.rotateX(-Math.PI / 2);
    this.baseXZ = new Float32Array(geo.attributes.position.count * 2);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      this.baseXZ[i * 2] = geo.attributes.position.getX(i);
      this.baseXZ[i * 2 + 1] = geo.attributes.position.getZ(i);
    }
    this.wf = waveField;
    this.mat = new THREE.MeshBasicMaterial({
      map: contactTexture(), transparent: true, depthWrite: false,
      opacity: 0, color: 0xffffff, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  place(x, y, z, heading, len, wid, opacity) {
    this.mesh.visible = true;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    this.mesh.scale.set(wid, 1, len);
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = this.baseXZ[i * 2] * wid;
      const lz = this.baseXZ[i * 2 + 1] * len;
      const wx = x + lx * cos + lz * sin;
      const wz = z - lx * sin + lz * cos;
      pos.setY(i, (this.wf ? this.wf.heightAt(wx, wz) : y) + 0.055);
    }
    pos.needsUpdate = true;
    this.mat.opacity = opacity;
  }
  hide() { this.mesh.visible = false; }
}

class WhaleWake {
  constructor(scene, waveField) {
    this.wf = waveField;
    this.cursor = 0;
    this.patches = Array.from({ length: WAKE_PATCHES }, () => ({ active: false }));
    const verticesPerPatch = (WAKE_COLS + 1) * (WAKE_ROWS + 1);
    const vertexCount = WAKE_PATCHES * verticesPerPatch;
    this.positions = new Float32Array(vertexCount * 3);
    this.alphas = new Float32Array(vertexCount);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = [];
    for (let patch = 0; patch < WAKE_PATCHES; patch++) {
      const base = patch * verticesPerPatch;
      for (let row = 0; row <= WAKE_ROWS; row++) {
        for (let col = 0; col <= WAKE_COLS; col++) {
          const i = base + row * (WAKE_COLS + 1) + col;
          uvs[i * 2] = col / WAKE_COLS;
          uvs[i * 2 + 1] = row / WAKE_ROWS;
          this.positions[i * 3 + 1] = -9999;
        }
      }
      for (let row = 0; row < WAKE_ROWS; row++) {
        for (let col = 0; col < WAKE_COLS; col++) {
          const a = base + row * (WAKE_COLS + 1) + col;
          const b = a + 1, c = a + WAKE_COLS + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('wakeAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setIndex(indices);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: wakeTexture() } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float wakeAlpha;
        varying vec2 vUv;
        varying float vWakeAlpha;
        void main() {
          vUv = uv;
          vWakeAlpha = wakeAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vWakeAlpha;
        void main() {
          vec4 wake = texture2D(map, vUv);
          gl_FragColor = vec4(wake.rgb, wake.a * vWakeAlpha);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  emit(x, z, heading, side) {
    const patch = this.patches[this.cursor];
    this.cursor = (this.cursor + 1) % WAKE_PATCHES;
    Object.assign(patch, {
      active: true,
      x, z,
      heading: heading + side * rand(0.025, 0.075),
      age: 0,
      life: rand(5.8, 8.4),
      length: rand(4.4, 6.4),
      width: rand(3.2, 5),
      strength: rand(0.7, 0.96),
      skew: side * rand(0.18, 0.42),
    });
  }

  update(dt) {
    const verticesPerPatch = (WAKE_COLS + 1) * (WAKE_ROWS + 1);
    const currentSpeed = this.wf?.currentSpeed || 0;
    const currentDirection = this.wf?.currentDirection || 0;
    for (let index = 0; index < WAKE_PATCHES; index++) {
      const patch = this.patches[index];
      const base = index * verticesPerPatch;
      if (!patch.active) {
        for (let i = 0; i < verticesPerPatch; i++) this.alphas[base + i] = 0;
        continue;
      }
      patch.age += dt;
      if (patch.age >= patch.life) {
        patch.active = false;
        for (let i = 0; i < verticesPerPatch; i++) this.alphas[base + i] = 0;
        continue;
      }
      patch.x += Math.cos(currentDirection) * currentSpeed * dt;
      patch.z += Math.sin(currentDirection) * currentSpeed * dt;
      const t = patch.age / patch.life;
      const fadeIn = THREE.MathUtils.smoothstep(t, 0, 0.08);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(t, 0.48, 1);
      const alpha = patch.strength * fadeIn * fadeOut;
      const width = patch.width * THREE.MathUtils.lerp(0.62, 1.55, t);
      const length = patch.length * THREE.MathUtils.lerp(0.72, 1.38, t);
      const cos = Math.cos(patch.heading), sin = Math.sin(patch.heading);
      for (let row = 0; row <= WAKE_ROWS; row++) {
        const v = row / WAKE_ROWS;
        const localZ = (v - 0.5) * length;
        for (let col = 0; col <= WAKE_COLS; col++) {
          const u = col / WAKE_COLS;
          const localX = (u - 0.5) * width + patch.skew * (v - 0.5);
          const worldX = patch.x + localX * cos + localZ * sin;
          const worldZ = patch.z - localX * sin + localZ * cos;
          const vertex = base + row * (WAKE_COLS + 1) + col;
          this.positions[vertex * 3] = worldX;
          this.positions[vertex * 3 + 1] = (this.wf ? this.wf.heightAt(worldX, worldZ) : 0) + 0.065;
          this.positions[vertex * 3 + 2] = worldZ;
          this.alphas[vertex] = alpha;
        }
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.wakeAlpha.needsUpdate = true;
  }
}

export class Whales {
  constructor(scene, camera, waveField) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.time = 0;
    this.whale = null;
    this.timer = rand(6, 16);
    this.spout = new Spout(scene);
    this.contact = new ContactFoam(scene, waveField);
    this.wake = new WhaleWake(scene, waveField);

    this.proto = null; this.baseScale = 1; this.yaw = 0; this.topY = 1;
    this.loadStarted = false;
  }

  _load() {
    if (this.loadStarted) return;
    this.loadStarted = true;
    loadGLTFDeferred(MODEL_URL, (gltf) => {
      this.proto = gltf.scene;
      this.clip = gltf.animations.find(c => /swim/i.test(c.name)) || gltf.animations[0];
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      this.baseScale = TARGET_LEN / Math.max(size.x, size.z, 1e-3);
      this.yaw = (size.x > size.z ? Math.PI / 2 : 0) + MODEL_FLIP;
      this.topY = box.max.y * this.baseScale;
      this.proto.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    }, (e) => console.warn('[whale] load failed', e));
  }

  _spawn() {
    const cam = this.camera.position;
    const bearing = rand(0, Math.PI * 2), R = rand(SPAWN[0], SPAWN[1]);
    const model = skeletonClone(this.proto);
    model.rotation.y = this.yaw;
    model.scale.setScalar(this.baseScale);
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(model);
    this.scene.add(g);
    const mixer = new THREE.AnimationMixer(model);
    let action = null;
    if (this.clip) {
      action = mixer.clipAction(this.clip);
      action.play();
      action.time = rand(0, this.clip.duration);
      action.timeScale = rand(0.92, 1.04);
    }
    this.whale = {
      g, mixer, action,
      pos: new THREE.Vector3(cam.x + Math.sin(bearing) * R, 0, cam.z + Math.cos(bearing) * R),
      heading: rand(0, Math.PI * 2),
      speed: rand(2, 3.5),
      blowTimer: rand(1.5, 3.5),
      blowing: 0,
      blowAge: 0,
      blowDuration: 0,
      tailSide: 0,
      life: 0, maxLife: rand(30, 55),
    };
  }

  update(dt) {
    this.time += dt;
    const windSpeed = (this.wf?.windSpeed || 0) * (this.wf?.gustFactor || 1) * 0.22;
    const windDirection = this.wf?.windDirection || 0;
    this.spout.update(
      dt,
      Math.cos(windDirection) * windSpeed,
      Math.sin(windDirection) * windSpeed,
    );
    this.wake.update(dt);
    if (this.time > 1.5 && WHALE_PRESETS.has(this.wf.preset)) this._load();
    if (!this.proto) return;

    if (!this.whale && WHALE_PRESETS.has(this.wf.preset)) {
      this.timer -= dt;
      if (this.timer <= 0) { this._spawn(); this.timer = rand(28, 60); }
    }

    const w = this.whale;
    if (!w) { this.contact.hide(); return; }
    w.life += dt;
    w.heading += Math.sin(this.time * 0.05 + 1.3) * 0.02 * dt;
    const fx = Math.sin(w.heading), fz = Math.cos(w.heading);
    w.pos.x += fx * w.speed * dt;
    w.pos.z += fz * w.speed * dt;
    const surf = this.wf ? this.wf.heightAt(w.pos.x, w.pos.z) : 0;
    w.pos.y = surf + EMERGE - this.topY;
    w.g.position.copy(w.pos);
    w.g.rotation.set(0, w.heading, 0);
    w.mixer.update(dt);

    const swimPhase = w.action && this.clip?.duration
      ? w.action.time / this.clip.duration * TAU
      : w.life * 1.55;
    const tailWave = Math.sin(swimPhase);
    const tailSide = tailWave >= 0 ? 1 : -1;
    if (tailSide !== w.tailSide) {
      w.tailSide = tailSide;
      const rightX = fz, rightZ = -fx;
      const tailX = w.pos.x + fx * TARGET_LEN * TAIL_FWD + rightX * tailSide * 0.75;
      const tailZ = w.pos.z + fz * TARGET_LEN * TAIL_FWD + rightZ * tailSide * 0.75;
      this.wake.emit(tailX, tailZ, w.heading, tailSide);
    }

    const contactX = w.pos.x + fx * TARGET_LEN * 0.07;
    const contactZ = w.pos.z + fz * TARGET_LEN * 0.07;
    this.contact.place(
      contactX, surf, contactZ, w.heading,
      TARGET_LEN * 0.3, TARGET_LEN * 0.12,
      0.16 + Math.abs(tailWave) * 0.1,
    );

    const bx = w.pos.x + fx * TARGET_LEN * BLOW_FWD;
    const bz = w.pos.z + fz * TARGET_LEN * BLOW_FWD;
    const by = surf + EMERGE + 0.1;

    w.blowTimer -= dt;
    if (w.blowTimer <= 0 && w.life < w.maxLife) {
      w.blowDuration = rand(0.62, 0.82);
      w.blowing = w.blowDuration;
      w.blowAge = 0;
      w.blowTimer = rand(8, 14);
      this.spout.begin(bx, by, bz, fx, fz);
    }
    if (w.blowing > 0) {
      w.blowAge += dt;
      w.blowing -= dt;
      const finish = 1 - THREE.MathUtils.smoothstep(
        w.blowAge / w.blowDuration, 0.68, 1,
      );
      const envelope = Math.exp(-w.blowAge * 4.8) * finish;
      this.spout.emit(bx, by, bz, dt, envelope, fx, fz);
    }

    _v.set(w.pos.x - this.camera.position.x, 0, w.pos.z - this.camera.position.z);
    if (_v.lengthSq() > DESPAWN_SQ || w.life > w.maxLife + 6) {
      this.scene.remove(w.g); w.mixer.stopAllAction();
      this.whale = null;
      this.contact.hide();
    }
  }
}
