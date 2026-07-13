import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// Storm encounters combine a skinned whale with wave-conforming contact foam and spray.
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

function foamContactTexture() {
  if (typeof document === 'undefined') return null;
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const z = (y + 0.5) / H * 2 - 1;
    const endFade = Math.max(0, 1 - Math.abs(z) ** 2.35);
    const head = z > 0 ? 1 + 0.18 * Math.sin(Math.min(1, z) * Math.PI) : 1;
    const tail = z < 0 ? 0.78 + 0.22 * (z + 1) : 1;
    const halfWidth = 0.76 * Math.sqrt(endFade) * head * tail;
    for (let x = 0; x < W; x++) {
      const dx = ((x + 0.5) / W * 2 - 1);
      const edgeDist = Math.abs(Math.abs(dx) - halfWidth);
      const band = Math.exp(-((edgeDist / 0.085) ** 2));
      const coarse = vnoise(x * 0.105 + 7.1, y * 0.075 - 3.4);
      const fine = vnoise(x * 0.34 - 8.7, y * 0.29 + 5.2);
      const breakup = THREE.MathUtils.smoothstep(coarse * 0.72 + fine * 0.28, 0.30, 0.76);
      const longitudinal = THREE.MathUtils.smoothstep(endFade, 0.025, 0.22);
      let a = band * breakup * longitudinal;
      if (Math.abs(dx) > halfWidth + 0.16) a = 0;
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
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

  emit(x, y, z, n, leanX, leanZ) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const a = rand(0, Math.PI * 2), s = rand(0, 0.35);
      this.pos[i * 3] = x + Math.cos(a) * s * 0.3;
      this.pos[i * 3 + 1] = y + rand(0, 0.3);
      this.pos[i * 3 + 2] = z + Math.sin(a) * s * 0.3;
      this.vel[i * 3] = Math.cos(a) * s * 0.7 + leanX * rand(0.4, 1.3);
      this.vel[i * 3 + 1] = rand(9, 17);
      this.vel[i * 3 + 2] = Math.sin(a) * s * 0.7 + leanZ * rand(0.4, 1.3);
      this.life[i] = this.maxLife[i] = rand(1.7, 3.4);
      this.psize[i] = rand(1.3, 2.8);
    }
  }

  update(dt) {
    const p = this.pos, v = this.vel, al = this.alpha, ps = this.psize, t = this.time = (this.time || 0) + dt;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { al[i] = 0; continue; }
      this.life[i] -= dt; live++;
      const f = this.life[i] / this.maxLife[i];
      v[i * 3 + 1] -= 7.5 * dt;
      const age = 1 - f;
      const tb = age * 2.2;
      v[i * 3] += (vnoise(p[i * 3] * 0.6 + t, p[i * 3 + 2] * 0.6) - 0.5) * tb * dt * 6;
      v[i * 3 + 2] += (vnoise(p[i * 3] * 0.6, p[i * 3 + 2] * 0.6 - t) - 0.5) * tb * dt * 6;
      v[i * 3] *= 0.985; v[i * 3 + 2] *= 0.985;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      ps[i] = Math.min(6.5, ps[i] + dt * 1.6 * age);
      al[i] = Math.min(1, f * 1.7) * 0.85;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
    this.points.geometry.attributes.psize.needsUpdate = true;
    return live;
  }
}

class Foam {
  constructor(scene, waveField) {
    const geo = new THREE.PlaneGeometry(1, 1, 4, 20);
    geo.rotateX(-Math.PI / 2);
    this.baseXZ = new Float32Array(geo.attributes.position.count * 2);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      this.baseXZ[i * 2] = geo.attributes.position.getX(i);
      this.baseXZ[i * 2 + 1] = geo.attributes.position.getZ(i);
    }
    this.wf = waveField;
    this.mat = new THREE.MeshBasicMaterial({
      map: foamContactTexture(), transparent: true, depthWrite: false,
      opacity: 0, color: 0xffffff, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  place(x, y, z, heading, len, wid) {
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
    this.mat.opacity = 0.58;
  }
  hide() { this.mesh.visible = false; }
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
    this.foam = new Foam(scene, waveField);

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
    if (this.clip) mixer.clipAction(this.clip).play();
    this.whale = {
      g, mixer,
      pos: new THREE.Vector3(cam.x + Math.sin(bearing) * R, 0, cam.z + Math.cos(bearing) * R),
      heading: rand(0, Math.PI * 2),
      speed: rand(2, 3.5),
      blowTimer: rand(1.5, 3.5),
      blowing: 0,
      life: 0, maxLife: rand(30, 55),
    };
  }

  update(dt) {
    this.time += dt;
    this.spout.update(dt);
    if (this.time > 1.5 && WHALE_PRESETS.has(this.wf.preset)) this._load();
    if (!this.proto) return;

    if (!this.whale && WHALE_PRESETS.has(this.wf.preset)) {
      this.timer -= dt;
      if (this.timer <= 0) { this._spawn(); this.timer = rand(28, 60); }
    }

    const w = this.whale;
    if (!w) { this.foam.hide(); return; }
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

    this.foam.place(w.pos.x, surf, w.pos.z, w.heading,
      TARGET_LEN * 0.82, TARGET_LEN * 0.26);

    const bx = w.pos.x + fx * TARGET_LEN * BLOW_FWD;
    const bz = w.pos.z + fz * TARGET_LEN * BLOW_FWD;
    const by = surf + EMERGE + 0.1;

    w.blowTimer -= dt;
    if (w.blowTimer <= 0 && w.life < w.maxLife) {
      w.blowing = rand(0.55, 0.95);
      w.blowTimer = rand(7, 13);
    }
    if (w.blowing > 0) {
      w.blowing -= dt;
      this.spout.emit(bx, by, bz, 14, fx * 0.5, fz * 0.5);
    }

    _v.set(w.pos.x - this.camera.position.x, 0, w.pos.z - this.camera.position.z);
    if (_v.lengthSq() > DESPAWN_SQ || w.life > w.maxLife + 6) {
      this.scene.remove(w.g); w.mixer.stopAllAction();
      this.whale = null;
      this.foam.hide();
    }
  }
}
