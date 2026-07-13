import * as THREE from 'three';
import { loadGLTFDeferred } from '../runtime/deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { showInRefraction } from '../rendering/render-layers.js';
import { sampleBoatThreat } from './fauna-math.js';

// Underwater fauna render on the refraction layer and react to the boat's future path.
const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, target, k) => a + Math.atan2(Math.sin(target - a), Math.cos(target - a)) * k;
const turnToward = (a, target, maxStep) => a + THREE.MathUtils.clamp(
  Math.atan2(Math.sin(target - a), Math.cos(target - a)), -maxStep, maxStep);
const moveToward = (value, target, maxStep) => value + THREE.MathUtils.clamp(target - value, -maxStep, maxStep);

const FISH_DIR = './assets/animals/fish/';
const DEPTH = [-2.4, -0.9];
const DESPAWN = 145;
const DESPAWN_SQ = DESPAWN * DESPAWN;
const FISH_FLIP = 0;
const BOAT_FLEE_R = 8;
const BOAT_FLEE_STR = 11;
const BOAT_LEAD = 1.0;
const SCHOOL_REARM_COOLDOWN = 8;
const SCHOOL_CALM_TO_REARM = 4;
const SHARK_NOTICE_R = 65;
const SHARK_AVOID_R = 11;

const SPECIES = {
  tropical:  {
    file: '../tropical-fish-school-512.glb', len: 0.72,
    role: 'school', presets: [1], max: 4, interval: [5, 12],
    schoolSize: [3, 7], soloChance: 0.2, duoChance: 0.25,
    spawnRadius: [32, 72], spread: 4.5,
    speed: [0.55, 0.95], memberSpeed: [0.45, 0.85], behavior: 'packed-school',
    cohesion: 0.25, alignment: 0.55, separation: 0.8,
  },
  tuna:      { file: 'tuna.glb',      clip: 'Fish_Armature|Swimming_Normal', len: 0.95, tint: null,     girth: 0.6,  role: 'school', presets: [2], max: 3, interval: [9, 22] },
  swordfish: { file: 'swordfish.glb', clip: 'Fish_Armature|Swimming_Normal', len: 1.5,  tint: null,     girth: 0.48, role: 'solo',   presets: [2], max: 2, interval: [8, 20] },
  shark:     { file: 'shark.glb',     clip: 'Action_Shark Armature', len: 5.6, tint: null, flip: 0, role: 'solo',   presets: [3], max: 1, interval: [10, 24], behavior: 'shark' },
};
const SPECIES_KEYS = Object.keys(SPECIES);

function countSpecies(items, key) {
  let count = 0;
  for (const item of items) if (item.key === key) count++;
  return count;
}

let GUIDED_FALLBACK_ASSETS = null;
const NOOP_MIXER = Object.freeze({ update() {}, stopAllAction() {} });

function guidedFallbackAssets() {
  if (GUIDED_FALLBACK_ASSETS) return GUIDED_FALLBACK_ASSETS;
  const body = new THREE.SphereGeometry(1, 9, 6);
  body.scale(0.28, 0.2, 0.78);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.58,  -0.42, 0.3, -1.02,  -0.42, -0.3, -1.02,
  ]), 3));
  tail.computeVertexNormals();
  const colors = [0xd5f7ff, 0x82e6f2, 0xffe69a, 0xb5d9ff];
  const materials = colors.map(color => new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide,
  }));
  GUIDED_FALLBACK_ASSETS = { body, tail, materials };
  return GUIDED_FALLBACK_ASSETS;
}

function orientTo(group, vel) {
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  if (sp < 1e-5) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vel.y / sp, -1, 1)),
    Math.atan2(vel.x, vel.z),
    0);
}

function clampDepth(pos, upper = DEPTH[1]) {
  if (pos.y > upper) pos.y = upper;
  else if (pos.y < DEPTH[0]) pos.y = DEPTH[0];
}

export class FishLife {
  constructor(scene, camera, waveField, boat = null) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.boat = boat;
    this.time = 0;

