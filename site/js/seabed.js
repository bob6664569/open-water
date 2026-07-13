import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { IS_CONSTRAINED_DEVICE, loadGLTFDeferred } from './deferred-loader.js';

// The calm-water seabed follows the boat and fades radially before the deep ocean.
const CALM_PRESET = 1;
const SAND_Y = -5.0;
const PLANE = 460;
const NEAR_R = 46;
const FAR_R = 112;
const STAR_URL = './assets/animals/asteroid_starfish_or_seastar.glb';
const STAR_SPAN = 1.0;
const STAR_COUNT = 16;
const STAR_R = [8, 104];
const STAR_RECYCLE = 128;
const STAR_SIZE = [0.6, 1.35];
const STAR_CLUSTER = 0.62;

const REEF_COUNTS = {
  low:    { branch: 6,  fan: 4,  tube: 5,  mound: 5,  algae: 24, rock: 42 },
  medium: { branch: 11, fan: 8,  tube: 9,  mound: 8,  algae: 44, rock: 78 },
  high:   { branch: 16, fan: 12, tube: 13, mound: 11, algae: 70, rock: 124 },
  ultra:  { branch: 22, fan: 16, tube: 17, mound: 14, algae: 96, rock: 170 },
};
const REEF_MAX = REEF_COUNTS.ultra;
const REEF_R = [12, 102];
const REEF_RECYCLE = 128;
const REEF_CLUSTER = 0.92;

const rand = (a, b) => a + Math.random() * (b - a);

