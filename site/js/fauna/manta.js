import * as THREE from 'three';
import { loadGLTFDeferred } from '../runtime/deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { showInRefraction } from '../rendering/render-layers.js';
import { sampleBoatThreat } from './fauna-math.js';

// The model's nearly square bounds make automatic heading detection unreliable.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, t, k) => a + Math.atan2(Math.sin(t - a), Math.cos(t - a)) * k;

const CALM_PRESET = 1;
const MODEL_URL = './assets/animals/manta_ray.glb';
const TARGET_SPAN = 4.6;
const LEN_AXIS = 'z';
const FLIP = 0;
const DEPTH = [-4.6, -2.6];
const SPAWN = [60, 100];
const DESPAWN = 155;
const DESPAWN_SQ = DESPAWN * DESPAWN;
const MAX_N = 1;
const INTERVAL = [16, 40];
const BOAT_FLEE_R = 12;
const BOAT_LEAD = 1.0;

function orientTo(group, vx, vy, vz) {
  const sp = Math.hypot(vx, vy, vz);
  if (sp < 1e-4) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vy / sp, -1, 1)),
    Math.atan2(vx, vz),
    0);
}

export class Mantas {
  constructor(scene, camera, waveField, boat) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.boat = boat;
    this.time = 0;

    this.mantas = [];
    this.timer = rand(4, INTERVAL[0]);

    this.proto = null;
    this.clip = null;
    this.baseScale = 1;
    this.yaw = 0;
    this.loadStarted = false;
    this.threat = { ax: 0, az: 0, u: 0 };
  }

  _load() {
    if (this.loadStarted) return;
    this.loadStarted = true;
    loadGLTFDeferred(MODEL_URL, (gltf) => {
      this.proto = gltf.scene;
      this.clip = gltf.animations.find(c => /swim/i.test(c.name)) || gltf.animations[0];
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      this.baseScale = TARGET_SPAN / Math.max(size.x, size.z, 1e-3);
      this.yaw = (LEN_AXIS === 'x' ? Math.PI / 2 : 0) + FLIP;
      this.proto.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = false;
        showInRefraction(o);
      });
    }, (e) => console.warn('[manta] load failed', e));
  }

  _make() {
    const model = skeletonClone(this.proto);
    model.rotation.y = this.yaw;
    model.scale.setScalar(this.baseScale * rand(0.85, 1.2));
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(model);
    const mixer = new THREE.AnimationMixer(model);
    if (this.clip) {
      const a = mixer.clipAction(this.clip);
      a.play(); a.time = rand(0, this.clip.duration); a.timeScale = rand(0.5, 0.75);
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
      cam.x + rand(-12, 12) - pos.x, cam.z + rand(-12, 12) - pos.z);
    this.mantas.push({
      g, mixer, pos, heading,
      speed: rand(0.7, 1.3),
      wanderPhase: rand(0, 6.28), wanderFreq: rand(0.04, 0.1),
      depthBase: pos.y, depthPhase: rand(0, 6.28), depthFreq: rand(0.025, 0.06), depthAmp: rand(0.5, 1.0),
      life: 0,
    });
  }

  _boatThreat(px, pz) {
    return sampleBoatThreat(this.boat, px, pz, BOAT_FLEE_R, this.threat, BOAT_LEAD)
      ? this.threat
      : null;
  }

  _update(f, dt) {
    const t = this.time;
    f.life += dt;
    f.heading += Math.sin(t * f.wanderFreq + f.wanderPhase) * 0.02 * dt;
    let speed = f.speed;
    const th = this._boatThreat(f.pos.x, f.pos.z);
    if (th) {
      f.heading = angLerp(f.heading, Math.atan2(th.ax, th.az), Math.min(1, dt * 2.2));
      speed = 1.4 + th.u * 1.8;
    }
    f.pos.x += Math.sin(f.heading) * speed * dt;
    f.pos.z += Math.cos(f.heading) * speed * dt;
    const targetY = THREE.MathUtils.clamp(
      f.depthBase + Math.sin(t * f.depthFreq + f.depthPhase) * f.depthAmp, DEPTH[0], DEPTH[1]);
    const vy = targetY - f.pos.y;
    f.pos.y += vy * Math.min(1, dt * 1.0);
    f.g.position.copy(f.pos);
    orientTo(f.g, Math.sin(f.heading) * speed, vy, Math.cos(f.heading) * speed);
    f.mixer.update(dt);
  }

  update(dt) {
    this.time += dt;
    if (this.wf.preset === CALM_PRESET && this.time > 1.5) this._load();
    if (!this.proto) return;

    if (this.wf.preset === CALM_PRESET) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.mantas.length < MAX_N) this._spawn();
        this.timer = rand(INTERVAL[0], INTERVAL[1]);
      }
    }

    const cam = this.camera.position;
    for (let i = this.mantas.length - 1; i >= 0; i--) {
      const f = this.mantas[i];
      this._update(f, dt);
      _v.set(f.pos.x - cam.x, 0, f.pos.z - cam.z);
      if (_v.lengthSq() > DESPAWN_SQ || f.life > 200) {
        this.scene.remove(f.g); f.mixer.stopAllAction();
        this.mantas.splice(i, 1);
      }
    }
  }
}
