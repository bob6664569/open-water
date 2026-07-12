import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Tortues (mer calme / preset 1). Une ou deux tortues planent lentement au-dessus
// du fond de sable, battant des nageoires (clip « Swim Cycle »), errant en douceur
// et virant à l'écart du bateau. Rendues sur la COUCHE 1 (réfraction) → visibles
// à travers l'eau, comme les poissons. Elles restent submergées (jamais en surface
// dans cette version), au-dessus du sable (-5 m) et sous la surface.
//
// Modèle : « Model 50A - Hawksbill Sea Turtle » par DigitalLife3D (CC-BY-NC-4.0),
// converti en metallic-roughness (turtle.glb) pour le loader vendored.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, t, k) => a + Math.atan2(Math.sin(t - a), Math.cos(t - a)) * k;

const CALM_PRESET = 1;
const MODEL_URL = './assets/animals/turtle.glb';
const TARGET_LEN = 1.9;           // longueur cible (m), grande tortue, bien visible à 5 m de fond
// Orientation fixe (pas d'heuristique bbox) : d'après l'armature, le nez pointe
// vers -Z (os Head*/Jaw en z<0, Tail en z>0). Les nageoires étendues rendent la
// bbox plus LARGE que LONGUE (x≈0.40 > z≈0.39), donc « axe le plus long = longueur »
// se trompait et faisait nager la tortue de côté (vers la gauche). Le groupe oriente
// son +Z local dans le sens du déplacement → il faut tourner le nez -Z vers +Z = 180°.
const MODEL_YAW = Math.PI;        // nez (-Z) → +Z (sens de nage)
const DEPTH = [-4.2, -1.5];       // bande de nage : au-dessus du sable (-5), sous la surface
const SPAWN = [58, 96];           // rayon d'apparition (loin, arrive en nageant, jamais près du bateau)
const DESPAWN = 150;
const MAX_N = 2;
const INTERVAL = [12, 30];        // délai [min,max] entre apparitions (s)
const BOAT_FLEE_R = 9;            // rayon d'esquive autour de la trajectoire du bateau
const BOAT_LEAD = 1.0;

function orientTo(group, vx, vy, vz) {
  const sp = Math.hypot(vx, vy, vz);
  if (sp < 1e-4) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vy / sp, -1, 1)), // tangage
    Math.atan2(vx, vz),                               // lacet
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
    this.timer = rand(3, INTERVAL[0]);   // première tortue peu après l'entrée en calme

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
        o.frustumCulled = false;    // skinned bbox instable
        o.castShadow = false;
        o.layers.set(1);            // réfraction (vu à travers l'eau)
      });
    }, (e) => console.warn('[turtles] chargement échoué', e));
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
      a.play(); a.time = rand(0, this.clip.duration); a.timeScale = rand(0.5, 0.8); // nage lente
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
    // cap vers un point proche du bateau → traverse la zone visible
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

  // Menace du bateau : distance à sa trajectoire anticipée. Renvoie esquive + urgence.
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
      speed = 1.4 + th.u * 2.2;    // accélère un peu à l'esquive, sans jamais détaler
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
