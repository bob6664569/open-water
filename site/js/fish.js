import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Faune subaquatique : poissons côtiers qui nagent sous la surface, visibles
// par RÉFRACTION (couche 1, comme la coque immergée). Bancs denses (boids
// léger) pour les espèces grégaires + nageurs solitaires colorés.
//
// Modèles : pack Quaternius (CC0), chaque poisson est riggé avec un clip de
// nage, joué par AnimationMixer ; clonés par SkeletonUtils.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, target, k) => a + Math.atan2(Math.sin(target - a), Math.cos(target - a)) * k;
const turnToward = (a, target, maxStep) => a + THREE.MathUtils.clamp(
  Math.atan2(Math.sin(target - a), Math.cos(target - a)), -maxStep, maxStep);
const moveToward = (value, target, maxStep) => value + THREE.MathUtils.clamp(target - value, -maxStep, maxStep);

const FISH_DIR = './assets/animals/fish/';
// Profondeur faible : la réfraction (demi-résolution) absorbe vite avec la
// distance à la surface, donc on garde les poissons près du dessous de l'eau.
const DEPTH = [-2.4, -0.9];   // bande de profondeur (m sous le niveau moyen 0)
const DESPAWN = 145;          // au-delà : le banc/poisson est retiré (invisible à cette distance)
const FISH_FLIP = 0;          // correction nez (0 ou Math.PI), réglée au rendu
const BOAT_FLEE_R = 8;        // rayon d'effarouchement autour de la TRAJECTOIRE du bateau (m)
const BOAT_FLEE_STR = 11;     // force de fuite
const BOAT_LEAD = 1.0;        // anticipation : on regarde où le bateau sera dans ~1 s
const SCHOOL_REARM_COOLDOWN = 8; // délai minimal avant qu'un même banc puisse recompter
const SCHOOL_CALM_TO_REARM = 4;  // temps sans menace nécessaire pour considérer le banc reformé
const SHARK_NOTICE_R = 65;    // il ne s'intéresse au bateau que s'il est encore dans la zone
const SHARK_AVOID_R = 11;     // évitement progressif, sans demi-tour instantané

// Faune subaquatique par état de mer. Chaque espèce déclare :
//   file/clip/len/tint (voir plus bas)   girth : amincissement hors-longueur (<1 = fuselé)
//   role : 'school' (banc) ou 'solo'     presets : états de mer où elle apparaît
//   max : nombre simultané max de cette espèce   interval : délai [min,max] entre apparitions (s)
// Le pack tropical contient neuf poissons riggés dans une seule scène. Il est
// découpé au chargement en individus (géométrie + pistes d'animation) afin que
// chacun puisse suivre sa propre trajectoire dans le banc.
const SPECIES = {
  tropical:  {
    file: '../tropical-fish-school-512.glb', len: 0.72,
    role: 'school', presets: [1], max: 4, interval: [5, 12],
    schoolSize: [3, 7], soloChance: 0.2, duoChance: 0.25,
    spawnRadius: [32, 72], spread: 4.5,
    speed: [0.55, 0.95], memberSpeed: [0.45, 0.85], behavior: 'packed-school',
    cohesion: 0.25, alignment: 0.55, separation: 0.8,
  },
  // Rolling (large) : pélagiques fuselés.
  tuna:      { file: 'tuna.glb',      clip: 'Fish_Armature|Swimming_Normal', len: 0.95, tint: null,     girth: 0.6,  role: 'school', presets: [2], max: 3, interval: [9, 22] },
  swordfish: { file: 'swordfish.glb', clip: 'Fish_Armature|Swimming_Normal', len: 1.5,  tint: null,     girth: 0.48, role: 'solo',   presets: [2], max: 2, interval: [8, 20] },
  // Rough (mer formée) : un requin de récif réaliste qui rôde autour du bateau.
  // Modèle texturé → pas de tint ni de girth (on garde ses vraies proportions/texture).
  shark:     { file: 'shark.glb',     clip: 'Action_Shark Armature', len: 5.6, tint: null, flip: 0, role: 'solo',   presets: [3], max: 1, interval: [10, 24], behavior: 'shark' },
};

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
  // MeshBasic garantit la lecture dans la passe de réfraction, même lorsque les
  // lumières de la scène ne partagent pas la couche technique des poissons.
  const materials = colors.map(color => new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide,
  }));
  GUIDED_FALLBACK_ASSETS = { body, tail, materials };
  return GUIDED_FALLBACK_ASSETS;
}