    this.protos = {};
    this.schools = [];
    this.solos = [];
    this.dispersedSchools = 0;
    this.timers = {};
    this.loading = new Set();
    this.threat = { ax: 0, az: 0, u: 0 };
  }

  _load(key) {
    if (this.protos[key] || this.loading.has(key)) return;
    this.loading.add(key);
    const sp = SPECIES[key];
    loadGLTFDeferred(FISH_DIR + sp.file, (gltf) => {
      if (sp.behavior === 'packed-school') {
        const variants = this._splitPackedSchool(gltf, sp);
        if (!variants.length) {
          this.loading.delete(key);
          console.warn('[fish] no individual fish found in', sp.file);
          return;
        }
        this.protos[key] = { variants };
        this.loading.delete(key);
        return;
      }
      const root = gltf.scene;
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      let baseScale, lenAxis, rotX = 0, rotY;
      const flip = sp.flip ?? FISH_FLIP;
      if (sp.axisFix === 'y') {
        baseScale = sp.len / Math.max(size.y, 1e-3);
        lenAxis = 'y'; rotX = Math.PI / 2; rotY = flip;
      } else {
        baseScale = sp.len / Math.max(size.x, size.z, 1e-3);
        lenAxis = size.x >= size.z ? 'x' : 'z';
        rotY = (lenAxis === 'x' ? Math.PI / 2 : 0) + flip;
      }
      root.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = false;
        showInRefraction(o);
        if (sp.tint != null && o.material) {
          o.material = o.material.clone();
          o.material.color = new THREE.Color(sp.tint);
        }
      });
      const clip = gltf.animations.find(c => c.name === sp.clip) || gltf.animations[0];
      this.protos[key] = { root, clip, baseScale, lenAxis, rotX, rotY };
      this.loading.delete(key);
    }, (e) => {
      this.loading.delete(key);
      console.warn('[fish] load failed', sp.file, e);
    });
  }

  _splitPackedSchool(gltf, sp) {
    // The tropical asset shares one skeleton across nine fish. Split triangles by
    // bone prefix and retain only the matching animation tracks for each variant.
    const prefixes = new Set();
    gltf.scene.traverse(o => {
      if (!o.isBone) return;
      const match = o.name.match(/^(.+?)Root(?:\d|$)/);
      if (match) prefixes.add(match[1]);
    });

    const clip = gltf.animations[0];
    const variants = [];
    for (const prefix of prefixes) {
      const root = skeletonClone(gltf.scene);
      let triangleCount = 0;
      root.traverse(o => {
        if (!o.isSkinnedMesh) return;
        const filtered = this._geometryForBones(o, prefix);
        if (!filtered) {
          o.visible = false;
          return;
        }
        o.geometry = filtered;
        o.frustumCulled = false;
        o.castShadow = false;
        showInRefraction(o);
        triangleCount += filtered.index.count / 3;
      });
      if (!triangleCount) continue;

      const tracks = clip ? clip.tracks.filter(t => t.name.startsWith(prefix)) : [];
      const individualClip = tracks.length
        ? new THREE.AnimationClip(prefix + '_swim', clip.duration, tracks)
        : null;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().makeEmpty();
      const vertex = new THREE.Vector3();
      root.traverse(o => {
        if (!o.isSkinnedMesh || !o.visible || !o.geometry.index) return;
        o.skeleton.update();
        const index = o.geometry.index;
        const visited = new Set();
        for (let i = 0; i < index.count; i++) {
          const vertexIndex = index.getX(i);
          if (visited.has(vertexIndex)) continue;
          visited.add(vertexIndex);
          o.getVertexPosition(vertexIndex, vertex);
          box.expandByPoint(o.localToWorld(vertex));
        }
      });
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.x + size.y + size.z) || size.lengthSq() < 1e-6) continue;
      root.position.sub(center);
      const centeredRoot = new THREE.Group();
      centeredRoot.add(root);

      const lenAxis = size.x >= size.z ? 'x' : 'z';
      variants.push({
        root: centeredRoot,
        clip: individualClip,
        baseScale: sp.len / Math.max(size.x, size.z, 1e-3),
        lenAxis,
        rotX: 0,
        rotY: lenAxis === 'x' ? Math.PI / 2 : 0,
      });
    }
    return variants;
  }

  _geometryForBones(mesh, prefix) {
    const geometry = mesh.geometry;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const sourceIndex = geometry.index;
    if (!skinIndex || !skinWeight || !sourceIndex || !mesh.skeleton) return null;

    const owner = new Uint8Array(skinIndex.count);
    for (let i = 0; i < skinIndex.count; i++) {
      let bestSlot = 0;
      for (let slot = 1; slot < skinWeight.itemSize; slot++) {
        if (skinWeight.getComponent(i, slot) > skinWeight.getComponent(i, bestSlot)) bestSlot = slot;
      }
      const bone = mesh.skeleton.bones[skinIndex.getComponent(i, bestSlot)];
      owner[i] = bone && bone.name.startsWith(prefix) ? 1 : 0;
    }

    const kept = [];
    for (let i = 0; i < sourceIndex.count; i += 3) {
      const a = sourceIndex.getX(i), b = sourceIndex.getX(i + 1), c = sourceIndex.getX(i + 2);
      if (owner[a] + owner[b] + owner[c] >= 2) kept.push(a, b, c);
    }
    if (!kept.length) return null;

    const filtered = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) filtered.setAttribute(name, attribute);
    for (const [name, attributes] of Object.entries(geometry.morphAttributes)) filtered.morphAttributes[name] = attributes;
    filtered.morphTargetsRelative = geometry.morphTargetsRelative;
    filtered.setIndex(kept);
    filtered.computeBoundingBox();
    filtered.computeBoundingSphere();
    return filtered;
  }

  _make(key) {
    const proto = this.protos[key];
    const p = proto.variants
      ? proto.variants[Math.floor(Math.random() * proto.variants.length)]
      : proto;
    const model = skeletonClone(p.root);
    model.rotation.set(p.rotX, p.rotY, 0);
    const s = p.baseScale * rand(0.82, 1.2);
    model.scale.set(s, s, s);
    const girth = SPECIES[key].girth ?? 1;
    if (girth !== 1 && p.lenAxis !== 'y') {
      model.scale.y *= girth;
      if (p.lenAxis === 'x') model.scale.z *= girth; else model.scale.x *= girth;
    }
    const g = new THREE.Group();
    g.add(model);
    const mixer = new THREE.AnimationMixer(model);
    if (p.clip) {
      const a = mixer.clipAction(p.clip);
      a.play(); a.time = rand(0, p.clip.duration); a.timeScale = rand(0.9, 1.4);
    }
    return { g, model, mixer };
  }

  _spawnSchool(key, { center: guidedCenter = null, heading: guidedHeading = null } = {}) {
    const cam = this.camera.position;
    const sp = SPECIES[key];
    const spawnRadius = sp.spawnRadius || [65, 105];
    const bearing = rand(0, Math.PI * 2), R = rand(spawnRadius[0], spawnRadius[1]);
    const guided = !!guidedCenter;
    const center = guided
      ? guidedCenter.clone().setY(this.wf.heightAt(guidedCenter.x, guidedCenter.z) - 0.42)
      : new THREE.Vector3(
        cam.x + Math.sin(bearing) * R,
        rand(DEPTH[0] + 0.4, DEPTH[1] - 0.4),
        cam.z + Math.cos(bearing) * R,
      );
    const heading = Number.isFinite(guidedHeading)
      ? guidedHeading
      : Math.atan2(cam.x + rand(-8, 8) - center.x, cam.z + rand(-8, 8) - center.z);

    const schoolSize = sp.schoolSize || [22, 34];
    const spread = sp.spread || 5;
    const groupRoll = Math.random();
    const n = groupRoll < (sp.soloChance || 0)
      ? 1
      : groupRoll < (sp.soloChance || 0) + (sp.duoChance || 0)
        ? 2
        : Math.round(rand(schoolSize[0], schoolSize[1]));
    const members = [];
    const v0 = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    for (let i = 0; i < n; i++) {
      const { g, mixer } = this._make(key);
      if (guided) g.scale.multiplyScalar(1.35);
      const pos = center.clone().add(new THREE.Vector3(
        rand(-spread, spread),
        guided ? rand(-0.22, 0.18) : rand(-Math.min(1.5, spread * 0.3), Math.min(1.5, spread * 0.3)),
        rand(-spread, spread)));
      clampDepth(pos, guided ? this.wf.heightAt(center.x, center.z) - 0.12 : DEPTH[1]);
      g.position.copy(pos);
      this.scene.add(g);
      const memberSpeed = sp.memberSpeed || [0.6, 1.1];
      members.push({ g, mixer, pos, vel: v0.clone().multiplyScalar(rand(memberSpeed[0], memberSpeed[1])) });
    }
    this.schools.push({
      key, center, members,
      guided,
      heading, speed: rand(...(sp.speed || [1.1, 2.0])),
      cohesion: sp.cohesion ?? 0.6,
      alignment: sp.alignment ?? 0.8,
      separation: sp.separation ?? 0.5,
      wanderPhase: rand(0, 6.28), wanderFreq: rand(0.05, 0.16),
      depthPhase: rand(0, 6.28), depthFreq: rand(0.03, 0.09),
      scatterTime: 0, scattered: false, scatterCooldown: 0, calmTime: 0,
      regroupRadius: Math.max(6, spread * 1.75),
      life: 0,
    });
    return this.schools[this.schools.length - 1];
  }

  spawnGuidedSchoolsAt(position, heading = 0) {
    const key = this.wf.preset === 2 ? 'tuna' : null;
    if (!key) return [];
    this._load(key);
    if (this.guidedFallbackSchools?.length) return this.guidedFallbackSchools;
    const schools = [];
    for (let i = 0; i < 5; i++) {
      const angle = i / 5 * Math.PI * 2 + 0.32;
      const radius = i === 0 ? 0 : 13;
      const center = position.clone().add(new THREE.Vector3(
        Math.sin(angle) * radius, 0, Math.cos(angle) * radius,
      ));
      schools.push(this._spawnGuidedFallbackSchool(center, heading + rand(-0.35, 0.35), 18));
    }
    this.guidedFallbackSchools = schools;
    return schools;
  }

  prepareGuidedSchool() {
    if (this.wf.preset === 2) this._load('tuna');
  }

  _spawnGuidedFallbackSchool(position, heading, count = 18) {
    const { body, tail, materials } = guidedFallbackAssets();
    const surfaceY = this.wf.heightAt(position.x, position.z);
    const center = position.clone().setY(surfaceY - 0.38);
    const members = [];
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    for (let i = 0; i < count; i++) {
      const material = materials[i % materials.length];
      const g = new THREE.Group();
      const bodyMesh = new THREE.Mesh(body, material);
      const tailMesh = new THREE.Mesh(tail, material);
      showInRefraction(bodyMesh);
      showInRefraction(tailMesh);
      g.add(bodyMesh, tailMesh);
      g.scale.setScalar(rand(1.35, 1.9));
      const angle = rand(0, Math.PI * 2);
      const radius = Math.sqrt(Math.random()) * 5.8;
      const pos = center.clone().add(new THREE.Vector3(
        Math.sin(angle) * radius,
        rand(-0.14, 0.18),
        Math.cos(angle) * radius,
      ));
      clampDepth(pos, surfaceY - 0.12);
      g.position.copy(pos);
      this.scene.add(g);
      members.push({
        g, mixer: NOOP_MIXER, pos,
        vel: forward.clone().multiplyScalar(rand(0.65, 1.05)),
      });
    }
    const school = {
      key: 'guided-fallback', center, members, guided: true,
      guidedEncounter: true, anchored: true,
      heading, speed: 0.38,
      cohesion: 0.58, alignment: 0.5, separation: 0.72,
      wanderPhase: rand(0, 6.28), wanderFreq: 0.07,
      depthPhase: rand(0, 6.28), depthFreq: 0.06,
      scatterTime: 0, scattered: false, scatterCooldown: 0, calmTime: 0,
      regroupRadius: 9, life: 0,
    };
    this.schools.push(school);
    return school;
  }

  _scatterGuidedSchool(school) {
    if (!school || school.scattered || !school.guided || !this.boat) return false;
    for (const member of school.members) {
      let dx = member.pos.x - this.boat.pos.x;
      let dz = member.pos.z - this.boat.pos.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.25) {
        const side = Math.random() < 0.5 ? -1 : 1;
        dx = -(this.boat.vel?.z || 1) * side;
        dz = (this.boat.vel?.x || 0) * side;
      }
      const inv = 1 / Math.max(Math.hypot(dx, dz), 0.001);
      member.vel.set(dx * inv * rand(5.5, 8.5), rand(-2.2, -0.7), dz * inv * rand(5.5, 8.5));
    }
    school.scattered = true;
    school.anchored = false;
    school.guidedEncounter = false;
    school.cohesion = 0.035;
    school.alignment = 0.12;
    school.separation = 1.15;
    school.scatterCooldown = SCHOOL_REARM_COOLDOWN;
    school.calmTime = 0;
    return true;
  }

  scatterGuidedSchools(schools) {
    let scattered = false;
    for (const school of schools || []) scattered = this._scatterGuidedSchool(school) || scattered;
    if (scattered) this.dispersedSchools += 1;
    return scattered;
  }

  removeGuidedSchools(schools) {
    for (const school of schools || []) {
      const index = this.schools.indexOf(school);
      if (index < 0) continue;
      for (const member of school.members) {
        this.scene.remove(member.g);
        member.mixer.stopAllAction();
      }
      this.schools.splice(index, 1);
    }
    if (this.guidedFallbackSchools === schools) this.guidedFallbackSchools = null;
  }

  _spawnSolo(key) {
    const cam = this.camera.position;

    if (SPECIES[key].behavior === 'shark') {
      const ctr = this.boat ? this.boat.pos : this.camera.position;
      const R = rand(38, 58), angle = rand(0, Math.PI * 2);
      const { g, mixer } = this._make(key);
      const pos = new THREE.Vector3(
        ctr.x + Math.sin(angle) * R, rand(DEPTH[0] + 0.2, DEPTH[1] - 0.3), ctr.z + Math.cos(angle) * R);
      const targetAngle = angle + Math.PI + rand(-0.45, 0.45);
      const targetRadius = rand(9, 23);
      const target = new THREE.Vector3(
        ctr.x + Math.sin(targetAngle) * targetRadius,
        rand(DEPTH[0] + 0.25, DEPTH[1] - 0.25),
        ctr.z + Math.cos(targetAngle) * targetRadius);
      const heading = Math.atan2(target.x - pos.x, target.z - pos.z);
      g.position.copy(pos);
      orientTo(g, _v.set(Math.sin(heading), 0, Math.cos(heading)));
      this.scene.add(g);
      this.solos.push({
        g, mixer, pos, key, behavior: 'shark', target, heading,
        speed: rand(2.2, 3.1), cruiseSpeed: rand(2.4, 3.4),
        turnRate: rand(0.38, 0.55), waypointAge: 0, waypointLife: rand(9, 15),
        depthPhase: rand(0, 6.28), depthFreq: rand(0.12, 0.2),
        maxLife: rand(48, 78), leaving: false, life: 0,
      });
      return;
    }

    const bearing = rand(0, Math.PI * 2), R = rand(55, 95);
    const { g, mixer } = this._make(key);
    const pos = new THREE.Vector3(
      cam.x + Math.sin(bearing) * R, rand(DEPTH[0], DEPTH[1]), cam.z + Math.cos(bearing) * R);
    g.position.copy(pos);
    this.scene.add(g);
    const heading = Math.atan2(
      cam.x + rand(-7, 7) - pos.x, cam.z + rand(-7, 7) - pos.z);
    this.solos.push({
      g, mixer, pos, key,
      heading, speed: rand(0.7, 1.5),
      wanderPhase: rand(0, 6.28), wanderFreq: rand(0.08, 0.2),
      depthBase: pos.y, depthPhase: rand(0, 6.28), depthFreq: rand(0.05, 0.14), depthAmp: rand(0.3, 0.9),
      life: 0,
    });
  }

  _boatThreat(px, pz, radius = BOAT_FLEE_R) {
    return sampleBoatThreat(this.boat, px, pz, radius, this.threat, BOAT_LEAD)
      ? this.threat
      : null;
  }

  _updateSchool(s, dt) {
    const t = this.time;
    s.life += dt;
    s.heading += (s.anchored ? 0.08 : Math.sin(t * s.wanderFreq + s.wanderPhase) * 0.015) * dt;
    if (!s.anchored) {
      s.center.x += Math.sin(s.heading) * s.speed * dt;
      s.center.z += Math.cos(s.heading) * s.speed * dt;
    }
    const guidedSurfaceY = s.guided ? this.wf.heightAt(s.center.x, s.center.z) : 0;
    s.center.y = s.guided
      ? guidedSurfaceY - 0.42 + Math.sin(t * s.depthFreq + s.depthPhase) * 0.1
      : THREE.MathUtils.clamp(
        -2.2 + Math.sin(t * s.depthFreq + s.depthPhase) * 0.9, DEPTH[0], DEPTH[1]);

    const schoolVel = _v.set(Math.sin(s.heading), 0, Math.cos(s.heading)).multiplyScalar(s.speed);
    const M = s.members;
    let threatenedMembers = 0;
    let strongestThreat = 0;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      const ax = (s.center.x - m.pos.x) * s.cohesion + (schoolVel.x - m.vel.x) * s.alignment;
      const ay = (s.center.y - m.pos.y) * Math.max(0.65, s.cohesion * 2);
      const az = (s.center.z - m.pos.z) * s.cohesion + (schoolVel.z - m.vel.z) * s.alignment;
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < M.length; j++) {
        if (j === i) continue;
        const o = M[j];
        const dx = m.pos.x - o.pos.x, dy = m.pos.y - o.pos.y, dz = m.pos.z - o.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 2.5 && d2 > 1e-4) { const inv = 1 / d2; sx += dx * inv; sy += dy * inv; sz += dz * inv; }
      }
      m.vel.x += (ax + sx * s.separation + rand(-0.15, 0.15)) * dt;
      m.vel.y += (ay + sy * s.separation) * dt;
      m.vel.z += (az + sz * s.separation + rand(-0.15, 0.15)) * dt;
      let vmax = 2.6;
      const th = this._boatThreat(m.pos.x, m.pos.z, s.guided ? 16 : BOAT_FLEE_R);
      if (th) {
        strongestThreat = Math.max(strongestThreat, th.u);
        if (th.u >= 0.25) threatenedMembers++;
        m.vel.x += th.ax * th.u * BOAT_FLEE_STR * dt;
        m.vel.z += th.az * th.u * BOAT_FLEE_STR * dt;
        m.vel.y -= th.u * 3 * dt;
        vmax = 7.5;
      }
      const sp = Math.hypot(m.vel.x, m.vel.y, m.vel.z) || 1e-5;
      const cl = THREE.MathUtils.clamp(sp, 0.4, vmax) / sp;
      m.vel.multiplyScalar(cl);
      m.pos.addScaledVector(m.vel, dt);
      clampDepth(m.pos, s.guided ? guidedSurfaceY - 0.12 : DEPTH[1]);
      m.g.position.copy(m.pos);
      orientTo(m.g, m.vel);
      m.mixer.update(dt);
    }
    // Pour le tuto, la validation suit enfin ce que le joueur voit : dès
    // qu'un poisson fuit franchement la trajectoire du bateau, ce banc a été
    // réellement traversé. Le guide dispersera ensuite les cinq bancs ensemble.
    if (s.guidedEncounter) {
      if (strongestThreat >= 0.3 && this.boat?.speedKn >= 3) s.encounterHit = true;
      return;
    }

    const scattering = M.length >= 3
      && threatenedMembers / M.length >= (s.guided ? 0.22 : 0.4);
    if (s.scattered) {
      s.scatterCooldown = Math.max(0, s.scatterCooldown - dt);
      s.calmTime = scattering ? 0 : s.calmTime + dt;
      const regroupRadius2 = s.regroupRadius * s.regroupRadius;
      const regroupedMembers = M.reduce((count, member) => {
        const dx = member.pos.x - s.center.x;
        const dy = member.pos.y - s.center.y;
        const dz = member.pos.z - s.center.z;
        return count + (dx * dx + dy * dy + dz * dz <= regroupRadius2 ? 1 : 0);
      }, 0);
      const reformed = regroupedMembers / Math.max(M.length, 1) >= 0.7;
      if (s.scatterCooldown <= 0 && s.calmTime >= SCHOOL_CALM_TO_REARM && reformed) {
        s.scattered = false;
        s.scatterTime = 0;
        s.calmTime = 0;
      }
    } else if (M.length >= 3) {
      const validPass = scattering && this.boat?.speedKn >= 3;
      s.scatterTime = validPass
        ? s.scatterTime + dt
        : Math.max(0, s.scatterTime - dt * 2);
      if (s.scatterTime >= 0.35) {
        s.scattered = true;
        s.scatterCooldown = SCHOOL_REARM_COOLDOWN;
        s.calmTime = 0;
        this.dispersedSchools += 1;
      }
    }
  }

  _setSharkWaypoint(f, leaving = false) {
    // Waypoints are fixed in world space; the shark may inspect a boat snapshot
    // but never inherits the boat's motion or continuously chases its position.
    const b = this.boat;
    f.waypointAge = 0;

    if (leaving) {
      let course = f.heading;
      if (b) {
        const away = Math.atan2(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
        course = turnToward(course, away, 0.7);
      }
      f.target.set(
        f.pos.x + Math.sin(course) * 120,
        DEPTH[0] - 2.2,
        f.pos.z + Math.cos(course) * 120);
      f.waypointLife = 32;
      return;
    }

    const boatDist = b ? Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) : Infinity;
    if (b && boatDist < SHARK_NOTICE_R && Math.random() < 0.7) {
      let best = null;
      let bestTurn = Infinity;
      for (let i = 0; i < 5; i++) {
        const a = rand(0, Math.PI * 2);
        const r = rand(13, 29);
        const x = b.pos.x + Math.sin(a) * r;
        const z = b.pos.z + Math.cos(a) * r;
        const bearing = Math.atan2(x - f.pos.x, z - f.pos.z);
        const turn = Math.abs(Math.atan2(Math.sin(bearing - f.heading), Math.cos(bearing - f.heading)));
        if (turn < bestTurn) { bestTurn = turn; best = { x, z }; }
      }
      f.target.set(best.x, rand(DEPTH[0] + 0.25, DEPTH[1] - 0.25), best.z);
    } else {
      const course = f.heading + rand(-0.7, 0.7);
      const distance = rand(35, 58);
      f.target.set(
        f.pos.x + Math.sin(course) * distance,
        rand(DEPTH[0] + 0.25, DEPTH[1] - 0.25),
        f.pos.z + Math.cos(course) * distance);
    }

    const distance = Math.hypot(f.target.x - f.pos.x, f.target.z - f.pos.z);
    f.waypointLife = THREE.MathUtils.clamp(distance / f.cruiseSpeed + 5, 10, 23);
  }

  _updateShark(f, dt) {
    const t = this.time;
    f.waypointAge += dt;

    if (!f.leaving && f.life > f.maxLife) {
      f.leaving = true;
      this._setSharkWaypoint(f, true);
    } else {
      const targetDist = Math.hypot(f.target.x - f.pos.x, f.target.z - f.pos.z);
      if (!f.leaving && (targetDist < 5 || f.waypointAge > f.waypointLife)) {
        this._setSharkWaypoint(f);
      }
    }

    let desiredHeading = Math.atan2(f.target.x - f.pos.x, f.target.z - f.pos.z);
    let desiredSpeed = f.leaving ? f.cruiseSpeed * 1.08 : f.cruiseSpeed;
    let turnRate = f.turnRate;

    const threat = this._boatThreat(f.pos.x, f.pos.z, SHARK_AVOID_R);
    if (threat) {
      const avoidanceHeading = Math.atan2(threat.ax, threat.az);
      desiredHeading = angLerp(desiredHeading, avoidanceHeading, 0.55 + threat.u * 0.45);
      desiredSpeed = f.cruiseSpeed + 1.1 + threat.u * 1.6;
      turnRate += threat.u * 0.65;
    }

    f.heading = turnToward(f.heading, desiredHeading, turnRate * dt);
    const acceleration = threat ? 1.8 : 0.55;
    f.speed = moveToward(f.speed, desiredSpeed, acceleration * dt);
    f.pos.x += Math.sin(f.heading) * f.speed * dt;
    f.pos.z += Math.cos(f.heading) * f.speed * dt;

    const depthRipple = Math.sin(t * f.depthFreq + f.depthPhase) * 0.16;
    const targetY = f.target.y + depthRipple;
    f.pos.y = moveToward(f.pos.y, targetY, (f.leaving ? 0.5 : 0.28) * dt);

    f.g.position.copy(f.pos);
    orientTo(f.g, _v.set(
      Math.sin(f.heading) * f.speed,
      THREE.MathUtils.clamp(targetY - f.pos.y, -0.3, 0.3),
      Math.cos(f.heading) * f.speed));
    f.mixer.update(dt);
  }

  _updateSolo(f, dt) {
    const t = this.time;
    f.life += dt;

    if (f.behavior === 'shark') {
      this._updateShark(f, dt);
      return;
    }

    f.heading += Math.sin(t * f.wanderFreq + f.wanderPhase) * 0.015 * dt;
    let speed = f.speed;
    const th = this._boatThreat(f.pos.x, f.pos.z);
    if (th) {
      f.heading = angLerp(f.heading, Math.atan2(th.ax, th.az), Math.min(1, dt * 6));
      speed = 5 + th.u * 3;
    }
    f.pos.x += Math.sin(f.heading) * speed * dt;
    f.pos.z += Math.cos(f.heading) * speed * dt;
    const targetY = THREE.MathUtils.clamp(
      f.depthBase + Math.sin(t * f.depthFreq + f.depthPhase) * f.depthAmp, DEPTH[0], DEPTH[1]);
    const vy = (targetY - f.pos.y);
    f.pos.y += vy * Math.min(1, dt * 1.5);
    f.g.position.copy(f.pos);
    orientTo(f.g, _v.set(Math.sin(f.heading) * speed, vy, Math.cos(f.heading) * speed));
    f.mixer.update(dt);
  }

  update(dt) {
    this.time += dt;
    const preset = this.wf.preset;
    for (const key of SPECIES_KEYS) {
      if (this.time > 1.5 && SPECIES[key].presets.includes(preset)) this._load(key);
    }
    const cam = this.camera.position;

    for (const key of SPECIES_KEYS) {
      const sp = SPECIES[key];
      if (!this.protos[key] || !sp.presets.includes(preset)) continue;
      if (this.timers[key] == null) this.timers[key] = rand(0.5, sp.interval[0]);
      this.timers[key] -= dt;
      if (this.timers[key] <= 0) {
        const list = sp.role === 'school' ? this.schools : this.solos;
        if (countSpecies(list, key) < sp.max) {
          if (sp.role === 'school') this._spawnSchool(key); else this._spawnSolo(key);
        }
        this.timers[key] = rand(sp.interval[0], sp.interval[1]);
      }
    }

    for (let i = this.schools.length - 1; i >= 0; i--) {
      const s = this.schools[i];
      this._updateSchool(s, dt);
      _v.set(s.center.x - cam.x, 0, s.center.z - cam.z);
      if (!s.guidedEncounter && (_v.lengthSq() > DESPAWN_SQ || s.life > 165)) {
        for (const m of s.members) { this.scene.remove(m.g); m.mixer.stopAllAction(); }
        this.schools.splice(i, 1);
      }
    }
    for (let i = this.solos.length - 1; i >= 0; i--) {
      const f = this.solos[i];
      this._updateSolo(f, dt);
      _v.set(f.pos.x - cam.x, 0, f.pos.z - cam.z);
      if (_v.lengthSq() > DESPAWN_SQ || f.life > 165) {
        this.scene.remove(f.g); f.mixer.stopAllAction();
        this.solos.splice(i, 1);
      }
    }
  }
}
