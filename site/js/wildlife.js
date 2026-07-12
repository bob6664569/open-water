import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// Ambient gulls blend flap and glide clips, with a procedural fallback on load failure.
const _v = new THREE.Vector3();

const GULL_SPAWN = {
  2: { max: 14, interval: [2, 6] },
  3: { max: 2, interval: [12, 30] },
};
const STORM_PRESET = 4;

const MODEL_URL   = './assets/animals/flying_seagull.glb';
const TARGET_SPAN = 1.6;
const MODEL_YAW   = 0;
const GUIDED_BIRD_SCALE = typeof window !== 'undefined'
  && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
  ? 2.35
  : 1.85;

const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, target, k) => a + Math.atan2(Math.sin(target - a), Math.cos(target - a)) * k;

let SHARED = null;
function sharedAssets() {
  if (SHARED) return SHARED;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9d4ca, roughness: 0.95, metalness: 0,
    side: THREE.DoubleSide, flatShading: true,
  });
  const L = 0.62;
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0.0, 0.0,  0.09,   0.0, 0.0, -0.10,   L * 0.55, 0.015, -0.05,
    0.0, 0.0, -0.10,   L,  -0.01, -0.16,  L * 0.55, 0.015, -0.05,
  ]), 3));
  wing.computeVertexNormals();
  const body = new THREE.OctahedronGeometry(1, 0);
  body.scale(0.05, 0.045, 0.26);
  return (SHARED = { mat, wing, body });
}
function buildProceduralGull() {
  const { mat, wing, body } = sharedAssets();
  const shoulder = 0.045;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(body, mat));
  const rp = new THREE.Group(); rp.position.x =  shoulder; rp.add(new THREE.Mesh(wing, mat));
  const lp = new THREE.Group(); lp.position.x = -shoulder; lp.scale.x = -1; lp.add(new THREE.Mesh(wing, mat));
  g.add(rp, lp);
  return { visual: g, rp, lp };
}

export class Wildlife {
  constructor(scene, camera, waveField, audio = null) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.audio = audio;
    this.time = 0;

    this.gulls = [];
    this.spawnTimer = rand(2, 6);
    this.cryTimer = rand(2, 5);
    this.spawnRadius = [80, 170];
    this.despawnRadius = 560;
    this.fleeRadius = 320;

