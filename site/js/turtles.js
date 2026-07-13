import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { showInRefraction } from './render-layers.js';

// The rig faces -Z even though its extended flippers make X the longest bound.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, t, k) => a + Math.atan2(Math.sin(t - a), Math.cos(t - a)) * k;

const CALM_PRESET = 1;
const MODEL_URL = './assets/animals/turtle.glb';
const TARGET_LEN = 1.9;
const MODEL_YAW = Math.PI;
const DEPTH = [-4.2, -1.5];
const SPAWN = [58, 96];
const DESPAWN = 150;
const MAX_N = 2;
const INTERVAL = [12, 30];
const BOAT_FLEE_R = 9;
const BOAT_LEAD = 1.0;

function orientTo(group, vx, vy, vz) {
  const sp = Math.hypot(vx, vy, vz);
  if (sp < 1e-4) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vy / sp, -1, 1)),
    Math.atan2(vx, vz),
    0);
}

export class Turtles {
  constructor(scene, camera, waveField, boat) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.boat = boat;
    this.time = 0;

    this.turtles = [];
    this.timer = rand(3, INTERVAL[0]);

    this.proto = null;
    this.clip = null;
    this.baseScale = 1;
    this.yaw = 0;
    this.loadStarted = false;
  }

  _load() {
    if (this.loadStarted) return;
    this.loadStarted = true;
    loadGLTFDeferred(MODEL_URL, (gltf) => {
      this.proto = gltf.scene;
      this.clip = gltf.animations.find(c => /swim/i.test(c.name)) || gltf.animations[0];
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      this.baseScale = TARGET_LEN / Math.max(size.x, size.z, 1e-3);
      this.yaw = MODEL_YAW;
      this.proto.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = false;
        showInRefraction(o);
      });
    }, (e) => console.warn('[turtles] load failed', e));
  }

  _make() {
    const model = skeletonClone(this.proto);
    model.rotation.y = this.yaw;
    model.scale.setScalar(this.baseScale * rand(0.85, 1.25));
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(model);
    const mixer = new THREE.AnimationMixer(model);
    if (this.clip) {
      const a = mixer.clipAction(this.clip);
      a.play(); a.time = rand(0, this.clip.duration); a.timeScale = rand(0.5, 0.8);
    }
    return { g, mixer };
  }

  _spawn() {
    const cam = this.camera.position;
    const bearing = rand(0, Math.PI * 2), R = rand(SPAWN[0], SPAWN[1]);
    const { g, mixer } = this._make();
    const pos = new THREE.Vector3(
      cam.x + Math.sin(bearing) * R, rand(DEPTH[0], DEPTH[1]), cam.z + Math.cos(bearing) * R);
    g.position.copy(pos);
    this.scene.add(g);
    const heading = Math.atan2(
      cam.x + rand(-9, 9) - pos.x, cam.z + rand(-9, 9) - pos.z);
    this.turtles.push({
      g, mixer, pos, heading,
      speed: rand(0.55, 1.05),
      wanderPhase: rand(0, 6.28), wanderFreq: rand(0.05, 0.14),
      depthBase: pos.y, depthPhase: rand(0, 6.28), depthFreq: rand(0.03, 0.08), depthAmp: rand(0.5, 1.2),
      life: 0,
    });
  }

  _boatThreat(px, pz) {
    const b = this.boat;
    if (!b) return null;
    const vx = b.vel ? b.vel.x : 0, vz = b.vel ? b.vel.z : 0;
    const v2 = vx * vx + vz * vz;
    let cx, cz;
    if (v2 > 1) {
      let ts = ((px - b.pos.x) * vx + (pz - b.pos.z) * vz) / v2;
      ts = Math.max(0, Math.min(BOAT_LEAD, ts));
      cx = b.pos.x + vx * ts; cz = b.pos.z + vz * ts;
    } else { cx = b.pos.x; cz = b.pos.z; }
    let dx = px - cx, dz = pz - cz, cd = Math.hypot(dx, dz);
    if (cd >= BOAT_FLEE_R) return null;
    if (cd < 0.4 && v2 > 1) { const vn = Math.sqrt(v2); dx = -vz / vn; dz = vx / vn; cd = 1; }
    const inv = 1 / (cd || 1e-3);
    return { ax: dx * inv, az: dz * inv, u: 1 - cd / BOAT_FLEE_R };
  }

  _update(f, dt) {
    const t = this.time;
    f.life += dt;
    f.heading += Math.sin(t * f.wanderFreq + f.wanderPhase) * 0.02 * dt;
    let speed = f.speed;
    const th = this._boatThreat(f.pos.x, f.pos.z);
    if (th) {
      f.heading = angLerp(f.heading, Math.atan2(th.ax, th.az), Math.min(1, dt * 3.5));
      speed = 1.4 + th.u * 2.2;
    }
    f.pos.x += Math.sin(f.heading) * speed * dt;
    f.pos.z += Math.cos(f.heading) * speed * dt;
    const targetY = THREE.MathUtils.clamp(
      f.depthBase + Math.sin(t * f.depthFreq + f.depthPhase) * f.depthAmp, DEPTH[0], DEPTH[1]);
    const vy = targetY - f.pos.y;
    f.pos.y += vy * Math.min(1, dt * 1.2);
    f.g.position.copy(f.pos);
    orientTo(f.g, Math.sin(f.heading) * speed, vy, Math.cos(f.heading) * speed);
    f.mixer.update(dt);
  }

  update(dt) {
    this.time += dt;
    const preset = this.wf.preset;
    if (preset === CALM_PRESET && this.time > 1.5) this._load();
    if (!this.proto) return;

    if (preset === CALM_PRESET) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.turtles.length < MAX_N) this._spawn();
        this.timer = rand(INTERVAL[0], INTERVAL[1]);
      }
    }

    const cam = this.camera.position;
    for (let i = this.turtles.length - 1; i >= 0; i--) {
      const f = this.turtles[i];
      this._update(f, dt);
      _v.set(f.pos.x - cam.x, 0, f.pos.z - cam.z);
      if (_v.length() > DESPAWN || f.life > 180) {
        this.scene.remove(f.g); f.mixer.stopAllAction();
        this.turtles.splice(i, 1);
      }
    }
  }
}