// Oriente un groupe (nez local = +z) le long d'un vecteur vitesse : lacet + tangage.
function orientTo(group, vel) {
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  if (sp < 1e-5) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vel.y / sp, -1, 1)), // tangage
    Math.atan2(vel.x, vel.z),                            // lacet
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

    this.protos = {};        // key -> { root, clip, baseScale, yaw, lenAxis }
    this.schools = [];
    this.solos = [];
    this.dispersedSchools = 0; // compteur de dispersions réelles provoquées par le bateau
    this.timers = {};        // key -> délai avant prochaine apparition
    this.loading = new Set();
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
          console.warn('[fish] aucun poisson individuel trouvé dans', sp.file);
          return;
        }
        this.protos[key] = { variants };
        this.loading.delete(key);
        return;
      }
      const root = gltf.scene;
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      // Orientation : amener l'axe long du corps sur +Z (nez). axisFix:'y' pour
      // les modèles montés DEBOUT (longueur sur Y) → on les bascule à l'horizontale.
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
        o.frustumCulled = false;      // skinned bbox instable
        o.castShadow = false;
        o.layers.set(1);              // visible via réfraction (sous l'eau)
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
      console.warn('[fish] chargement échoué', sp.file, e);
    });
  }

  // Le GLB tropical utilise un seul squelette pour neuf poissons et regroupe
  // leurs surfaces dans quatre SkinnedMesh. On conserve, pour chaque individu,
  // uniquement les triangles influencés par ses os et les pistes qui portent
  // son préfixe (Clown1, blue_tang2, etc.). Les gros attributs de sommets restent
  // partagés : seuls les petits index filtrés sont dupliqués.
  _splitPackedSchool(gltf, sp) {
    const prefixes = new Set();
    gltf.scene.traverse(o => {
      if (!o.isBone) return;
      // GLTFLoader nettoie les noms Sketchfab (`Clown1:Root.5_9` devient
      // `Clown1Root5_9`) : le nom de l'os racine reste notre séparateur fiable.
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
        o.layers.set(1);
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

  // Crée un poisson (groupe extérieur = mouvement, modèle intérieur = correction
  // d'orientation + échelle) avec son mixer jouant le clip de nage.
  _make(key) {
    const proto = this.protos[key];
    const p = proto.variants
      ? proto.variants[Math.floor(Math.random() * proto.variants.length)]
      : proto;
    const model = skeletonClone(p.root);
    model.rotation.set(p.rotX, p.rotY, 0);
    const s = p.baseScale * rand(0.82, 1.2);
    model.scale.set(s, s, s);
    // Amincissement (garde la longueur), seulement pour les modèles horizontaux.
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
    // Apparition LOIN (invisible à travers l'eau) → le banc arrive en nageant.
    const spawnRadius = sp.spawnRadius || [65, 105];
    const bearing = rand(0, Math.PI * 2), R = rand(spawnRadius[0], spawnRadius[1]);
    const guided = !!guidedCenter;
    const center = guided
      ? guidedCenter.clone().setY(-0.42)
      : new THREE.Vector3(
        cam.x + Math.sin(bearing) * R,
        rand(DEPTH[0] + 0.4, DEPTH[1] - 0.4),
        cam.z + Math.cos(bearing) * R,
      );
    // Cap vers un point proche du bateau (jitter) → traverse la zone visible.
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
      clampDepth(pos, guided ? -0.2 : DEPTH[1]);
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

  // Premier voyage : prépare puis place un vrai banc sur le cap suggéré.
  // Le chargement reste différé/séquentiel ; l'appelant réessaie simplement
  // jusqu'à ce que le prototype soit prêt, sans dupliquer le téléchargement.
  spawnGuidedSchoolAt(position, heading = 0) {
    const key = this.wf.preset === 2 ? 'tuna' : null;
    if (!key) return null;
    this._load(key);
    if (this.guidedFallbackSchool) return this.guidedFallbackSchool;
    // Le tutoriel ne dépend volontairement pas du GLB : le fallback est plus
    // dense, plus proche de la surface et disponible instantanément.
    return this._spawnGuidedFallbackSchool(position, heading);
  }

  prepareGuidedSchool() {
    if (this.wf.preset === 2) this._load('tuna');
  }

  _spawnGuidedFallbackSchool(position, heading) {
    const { body, tail, materials } = guidedFallbackAssets();
    const center = position.clone().setY(-0.36);
    const members = [];
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    for (let i = 0; i < 42; i++) {
      const material = materials[i % materials.length];
      const g = new THREE.Group();
      const bodyMesh = new THREE.Mesh(body, material);
      const tailMesh = new THREE.Mesh(tail, material);
      bodyMesh.layers.set(1);
      tailMesh.layers.set(1);
      g.add(bodyMesh, tailMesh);
      g.scale.setScalar(rand(1.35, 1.9));
      const angle = rand(0, Math.PI * 2);
      const radius = Math.sqrt(Math.random()) * 11;
      const pos = center.clone().add(new THREE.Vector3(
        Math.sin(angle) * radius,
        rand(-0.14, 0.18),
        Math.cos(angle) * radius,
      ));
      clampDepth(pos, -0.12);
      g.position.copy(pos);
      this.scene.add(g);
      members.push({
        g, mixer: NOOP_MIXER, pos,
        vel: forward.clone().multiplyScalar(rand(0.65, 1.05)),
      });
    }
    const school = {
      key: 'guided-fallback', center, members, guided: true,
      heading, speed: 0.82,
      cohesion: 0.42, alignment: 0.72, separation: 0.62,
      wanderPhase: rand(0, 6.28), wanderFreq: 0.07,
      depthPhase: rand(0, 6.28), depthFreq: 0.06,
      scatterTime: 0, scattered: false, scatterCooldown: 0, calmTime: 0,
      regroupRadius: 18, life: 0,
    };
    this.schools.push(school);
    this.guidedFallbackSchool = school;
    return school;
  }

  scatterGuidedSchool(school) {
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
    school.scatterCooldown = SCHOOL_REARM_COOLDOWN;
    school.calmTime = 0;
    this.dispersedSchools += 1;
    return true;
  }

  _spawnSolo(key) {
    const cam = this.camera.position;

    // Le requin arrive sur une trajectoire MONDE. Le premier point de passage
    // est choisi près de la position actuelle du bateau, mais ne lui reste pas
    // attaché : si le bateau accélère, le requin poursuit naturellement sa route.
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

    // Apparition loin → le poisson entre dans le champ en nageant vers le bateau.
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

  // Menace du bateau : distance à sa TRAJECTOIRE (position anticipée sur ~2 s),
  // donc les poissons fuient AVANT l'arrivée. Renvoie l'esquive + l'urgence, ou null.
  _boatThreat(px, pz, radius = BOAT_FLEE_R) {
    const b = this.boat;
    if (!b) return null;
    const vx = b.vel ? b.vel.x : 0, vz = b.vel ? b.vel.z : 0;
    const v2 = vx * vx + vz * vz;
    let cx, cz;
    if (v2 > 1) {
      let ts = ((px - b.pos.x) * vx + (pz - b.pos.z) * vz) / v2; // instant de plus proche passage
      ts = Math.max(0, Math.min(BOAT_LEAD, ts));                 // borné au futur proche
      cx = b.pos.x + vx * ts; cz = b.pos.z + vz * ts;
    } else { cx = b.pos.x; cz = b.pos.z; }
    let dx = px - cx, dz = pz - cz, cd = Math.hypot(dx, dz);
    if (cd >= radius) return null;
    if (cd < 0.4 && v2 > 1) { const vn = Math.sqrt(v2); dx = -vz / vn; dz = vx / vn; cd = 1; } // pile devant → esquive latérale
    const inv = 1 / (cd || 1e-3);
    return { ax: dx * inv, az: dz * inv, u: 1 - cd / radius };
  }

  _updateSchool(s, dt) {
    const t = this.time;
    s.life += dt;
    // Le centre du banc erre TRÈS légèrement (sinon il ne traverse jamais le
    // champ) : l'amplitude du cap vaut coef/wanderFreq, d'où un coef minuscule.
    s.heading += Math.sin(t * s.wanderFreq + s.wanderPhase) * 0.015 * dt;
    s.center.x += Math.sin(s.heading) * s.speed * dt;
    s.center.z += Math.cos(s.heading) * s.speed * dt;
    s.center.y = s.guided
      ? THREE.MathUtils.clamp(-0.46 + Math.sin(t * s.depthFreq + s.depthPhase) * 0.16, -0.72, -0.24)
      : THREE.MathUtils.clamp(
        -2.2 + Math.sin(t * s.depthFreq + s.depthPhase) * 0.9, DEPTH[0], DEPTH[1]);

    const schoolVel = _v.set(Math.sin(s.heading), 0, Math.cos(s.heading)).multiplyScalar(s.speed);
    const M = s.members;
    let threatenedMembers = 0;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      // Cohésion (vers le centre) + alignement (vitesse du banc).
      const ax = (s.center.x - m.pos.x) * s.cohesion + (schoolVel.x - m.vel.x) * s.alignment;
      const ay = (s.center.y - m.pos.y) * Math.max(0.65, s.cohesion * 2);
      const az = (s.center.z - m.pos.z) * s.cohesion + (schoolVel.z - m.vel.z) * s.alignment;
      let sx = 0, sy = 0, sz = 0;
      // Séparation (voisins proches).
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
      // Effarouchement ANTICIPÉ : le banc s'écarte de la trajectoire du bateau
      // avant qu'il n'arrive dessus.
      let vmax = 2.6;
      const th = this._boatThreat(m.pos.x, m.pos.z, s.guided ? 16 : BOAT_FLEE_R);
      if (th) {
        if (th.u >= 0.25) threatenedMembers++;
        m.vel.x += th.ax * th.u * BOAT_FLEE_STR * dt;
        m.vel.z += th.az * th.u * BOAT_FLEE_STR * dt;
        m.vel.y -= th.u * 3 * dt;   // ils plongent aussi
        vmax = 7.5;
      }
      // Vitesse bornée (relevée en fuite).
      const sp = Math.hypot(m.vel.x, m.vel.y, m.vel.z) || 1e-5;
      const cl = THREE.MathUtils.clamp(sp, 0.4, vmax) / sp;
      m.vel.multiplyScalar(cl);
      m.pos.addScaledVector(m.vel, dt);
      clampDepth(m.pos, s.guided ? -0.18 : DEPTH[1]);
      m.g.position.copy(m.pos);
      orientTo(m.g, m.vel);
      m.mixer.update(dt);
    }
    // Une simple esquive individuelle ne compte pas : le bateau doit faire
    // réagir ensemble une part significative d'un vrai banc (3 poissons min).
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

  // Choisit un point fixe dans le monde. Quand le bateau est proche, le requin
  // peut venir examiner sa zone, mais seulement à partir d'un instantané de sa
  // position. Plusieurs candidats sont comparés pour éviter un demi-tour brutal.
  _setSharkWaypoint(f, leaving = false) {
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

    // Le bateau influe seulement comme obstacle local. Sa vitesse ne devient
    // jamais celle du requin et ne déplace pas ses points de passage.
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
    // Effarouchement ANTICIPÉ : vire à l'écart de la trajectoire du bateau et détale.
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
    for (const key of Object.keys(SPECIES)) {
      if (this.time > 1.5 && SPECIES[key].presets.includes(preset)) this._load(key);
    }
    const cam = this.camera.position;

    // Directeur d'apparition par espèce : chaque espèce a son propre rythme et
    // n'apparaît que dans ses états de mer.
    for (const key of Object.keys(SPECIES)) {
      const sp = SPECIES[key];
      if (!this.protos[key] || !sp.presets.includes(preset)) continue;
      if (this.timers[key] == null) this.timers[key] = rand(0.5, sp.interval[0]);
      this.timers[key] -= dt;
      if (this.timers[key] <= 0) {
        const list = sp.role === 'school' ? this.schools : this.solos;
        if (list.filter(e => e.key === key).length < sp.max) {
          if (sp.role === 'school') this._spawnSchool(key); else this._spawnSolo(key);
        }
        this.timers[key] = rand(sp.interval[0], sp.interval[1]);
      }
    }

    for (let i = this.schools.length - 1; i >= 0; i--) {
      const s = this.schools[i];
      this._updateSchool(s, dt);
      _v.set(s.center.x - cam.x, 0, s.center.z - cam.z);
      if (_v.length() > DESPAWN || s.life > 165) {
        for (const m of s.members) { this.scene.remove(m.g); m.mixer.stopAllAction(); }
        this.schools.splice(i, 1);
      }
    }
    for (let i = this.solos.length - 1; i >= 0; i--) {
      const f = this.solos[i];
      this._updateSolo(f, dt);
      _v.set(f.pos.x - cam.x, 0, f.pos.z - cam.z);
      if (_v.length() > DESPAWN || f.life > 165) {
        this.scene.remove(f.g); f.mixer.stopAllAction();
        this.solos.splice(i, 1);
      }
    }
  }
}
