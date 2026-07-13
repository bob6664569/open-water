import * as THREE from 'three';
import { loadGLTFDeferred } from '../runtime/deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// Calm-weather macaws use their GLB wing animation and a separate parrot audio bus.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, t, k) => a + Math.atan2(Math.sin(t - a), Math.cos(t - a)) * k;

const CALM_PRESET = 1;
const DESPAWN_NORMAL_SQ = 620 * 620;
const DESPAWN_LEAVING_SQ = 380 * 380;

const SPECIES = {
  macaw: {
    url: './assets/animals/scarlet_macaw.glb', clip: /fly/i, skinned: true, unlitToStd: true,
    span: 1.05, yaw: 0, flip: 0, pitch: 0, role: 'flock', group: [2, 4],
    max: 4, interval: [7, 17], alt: [24, 46], speed: [8, 12.5], flap: [1.1, 1.5],
    voice: 'parrot', cry: [2.6, 6.5],
  },
};
const SPECIES_KEYS = Object.keys(SPECIES);

function countSpecies(items, key) {
  let count = 0;
  for (const item of items) if (item.key === key) count++;
  return count;
}

const CRY_RANGE = 260;

export class Birds {
  constructor(scene, camera, waveField, audio = null) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.audio = audio;
    this.time = 0;

    this.flights = [];
    this.timers = {};
    this.protos = {};
    this.loading = new Set();
  }

  _load(key) {
    if (this.protos[key] || this.loading.has(key)) return;
    this.loading.add(key);
    const sp = SPECIES[key];
    loadGLTFDeferred(sp.url, (gltf) => {
      const root = gltf.scene;
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      const baseScale = sp.span / Math.max(size.x, size.z, 1e-3);
      const clip = gltf.animations.find(c => sp.clip.test(c.name)) || gltf.animations[0];
      root.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = false;
        if (sp.unlitToStd && o.material && o.material.isMeshBasicMaterial) {
          const b = o.material;
          o.material = new THREE.MeshStandardMaterial({
            map: b.map || null, color: b.color ? b.color.clone() : new THREE.Color(0xffffff),
            roughness: 0.85, metalness: 0.0,
          });
        }
      });
      this.protos[key] = { root, clip, baseScale, yaw: sp.yaw + sp.flip, pitch: sp.pitch || 0 };
      this.loading.delete(key);
    }, (e) => {
      this.loading.delete(key);
      console.warn('[birds] load failed', sp.url, e);
    });
  }

  _makeBird(key) {
    const p = this.protos[key], sp = SPECIES[key];
    const model = sp.skinned ? skeletonClone(p.root) : p.root.clone(true);
    model.rotation.set(p.pitch, p.yaw, 0);
    model.scale.setScalar(p.baseScale * rand(0.9, 1.15));
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(model);
    const mixer = new THREE.AnimationMixer(model);
    if (p.clip) {
      const a = mixer.clipAction(p.clip);
      a.play(); a.time = rand(0, p.clip.duration); a.timeScale = rand(sp.flap[0], sp.flap[1]);
    }
    return { g, mixer };
  }

  _offsets(role, n) {
    const off = [];
    if (role === 'vee') {
      off.push([0, 0]);
      for (let i = 1; i < n; i++) {
        const side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2);
        off.push([side * rank * rand(2.6, 3.4), -rank * rand(2.4, 3.2)]);
      }
    } else {
      for (let i = 0; i < n; i++) off.push([rand(-5, 5), rand(-5, 5)]);
    }
    return off;
  }

  _spawnFlight(key) {
    const sp = SPECIES[key], cam = this.camera.position;
    const n = Math.round(rand(sp.group[0], sp.group[1]));
    const bearing = rand(0, Math.PI * 2), R = rand(120, 200);
    const center = new THREE.Vector3(
      cam.x + Math.sin(bearing) * R, rand(sp.alt[0], sp.alt[1]), cam.z + Math.cos(bearing) * R);
    const heading = Math.atan2(cam.x + rand(-40, 40) - center.x, cam.z + rand(-40, 40) - center.z);
    const offs = this._offsets(sp.role, n);
    const members = [];
    for (let i = 0; i < n; i++) {
      const { g, mixer } = this._makeBird(key);
      this.scene.add(g);
      members.push({
        g, mixer, off: offs[i],
        wobP: rand(0, 6.28), wobF: rand(0.4, 1.1), wobA: rand(0.3, 0.9),
        altP: rand(0, 6.28), altF: rand(0.2, 0.5),
      });
    }
    this.flights.push({
      key, center, heading, members,
      speed: rand(sp.speed[0], sp.speed[1]),
      wanderP: rand(0, 6.28), wanderF: rand(0.05, 0.14),
      altBase: center.y, altAmp: rand(1.5, 4), altP: rand(0, 6.28), altF: rand(0.1, 0.24),
      cryTimer: rand(1.5, sp.cry[1]),
      life: 0, leaving: false,
    });
  }

  _updateFlight(fl, dt, leave) {
    const t = this.time;
    fl.life += dt;
    if (leave) fl.leaving = true;

    if (fl.leaving) {
      const cam = this.camera.position;
      const outward = Math.atan2(fl.center.x - cam.x, fl.center.z - cam.z);
      fl.heading = angLerp(fl.heading, outward, Math.min(1, dt * 1.2));
      fl.speed = THREE.MathUtils.damp(fl.speed, 22, 1.2, dt);
      fl.altBase = Math.min(fl.altBase + 5 * dt, 90);
    } else {
      fl.heading += Math.sin(t * fl.wanderF + fl.wanderP) * 0.04 * dt;
    }
    fl.center.x += Math.sin(fl.heading) * fl.speed * dt;
    fl.center.z += Math.cos(fl.heading) * fl.speed * dt;
    fl.center.y = fl.altBase + Math.sin(t * fl.altF + fl.altP) * fl.altAmp;

    const fx = Math.sin(fl.heading), fz = Math.cos(fl.heading);
    const rx = fz, rz = -fx;
    const bank = THREE.MathUtils.clamp(
      -Math.sin(t * fl.wanderF + fl.wanderP) * 3.5, -0.4, 0.4);

    for (const m of fl.members) {
      const ox = m.off[0], oz = m.off[1];
      const wob = Math.sin(t * m.wobF + m.wobP) * m.wobA;
      m.g.position.set(
        fl.center.x + rx * (ox + wob * 0.4) + fx * oz,
        fl.center.y + Math.sin(t * m.altF + m.altP) * 0.6,
        fl.center.z + rz * (ox + wob * 0.4) + fz * oz);
      m.g.rotation.set(0, fl.heading, bank);
      m.mixer.update(dt);
    }
  }

  update(dt) {
    this.time += dt;
    const preset = this.wf.preset;
    const calm = preset === CALM_PRESET;
    if (calm && this.time > 1.5) for (const key of SPECIES_KEYS) this._load(key);

    if (calm) {
      for (const key of SPECIES_KEYS) {
        if (!this.protos[key]) continue;
        const sp = SPECIES[key];
        if (this.timers[key] == null) this.timers[key] = rand(1, sp.interval[0]);
        this.timers[key] -= dt;
        if (this.timers[key] <= 0) {
          if (countSpecies(this.flights, key) < sp.max) this._spawnFlight(key);
          this.timers[key] = rand(sp.interval[0], sp.interval[1]);
        }
      }
    }

    const cam = this.camera.position;
    const canCry = this.audio && this.audio.started;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const fl = this.flights[i];
      this._updateFlight(fl, dt, !calm);
      _v.set(fl.center.x - cam.x, 0, fl.center.z - cam.z);
      const distanceSq = _v.lengthSq();

      if (canCry && !fl.leaving) {
        const sp = SPECIES[fl.key];
        fl.cryTimer -= dt;
        if (fl.cryTimer <= 0) {
          if (distanceSq < CRY_RANGE * CRY_RANGE) {
            const m = fl.members[(Math.random() * fl.members.length) | 0];
            this.audio.birdCall(sp.voice, m.g.position);
          }
          fl.cryTimer = rand(sp.cry[0], sp.cry[1]);
        }
      }

      const limitSq = fl.leaving ? DESPAWN_LEAVING_SQ : DESPAWN_NORMAL_SQ;
      if (distanceSq > limitSq || fl.life > 120) {
        for (const m of fl.members) { this.scene.remove(m.g); m.mixer.stopAllAction(); }
        this.flights.splice(i, 1);
      }
    }
  }
}