function starfishGeometry() {
  const shape = new THREE.Shape();
  const arms = 5, R = 0.5, r = 0.19;
  const pts = arms * 2;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 ? r : R;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.11,
    bevelSize: 0.11, bevelSegments: 3, curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function cylinderBetween(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r1, r0, dir.length(), 6, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q,
    new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

function branchingCoralGeometry() {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [
    cylinderBetween(v(0, 0, 0), v(0, 1.05, 0), 0.15, 0.075),
    cylinderBetween(v(0, 0.38, 0), v(0.42, 0.82, 0.08), 0.105, 0.055),
    cylinderBetween(v(0.42, 0.82, 0.08), v(0.46, 1.12, 0.1), 0.07, 0.035),
    cylinderBetween(v(-0.01, 0.58, 0), v(-0.38, 0.9, -0.08), 0.1, 0.05),
    cylinderBetween(v(-0.38, 0.9, -0.08), v(-0.43, 1.16, -0.1), 0.065, 0.032),
    cylinderBetween(v(0, 0.7, 0), v(0.08, 1.06, -0.34), 0.085, 0.04),
  ];
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

function fanCoralGeometry() {
  const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const parts = [
    cylinderBetween(v(0, 0), v(0, 0.42), 0.11, 0.075),
    cylinderBetween(v(0, 0.35), v(-0.48, 0.78), 0.075, 0.035),
    cylinderBetween(v(0, 0.35), v(0.48, 0.78), 0.075, 0.035),
    cylinderBetween(v(-0.45, 0.75), v(-0.62, 1.18), 0.045, 0.022),
    cylinderBetween(v(-0.34, 0.66), v(-0.12, 1.12), 0.04, 0.02),
    cylinderBetween(v(0.45, 0.75), v(0.62, 1.18), 0.045, 0.022),
    cylinderBetween(v(0.34, 0.66), v(0.12, 1.12), 0.04, 0.02),
    cylinderBetween(v(-0.46, 0.79), v(0.46, 0.79), 0.03, 0.026),
    cylinderBetween(v(-0.56, 1.03), v(0.56, 1.03), 0.025, 0.02),
  ];
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

function tubeCoralGeometry() {
  const specs = [
    [-0.22, 0, 0.72, 0.13], [0.17, 0.04, 0.95, 0.16],
    [0.04, -0.2, 0.58, 0.12], [0.31, -0.14, 0.5, 0.1],
  ];
  const parts = [];
  for (const [x, z, h, r] of specs) {
    const tube = new THREE.CylinderGeometry(r * 1.05, r * 0.78, h, 8, 1, true);
    tube.translate(x, h * 0.5, z);
    const rim = new THREE.TorusGeometry(r * 1.05, r * 0.18, 4, 8);
    rim.rotateX(Math.PI / 2);
    rim.translate(x, h, z);
    parts.push(tube, rim);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

function bladeGeometry(width = 0.24, segments = 5) {
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const y = i / segments;
    const half = width * 0.5 * (1 - 0.78 * y ** 1.5);
    positions.push(-half, y, 0, half, y, 0);
    uvs.push(0, y, 1, y);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function algaeTuftGeometry() {
  const parts = [];
  const heights = [1, 0.72, 0.88, 0.63, 0.79];
  for (let i = 0; i < heights.length; i++) {
    const geo = bladeGeometry(0.3 + (i % 3) * 0.055, 5);
    const o = new THREE.Object3D();
    const a = i * Math.PI * 0.4;
    o.position.set(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11);
    o.rotation.set(Math.sin(a) * 0.16, a, Math.cos(a) * 0.2);
    o.scale.set(1, heights[i], 1);
    o.updateMatrix();
    geo.applyMatrix4(o.matrix);
    parts.push(geo);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

function reefMaterial(color, uniforms, { sway = false, glow = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: color,
    emissiveIntensity: glow ?? (sway ? 0.25 : 0.42),
    roughness: 0.88, metalness: 0, vertexColors: true,
    transparent: true, depthWrite: true, side: sway ? THREE.DoubleSide : THREE.FrontSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vReefW;
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway ? `
        float reefTip = clamp(position.y, 0.0, 1.0);
        float reefPhase = dot(instanceMatrix[3].xz, vec2(0.173, 0.119));
        transformed.x += sin(uTime * 0.72 + reefPhase + position.y * 1.8) * 0.16 * reefTip * reefTip;
        transformed.z += cos(uTime * 0.57 + reefPhase * 1.3 + position.y) * 0.1 * reefTip * reefTip;
        ` : ''}
        vReefW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vReefW;
        uniform vec2 uCenter; uniform float uFade;
        uniform float uNear; uniform float uFar;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float reefDist = length(vReefW.xz - uCenter);
        float reefRadial = smoothstep(uFar, uNear, reefDist);
        diffuseColor.a *= clamp(reefRadial * uFade, 0.0, 1.0);
        if (diffuseColor.a < 0.01) discard;`);
  };
  return mat;
}

export class Seabed {
  constructor(scene, camera, waveField, boat) {
    this.scene = scene;
    this.camera = camera;
    this.wf = waveField;
    this.boat = boat;
    this.time = 0;
    this.fade = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uFade: { value: 0 },
      uNear: { value: NEAR_R },
      uFar: { value: FAR_R },
    };

    const geo = new THREE.PlaneGeometry(PLANE, PLANE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc2b088, roughness: 1.0, metalness: 0.0,
      transparent: true, depthWrite: true,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vSbW;`)
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>\n vSbW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSbW;
          uniform float uTime; uniform vec2 uCenter; uniform float uFade;
          uniform float uNear; uniform float uFar;
          float sbHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float sbNoise(vec2 p){
            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            float a = sbHash(i), b = sbHash(i + vec2(1,0)), c = sbHash(i + vec2(0,1)), d = sbHash(i + vec2(1,1));
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 wxz = vSbW.xz;

            float mott = sbNoise(wxz * 0.13) * 0.55 + sbNoise(wxz * 0.55) * 0.45;
            float ripple = sbNoise(vec2(wxz.x * 1.6 + wxz.y * 0.2, wxz.y * 0.6)) * 0.5 + 0.5;
            vec3 sand = diffuseColor.rgb * (0.80 + 0.4 * mott) * (0.9 + 0.12 * ripple);

            float t = uTime * 0.06;
            float n1 = sbNoise(wxz * 0.9 + vec2(t, t * 0.7));
            float n2 = sbNoise(wxz * 1.7 - vec2(t * 0.6, t));
            float caustic = pow(1.0 - abs(n1 - n2), 5.0);
            sand += caustic * 0.14;
            diffuseColor.rgb = sand;

            float dist = length(wxz - uCenter);
            float radial = smoothstep(uFar, uNear, dist);
            diffuseColor.a = clamp(radial * uFade, 0.0, 1.0);
          }`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = SAND_Y;
    this.mesh.layers.set(1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.stars = [];
    this.starProto = null;
    this.starBaseScale = 1;
    this.starLoadStarted = false;

    this.reefItems = [];
    this.reefMeshes = [];
    this._reefDummy = new THREE.Object3D();
    this._reefColor = new THREE.Color();
    this._reefBuddyPool = [];
    this._starBuddyPool = [];
    this._dirtyReefMeshes = new Set();
    this._buildReef();
    this.setPerformanceBudget({ id: IS_CONSTRAINED_DEVICE ? 'low' : 'high' });
  }

  _buildReefMesh(kind, geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `calm-${kind}`;
    mesh.layers.set(1);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.reefMeshes.push(mesh);
    return mesh;
  }

  _buildReef() {
    const branch = this._buildReefMesh('branch-coral', branchingCoralGeometry(),
      reefMaterial(0xff846f, this.uniforms), REEF_MAX.branch);
    const fan = this._buildReefMesh('fan-coral', fanCoralGeometry(),
      reefMaterial(0xffa66e, this.uniforms), REEF_MAX.fan);
    const tube = this._buildReefMesh('tube-coral', tubeCoralGeometry(),
      reefMaterial(0xe3bd73, this.uniforms), REEF_MAX.tube);
    const moundGeo = new THREE.SphereGeometry(0.68, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mound = this._buildReefMesh('mound-coral', moundGeo,
      reefMaterial(0xdca279, this.uniforms), REEF_MAX.mound);
    const algae = this._buildReefMesh('algae', algaeTuftGeometry(),
      reefMaterial(0x4f9d75, this.uniforms, { sway: true }), REEF_MAX.algae);
    const rockGeo = new THREE.DodecahedronGeometry(0.48, 0);
    const rock = this._buildReefMesh('buried-rock', rockGeo,
      reefMaterial(0x625f57, this.uniforms, { glow: 0.055 }), REEF_MAX.rock);

    const defs = [
      [branch, 'branch', REEF_MAX.branch],
      [fan, 'fan', REEF_MAX.fan],
      [tube, 'tube', REEF_MAX.tube],
      [mound, 'mound', REEF_MAX.mound],
      [algae, 'algae', REEF_MAX.algae],
      [rock, 'rock', REEF_MAX.rock],
    ];
    const c = this.boat ? this.boat.pos : this.camera.position;
    this.reefAnchors = Array.from({ length: 13 }, () => {
      const a = rand(0, Math.PI * 2), d = rand(18, 98);
      return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
    });
    this.rockZones = this.reefAnchors.map(anchor => ({
      x: anchor.x + rand(-4, 4), z: anchor.z + rand(-4, 4),
      weight: 0.06 + Math.random() ** 1.7,
      spread: rand(2.4, 9.5),
    }));
    for (const [mesh, kind, count] of defs) {
      for (let index = 0; index < count; index++) {
        const item = { mesh, kind, index, placed: false, x: 0, z: 0 };
        this._placeReef(item, c.x, c.z, false);
        this.reefItems.push(item);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  _reefBuddy(self, cx, cz, rmin, rmax) {
    const lo = Math.max(0, rmin - 5) ** 2, hi = (rmax + 8) ** 2;
    const pool = this._reefBuddyPool;
    pool.length = 0;
    for (const candidate of this.reefItems) {
      const distanceSq = (candidate.x - cx) ** 2 + (candidate.z - cz) ** 2;
      if (candidate !== self && candidate.placed
          && distanceSq >= lo && distanceSq <= hi) pool.push(candidate);
    }
    return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  }

  _pickRockZone() {
    const total = this.rockZones.reduce((sum, zone) => sum + zone.weight, 0);
    let cursor = Math.random() * total;
    for (const zone of this.rockZones) {
      cursor -= zone.weight;
      if (cursor <= 0) return zone;
    }
    return this.rockZones[this.rockZones.length - 1];
  }

  _placeReef(item, cx, cz, recycle) {
    const rmin = recycle ? FAR_R + 3 : REEF_R[0];
    const rmax = recycle ? REEF_RECYCLE - 9 : REEF_R[1];
    const v = this.boat && this.boat.vel;
    const moving = recycle && v && Math.hypot(v.x, v.z) > 0.6;
    const rockZone = !recycle && item.kind === 'rock' && Math.random() < 0.9
      ? this._pickRockZone() : null;
    const anchor = rockZone || (!recycle && this.reefAnchors && Math.random() < 0.96
      ? this.reefAnchors[(Math.random() * this.reefAnchors.length) | 0] : null);
    let buddy = !anchor && Math.random() < REEF_CLUSTER
      ? this._reefBuddy(item, cx, cz, rmin, rmax) : null;
    if (buddy && moving && (buddy.x - cx) * v.x + (buddy.z - cz) * v.z < 0) buddy = null;

    let x, z;
    if (anchor) {
      const a = rand(0, Math.PI * 2);
      const d = rockZone ? Math.sqrt(Math.random()) * rockZone.spread
        : item.kind === 'algae' ? rand(0.5, 5.2) : rand(0.25, 3.1);
      x = anchor.x + Math.cos(a) * d;
      z = anchor.z + Math.sin(a) * d;
    } else if (buddy) {
      const a = rand(0, Math.PI * 2);
      const d = item.kind === 'algae' ? rand(0.7, 5.2) : rand(0.5, 3.4);
      x = buddy.x + Math.cos(a) * d;
      z = buddy.z + Math.sin(a) * d;
    } else {
      const a = moving ? Math.atan2(v.z, v.x) + rand(-0.9, 0.9) : rand(0, Math.PI * 2);
      const d = rand(rmin, rmax);
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    }
    if (recycle) {
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1e-3;
      const k = THREE.MathUtils.clamp(d, FAR_R + 2, REEF_RECYCLE - 3) / d;
      x = cx + dx * k; z = cz + dz * k;
    }

    const dummy = this._reefDummy;
    dummy.position.set(x, SAND_Y + 0.015, z);
    dummy.rotation.set(rand(-0.04, 0.04), rand(0, Math.PI * 2), rand(-0.04, 0.04));
    if (item.kind === 'branch') {
      const s = rand(0.5, 1.2);
      dummy.scale.set(s * rand(0.8, 1.1), s * rand(0.8, 1.35), s * rand(0.8, 1.1));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [0xff8b70, 0xf27ba2, 0xffae67, 0xd98bd0][(Math.random() * 4) | 0]));
    } else if (item.kind === 'fan') {
      const s = rand(0.55, 1.2);
      dummy.scale.set(s * rand(0.8, 1.25), s * rand(0.85, 1.3), s * rand(0.75, 1.15));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [0xffb66f, 0xff858c, 0xc899ee, 0xf19fbd][(Math.random() * 4) | 0]));
    } else if (item.kind === 'tube') {
      const s = rand(0.6, 1.3);
      dummy.scale.set(s * rand(0.85, 1.2), s * rand(0.8, 1.25), s * rand(0.85, 1.2));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [0xf0cf7d, 0xb8d47d, 0xe8a6ce, 0xe3b78c][(Math.random() * 4) | 0]));
    } else if (item.kind === 'mound') {
      const s = rand(0.55, 1.35);
      dummy.scale.set(s * rand(0.8, 1.35), s * rand(0.6, 1.0), s * rand(0.8, 1.35));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [0xe3b46f, 0xd49b7c, 0xe4a3a0, 0xc6ad79][(Math.random() * 4) | 0]));
    } else if (item.kind === 'rock') {
      const s = rand(0.28, 1.18);
      dummy.position.y = SAND_Y - rand(0.08, 0.3) * s;
      dummy.rotation.set(rand(-0.35, 0.35), rand(0, Math.PI * 2), rand(-0.35, 0.35));
      dummy.scale.set(s * rand(0.75, 1.7), s * rand(0.45, 0.95), s * rand(0.75, 1.55));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [
          0x77746c,
          0x59646a,
          0x806b58,
          0x9a8060,
          0x4f514d,
          0x8b897d,
          0x6e776a,
        ][(Math.random() * 7) | 0]));
    } else {
      const s = rand(0.75, 1.3);
      dummy.rotation.x = dummy.rotation.z = 0;
      dummy.scale.set(s * rand(0.8, 1.3), rand(0.75, 1.55), s * rand(0.8, 1.3));
      item.mesh.setColorAt(item.index, this._reefColor.setHex(
        [0x54ad7c, 0x79b35f, 0x43aaa0, 0x8bad58][(Math.random() * 4) | 0]));
    }
    dummy.updateMatrix();
    item.mesh.setMatrixAt(item.index, dummy.matrix);
    item.x = x; item.z = z; item.placed = true;
  }

  setPerformanceBudget(quality = {}) {
    const profile = REEF_COUNTS[quality.id] || REEF_COUNTS.high;
    this.reefMeshes[0].count = profile.branch;
    this.reefMeshes[1].count = profile.fan;
    this.reefMeshes[2].count = profile.tube;
    this.reefMeshes[3].count = profile.mound;
    this.reefMeshes[4].count = profile.algae;
    this.reefMeshes[5].count = profile.rock;
  }

  _loadStarfish() {
    if (this.starLoadStarted) return;
    this.starLoadStarted = true;
    if (IS_CONSTRAINED_DEVICE) {
      this.starGeoFallback = starfishGeometry();
      this._buildStarfish();
      return;
    }
    loadGLTFDeferred(STAR_URL, (gltf) => {
      const root = gltf.scene;
      // Sketchfab stores an arbitrary display rotation on the root; local geometry
      // is already flat, so reset child rotations before grounding the model.
      root.children.forEach(c => c.quaternion.identity());
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      root.position.set(-ctr.x, -box.min.y, -ctr.z);
      const wrap = new THREE.Group();
      wrap.add(root);
      wrap.traverse(o => {
        if (!o.isMesh) return;
        o.layers.set(1);
        o.frustumCulled = false;
        o.castShadow = false;
        if (o.material && o.material.isMeshBasicMaterial) {
          const b = o.material;
          o.material = new THREE.MeshStandardMaterial({
            map: b.map || null, color: b.color ? b.color.clone() : new THREE.Color(0xffffff),
            roughness: 0.9, metalness: 0.0,
          });
        }
      });
      this.starProto = wrap;
      this.starBaseScale = STAR_SPAN / Math.max(size.x, size.z, 1e-3);
      this._buildStarfish();
    }, (e) => {
      console.warn('[seabed] starfish GLB failed to load, using procedural fallback:', e);
      this.starGeoFallback = starfishGeometry();
      this.starBaseScale = 1;
      this._buildStarfish();
    });
  }

  _makeStarMesh() {
    if (this.starProto) {
      const m = this.starProto.clone(true);
      m.traverse(o => {
        if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(rand(0.82, 1.12)); }
      });
      return m;
    }
    const tints = [0xc65b3b, 0xd08a4a, 0xb84a52, 0xcf6f43, 0xa8536b, 0xd9a05b];
    const mat = new THREE.MeshStandardMaterial({
      color: tints[(Math.random() * tints.length) | 0], roughness: 0.92, metalness: 0.0,
    });
    const m = new THREE.Mesh(this.starGeoFallback, mat);
    m.layers.set(1); m.frustumCulled = false; m.castShadow = false;
    return m;
  }

  _buddy(self, cx, cz, rmin, rmax) {
    const lo = (rmin - 3) ** 2, hi = (rmax + 7) ** 2;
    const pool = this._starBuddyPool;
    pool.length = 0;
    for (const candidate of this.stars) {
      const distanceSq = (candidate.m.position.x - cx) ** 2
        + (candidate.m.position.z - cz) ** 2;
      if (candidate !== self && candidate.placed
          && distanceSq >= lo && distanceSq <= hi) pool.push(candidate);
    }
    return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  }

  _placeStar(st, cx, cz, recycle) {
    const s = STAR_SIZE[0] + Math.random() ** 1.6 * (STAR_SIZE[1] - STAR_SIZE[0]);
    st.s = s; st.m.scale.setScalar(this.starBaseScale * s);
    const rmin = recycle ? FAR_R + 3 : STAR_R[0];
    const rmax = recycle ? STAR_RECYCLE - 10 : STAR_R[1];
    const v = this.boat && this.boat.vel;
    const moving = recycle && v && Math.hypot(v.x, v.z) > 0.6;
    let x, z;
    let buddy = Math.random() < STAR_CLUSTER ? this._buddy(st, cx, cz, rmin, rmax) : null;
    if (buddy && moving
      && (buddy.m.position.x - cx) * v.x + (buddy.m.position.z - cz) * v.z < 0) buddy = null;
    if (buddy) {
      const a = rand(0, Math.PI * 2), d = rand(1.2, 6.5);
      x = buddy.m.position.x + Math.cos(a) * d;
      z = buddy.m.position.z + Math.sin(a) * d;
    } else {
      const a = moving ? Math.atan2(v.z, v.x) + rand(-0.85, 0.85) : rand(0, Math.PI * 2);
      const d = rand(rmin, rmax);
      x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d;
    }
    if (recycle) {
      let dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1e-3;
      const cl = THREE.MathUtils.clamp(d, FAR_R + 2, STAR_RECYCLE - 3) / d;
      x = cx + dx * cl; z = cz + dz * cl;
    }
    st.m.position.set(x, SAND_Y + (this.starProto ? 0.01 : 0.06 * s), z);
    st.m.rotation.set(rand(-0.07, 0.07), rand(0, Math.PI * 2), rand(-0.07, 0.07));
    st.spin = rand(-0.04, 0.04);
    st.placed = true;
  }

  _buildStarfish() {
    const c = this.boat ? this.boat.pos : this.camera.position;
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const m = this._makeStarMesh();
      m.visible = false;
      this.scene.add(m);
      const st = { m, s: 1, spin: 0, placed: false };
      this._placeStar(st, c.x, c.z, false);
      this.stars.push(st);
    }
  }

  update(dt) {
    this.time += dt;
    const calm = this.wf.preset === CALM_PRESET;
    if (calm && this.time > 1.5) this._loadStarfish();
    this.fade = THREE.MathUtils.damp(this.fade, calm ? 1 : 0, 3.0, dt);
    const on = this.fade > 0.003;
    this.mesh.visible = on;
    for (const st of this.stars) st.m.visible = on;
    for (const mesh of this.reefMeshes) mesh.visible = on;
    if (!on) return;

    const c = this.boat ? this.boat.pos : this.camera.position;
    this.mesh.position.set(c.x, SAND_Y, c.z);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCenter.value.set(c.x, c.z);
    this.uniforms.uFade.value = this.fade;

    for (const st of this.stars) {
      st.m.rotation.y += st.spin * dt;
      const dx = st.m.position.x - c.x, dz = st.m.position.z - c.z;
      if (dx * dx + dz * dz > STAR_RECYCLE * STAR_RECYCLE) this._placeStar(st, c.x, c.z, true);
    }

    const dirty = this._dirtyReefMeshes;
    dirty.clear();
    for (const item of this.reefItems) {
      const dx = item.x - c.x, dz = item.z - c.z;
      if (dx * dx + dz * dz <= REEF_RECYCLE * REEF_RECYCLE) continue;
      this._placeReef(item, c.x, c.z, true);
      dirty.add(item.mesh);
    }
    for (const mesh of dirty) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