    this.proto = null;
    this.clips = null;
    this.baseScale = 1;
    this.loaded = false;
    this.loadStarted = false;
  }

  _load() {
    if (this.loadStarted) return;
    this.loadStarted = true;
    loadGLTFDeferred(MODEL_URL, (gltf) => {
      this.proto = gltf.scene;
      this.clips = gltf.animations;
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      this.baseScale = TARGET_SPAN / Math.max(size.x, size.z, 1e-3);
      this.proto.traverse(o => {
        if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
      });
      this.loaded = true;
    }, (e) => {
      console.warn('[wildlife] gull GLB failed to load, using procedural fallback:', e);
      this.loaded = true;
    });
  }

  _clip(name) { return this.clips && this.clips.find(c => c.name === name); }

  _spawnGull({ position = null, heading: guidedHeading = null, guidedCenter = null } = {}) {
    const cam = this.camera.position;
    const bearing = rand(0, Math.PI * 2);
    const R = rand(this.spawnRadius[0], this.spawnRadius[1]);
    const altBase = position ? position.y : rand(16, 44);
    const pos = position?.clone() || new THREE.Vector3(
      cam.x + Math.sin(bearing) * R, altBase, cam.z + Math.cos(bearing) * R);
    const toCam = Math.atan2(cam.x - pos.x, cam.z - pos.z);
    const heading = Number.isFinite(guidedHeading)
      ? guidedHeading
      : toCam + (Math.random() < 0.5 ? 1 : -1) * rand(0.7, 1.4);

    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.position.copy(pos);

    const bird = {
      g, pos, heading,
      mixer: null, flapAct: null, glideAct: null, rp: null, lp: null,
      speed: rand(7, 13),
      altBase, altAmp: rand(1.5, 4),
      altPhase: rand(0, 6.28), altFreq: rand(0.12, 0.28),
      wanderPhase: rand(0, 6.28), wanderFreq: rand(0.08, 0.22), wanderAmp: rand(0.12, 0.32),
      glidePhase: rand(0, 6.28), glideFreq: rand(0.1, 0.24),
      restDihedral: rand(0.03, 0.09),
      flapPhase: rand(0, 6.28), flapFreq: rand(5, 9), flapAmp: rand(0.5, 0.72),
      guidedCenter: guidedCenter?.clone() || null,
      guided: !!guidedCenter,
      orbitSign: Math.random() < 0.5 ? -1 : 1,
      orbitRadius: guidedCenter
        ? Math.max(10, Math.hypot(pos.x - guidedCenter.x, pos.z - guidedCenter.z))
        : 0,
      life: 0,
    };

    if (this.proto) {
      const model = skeletonClone(this.proto);
      model.rotation.y = MODEL_YAW;
      model.scale.setScalar(this.baseScale * rand(0.9, 1.2) * (guidedCenter ? GUIDED_BIRD_SCALE : 1));
      g.add(model);

      const mixer = new THREE.AnimationMixer(model);
      const flapClip = this._clip('flap');
      const glideClip = this._clip('planer') || this._clip('planer 2');
      if (flapClip) {
        const a = mixer.clipAction(flapClip);
        a.play(); a.time = rand(0, flapClip.duration); a.timeScale = rand(1.1, 1.5);
        bird.flapAct = a;
      }
      if (glideClip) {
        const a = mixer.clipAction(glideClip);
        a.play(); a.time = rand(0, glideClip.duration); a.setEffectiveWeight(0);
        bird.glideAct = a;
      }
      bird.mixer = mixer;
    } else {
      const { visual, rp, lp } = buildProceduralGull();
      visual.scale.setScalar(rand(0.9, 1.25) * (guidedCenter ? GUIDED_BIRD_SCALE : 1));
      g.add(visual);
      bird.rp = rp; bird.lp = lp;
    }

    this.scene.add(g);
    this.gulls.push(bird);
    return bird;
  }

  spawnGuidedFlockAt(position, count = 14) {
    this._load();
    if (!this.loaded) return false;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + rand(-0.25, 0.25);
      const radius = rand(8, 16);
      const altitude = rand(10, 17);
      const pos = new THREE.Vector3(
        position.x + Math.sin(angle) * radius,
        altitude,
        position.z + Math.cos(angle) * radius,
      );
      const orbitSign = i % 2 ? -1 : 1;
      const bird = this._spawnGull({
        position: pos,
        heading: angle + orbitSign * Math.PI / 2,
        guidedCenter: position,
      });
      bird.orbitSign = orbitSign;
    }
    return true;
  }

  releaseGuidedFlock() {
    for (const bird of this.gulls) {
      if (!bird.guidedCenter) continue;
      bird.guidedCenter = null;
      bird.guided = false;
      bird.life = 0;
    }
  }

  _updateGull(b, dt, flee) {
    const t = this.time;
    b.life += dt;

    if (flee) b.fleeing = true;
    if (b.fleeing) {
      const cam = this.camera.position;
      const outward = Math.atan2(b.pos.x - cam.x, b.pos.z - cam.z);
      b.heading = angLerp(b.heading, outward, Math.min(1, dt * 1.5));
      b.speed = THREE.MathUtils.damp(b.speed, 24, 1.4, dt);
      b.altBase = Math.min(b.altBase + 4 * dt, 85);
      b.pos.x += Math.sin(b.heading) * b.speed * dt;
      b.pos.z += Math.cos(b.heading) * b.speed * dt;
      b.pos.y = b.altBase;
      if (b.mixer) {
        if (b.flapAct)  b.flapAct.setEffectiveWeight(0.9);
        if (b.glideAct) b.glideAct.setEffectiveWeight(0.1);
        b.mixer.update(dt);
      } else if (b.rp) {
        b.flapPhase += b.flapFreq * 1.3 * dt;
        const d = b.restDihedral + Math.sin(b.flapPhase) * b.flapAmp;
        b.rp.rotation.z = d; b.lp.rotation.z = d;
      }
      b.g.position.copy(b.pos);
      b.g.rotation.set(0.08, b.heading, 0);
      return;
    }

    if (b.guidedCenter) {
      const dx = b.pos.x - b.guidedCenter.x;
      const dz = b.pos.z - b.guidedCenter.z;
      const angle = Math.atan2(dx, dz);
      const tangent = angle + b.orbitSign * Math.PI / 2;
      const radialError = Math.hypot(dx, dz) - b.orbitRadius;
      const desired = tangent + b.orbitSign * THREE.MathUtils.clamp(radialError * 0.025, -0.35, 0.35);
      b.heading = angLerp(b.heading, desired, Math.min(1, dt * 1.8));
      b.pos.x += Math.sin(b.heading) * b.speed * dt;
      b.pos.z += Math.cos(b.heading) * b.speed * dt;
      b.pos.y = b.altBase + Math.sin(this.time * b.altFreq + b.altPhase) * b.altAmp;
      if (b.mixer) b.mixer.update(dt);
      else if (b.rp) {
        b.flapPhase += b.flapFreq * dt;
        const d = b.restDihedral + Math.sin(b.flapPhase) * b.flapAmp;
        b.rp.rotation.z = d; b.lp.rotation.z = d;
      }
      b.g.position.copy(b.pos);
      b.g.rotation.set(0, b.heading, -b.orbitSign * 0.22);
      return;
    }

    const rough = this.wf.preset === 3 ? 1 : 0;
    const gust = rough * Math.sin(t * (1.6 + b.wanderFreq * 3) + b.wanderPhase * 2.3);

    const wander = Math.sin(t * b.wanderFreq + b.wanderPhase) * b.wanderAmp * (1 + rough * 2.2)
                 + gust * 0.18;
    b.heading += wander * dt;
    b.pos.x += Math.sin(b.heading) * b.speed * dt;
    b.pos.z += Math.cos(b.heading) * b.speed * dt;
    b.pos.y = b.altBase + Math.sin(t * b.altFreq + b.altPhase) * b.altAmp * (1 + rough * 1.3)
            + gust * 0.8;

    const glide = THREE.MathUtils.smoothstep(
      Math.sin(t * b.glideFreq + b.glidePhase), -0.1, 0.7);

    if (b.mixer) {
      if (b.flapAct)  b.flapAct.setEffectiveWeight(1 - glide);
      if (b.glideAct) b.glideAct.setEffectiveWeight(glide);
      b.mixer.update(dt);
    } else if (b.rp) {
      b.flapPhase += b.flapFreq * (1 - glide * 0.85) * dt;
      const dihedral = b.restDihedral + glide * 0.12 + Math.sin(b.flapPhase) * b.flapAmp * (1 - glide);
      b.rp.rotation.z = dihedral;
      b.lp.rotation.z = dihedral;
    }

    const bank = THREE.MathUtils.clamp(
      -wander * 6 + gust * 0.5, -0.5 - rough * 0.35, 0.5 + rough * 0.35);
    b.g.position.copy(b.pos);
    b.g.rotation.set(rough * gust * 0.12, b.heading, bank);
  }

  update(dt) {
    this.time += dt;
    const preset = this.wf.preset;
    const cfg = GULL_SPAWN[preset];
    if (this.time > 1.5 && (cfg || this.gulls.length)) this._load();
    if (!this.loaded) return;
    if (cfg) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.gulls.length < cfg.max) {
        this._spawnGull();
        this.spawnTimer = rand(cfg.interval[0], cfg.interval[1]);
      }
    }

    const flee = preset >= STORM_PRESET;

    const cam = this.camera.position;
    for (let i = this.gulls.length - 1; i >= 0; i--) {
      const b = this.gulls[i];
      this._updateGull(b, dt, flee);
      const limit = b.fleeing ? this.fleeRadius : this.despawnRadius;
      _v.set(b.pos.x - cam.x, 0, b.pos.z - cam.z);
      if (!b.guidedCenter && (_v.length() > limit || b.life > 90)) {
        this.scene.remove(b.g);
        if (b.mixer) b.mixer.stopAllAction();
        this.gulls.splice(i, 1);
      }
    }

    if (this.audio && this.audio.started && this.gulls.length) {
      this.cryTimer -= dt;
      if (this.cryTimer <= 0) {
        const b = this.gulls[Math.floor(Math.random() * this.gulls.length)];
        this.audio.gullCall(b.pos);
        this.cryTimer = rand(2.4, 6.5) / Math.min(3, 0.7 + this.gulls.length * 0.5);
      }
    } else {
      this.cryTimer = rand(1.5, 3.5);
    }
  }
}
