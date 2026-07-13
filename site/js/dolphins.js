import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { enableWaterPasses } from './render-layers.js';

// Rough-sea escorts arrive only after sustained cruising and remain below local waves.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

const DOLPHIN_PRESETS = new Set([3]);
const MODEL_URL = './assets/animals/fish/dolphin.glb';
const TARGET_LEN = 2.6;
const MODEL_FLIP = 0;
const SPEED_BAND = [10, 20];
const TRIGGER_SUSTAIN = 4;
const DROP_GRACE = 3.5;
const ESCORT_MAX = 85;
const SUB_MIN = 1.0;
const SUB_RANGE = [1.4, 6.5];
const SWIM_MAX = [10, 15];

function orientTo(group, vx, vy, vz) {
  const sp = Math.hypot(vx, vy, vz);
  if (sp < 0.02) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vy / sp, -1, 1)),
    Math.atan2(vx, vz),
    0);
}

export class Dolphins {
  constructor(scene, camera, waveField, boat) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.boat = boat;
    this.time = 0;

    this.pod = null;
    this.inBand = 0;
    this.outBand = 0;
    this.forward = new THREE.Vector3(0, 0, 1);

    this.proto = null;
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
      this.yaw = (size.x > size.z ? Math.PI / 2 : 0) + MODEL_FLIP;
      this.proto.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = false;
        enableWaterPasses(o);
      });
    }, (e) => console.warn('[dolphins] load failed', e));
  }

  _makeDolphin() {
    const model = skeletonClone(this.proto);
    model.rotation.y = this.yaw;
    model.scale.setScalar(this.baseScale * rand(0.85, 1.15));
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(model);
    const mixer = new THREE.AnimationMixer(model);
    if (this.clip) {
      const a = mixer.clipAction(this.clip);
      a.play(); a.time = rand(0, this.clip.duration); a.timeScale = rand(1.0, 1.4);
    }
    return { g, mixer };
  }

  _frame() {
    const b = this.boat;
    if (b.vel && Math.hypot(b.vel.x, b.vel.z) > 0.5) {
      this.forward.set(b.vel.x, 0, b.vel.z).normalize();
    }
    const f = this.forward;
    return { f, r: _v.set(f.z, 0, -f.x) };
  }

  _spawnPod() {
    const b = this.boat;
    const { f, r } = this._frame();
    const rx = r.x, rz = r.z;
    const n = Math.round(rand(3, 5));
    const members = [];
    for (let i = 0; i < n; i++) {
      const { g, mixer } = this._makeDolphin();
      const behind = rand(24, 42), side = rand(-8, 8);
      const px = b.pos.x - f.x * behind + rx * side;
      const pz = b.pos.z - f.z * behind + rz * side;
      const subDepth = rand(SUB_RANGE[0], SUB_RANGE[1]);
      const surf = this.wf ? this.wf.heightAt(px, pz) : 0;
      const pos = new THREE.Vector3(px, surf - subDepth, pz);
      g.position.copy(pos);
      this.scene.add(g);
      members.push({
        g, mixer, pos, prevPos: pos.clone(),
        angle: Math.PI + rand(-0.7, 0.7),
        angleSpeed: (Math.random() < 0.5 ? 1 : -1) * rand(0.2, 0.55),
        radius: rand(2.5, 13), radAmp: rand(0.8, 3), radFreq: rand(0.15, 0.45), radPhase: rand(0, 6.28),
        subDepth, depthFreq: rand(0.2, 0.5), depthPhase: rand(0, 6.28),
        maxSpeed: rand(SWIM_MAX[0], SWIM_MAX[1]), gain: rand(1.6, 2.4),
        exit: rand(0, 6.28),
      });
    }
    this.pod = { members, life: 0, leaving: false };
  }

  _updatePod(dt) {
    const pod = this.pod;
    pod.life += dt;
    const b = this.boat;
    const t = this.time;
    const { f, r } = this._frame();
    const fx = f.x, fz = f.z, rx = r.x, rz = r.z;

    let allGone = true;
    for (const d of pod.members) {
      let tx, ty, tz;
      if (!pod.leaving) {
        d.angle += d.angleSpeed * dt;
        const radius = Math.max(2, d.radius + Math.sin(t * d.radFreq + d.radPhase) * d.radAmp);
        const ca = Math.cos(d.angle) * radius, sa = Math.sin(d.angle) * radius;
        tx = b.pos.x + fx * ca + rx * sa;
        tz = b.pos.z + fz * ca + rz * sa;
        const sub = Math.max(SUB_MIN, d.subDepth + Math.sin(t * d.depthFreq + d.depthPhase) * 0.6);
        ty = (this.wf ? this.wf.heightAt(tx, tz) : 0) - sub;
      } else {
        tx = b.pos.x + Math.sin(d.exit) * 120;
        tz = b.pos.z + Math.cos(d.exit) * 120;
        ty = (this.wf ? this.wf.heightAt(tx, tz) : 0) - (d.subDepth + 4);
      }
      const dvx = tx - d.pos.x, dvy = ty - d.pos.y, dvz = tz - d.pos.z;
      const dist = Math.hypot(dvx, dvy, dvz);
      if (dist > 1e-4) {
        const step = Math.min(dist, Math.min(d.maxSpeed, dist * d.gain) * dt);
        const inv = step / dist;
        d.pos.x += dvx * inv; d.pos.y += dvy * inv; d.pos.z += dvz * inv;
      }
      const surfHere = (this.wf ? this.wf.heightAt(d.pos.x, d.pos.z) : 0) - SUB_MIN;
      if (d.pos.y > surfHere) d.pos.y = surfHere;
      const vx = d.pos.x - d.prevPos.x, vy = d.pos.y - d.prevPos.y, vz = d.pos.z - d.prevPos.z;
      d.prevPos.copy(d.pos);
      d.g.position.copy(d.pos);
      orientTo(d.g, vx, vy, vz);
      const swim = 1 + Math.min(2, Math.hypot(vx, vz) / Math.max(dt, 1e-3) * 0.1);
      d.mixer.update(dt * swim);
      if (d.pos.distanceTo(b.pos) < 55) allGone = false;
    }

    if (pod.leaving && allGone) {
      for (const d of pod.members) { this.scene.remove(d.g); d.mixer.stopAllAction(); }
      this.pod = null;
    }
  }

  update(dt) {
    this.time += dt;
    const b = this.boat;

    const preset = this.wf.preset;
    const inRange = DOLPHIN_PRESETS.has(preset)
      && b.speedKn >= SPEED_BAND[0] && b.speedKn <= SPEED_BAND[1];

    if (inRange) { this.inBand += dt; this.outBand = 0; }
    else { this.inBand = Math.max(0, this.inBand - dt * 1.5); this.outBand += dt; }
    if (this.inBand >= 1) this._load();
    if (!this.proto) return;

    if (!this.pod && DOLPHIN_PRESETS.has(preset) && this.inBand >= TRIGGER_SUSTAIN) {
      this._spawnPod();
    }

    if (this.pod) {
      if (!this.pod.leaving && (this.outBand >= DROP_GRACE || this.pod.life >= ESCORT_MAX)) {
        this.pod.leaving = true;
      }
      this._updatePod(dt);
    }
  }
}
