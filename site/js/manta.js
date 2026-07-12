import * as THREE from 'three';
import { loadGLTFDeferred } from './deferred-loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Raie manta (mer calme / preset 1). Une raie plane lentement en larges arcs
// au-dessus du fond de sable, battant des ailes (clip « Swimming »). Rendue sur
// la COUCHE 1 (réfraction) → visible à travers l'eau. Reste submergée, au-dessus
// du sable (-5 m) et sous la surface.
//
// ORIENTATION, attention : le bbox de ce modèle est quasi carré (envergure ≈
// longueur), donc l'heuristique « axe le plus long = nez » (utilisée ailleurs)
// l'orienterait DE TRAVERS (une aile en avant). On code donc l'axe explicitement :
//   LEN_AXIS = axe de la LONGUEUR du corps (nez↔queue). 'z' par défaut.
//   FLIP     = 0 ou Math.PI si le nez pointe vers l'arrière.
//
// Modèle : « Manta Ray (Birostris) animated » par Violaine (CC-BY-NC-SA-4.0),
// converti en metallic-roughness (manta_ray.glb) pour le loader vendored.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const angLerp = (a, t, k) => a + Math.atan2(Math.sin(t - a), Math.cos(t - a)) * k;

const CALM_PRESET = 1;
const MODEL_URL = './assets/animals/manta_ray.glb';
const TARGET_SPAN = 4.6;          // envergure cible (m), manta de récif
const LEN_AXIS = 'z';             // axe long du corps (nez↔queue) : 'x' ou 'z'
const FLIP = 0;                   // 0 ou Math.PI si le nez pointe à l'envers
const DEPTH = [-4.6, -2.6];       // bande de nage : au-dessus du sable (-5), sous la surface
const SPAWN = [60, 100];          // rayon d'apparition (loin, arrive en planant)
const DESPAWN = 155;
const MAX_N = 1;                  // une raie à la fois (majestueuse, pas grégaire)
const INTERVAL = [16, 40];
const BOAT_FLEE_R = 12;           // large : la raie s'écarte tôt et doucement
const BOAT_LEAD = 1.0;

function orientTo(group, vx, vy, vz) {
  const sp = Math.hypot(vx, vy, vz);
  if (sp < 1e-4) return;
  group.rotation.set(
    Math.asin(THREE.MathUtils.clamp(vy / sp, -1, 1)), // tangage
    Math.atan2(vx, vz),                               // lacet
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
  }

  _load() {
    if (this.loadStarted) return;
    this.loadStarted = true;
    loadGLTFDeferred(MODEL_URL, (gltf) => {
      this.proto = gltf.scene;
      this.clip = gltf.animations.find(c => /swim/i.test(c.name)) || gltf.animations[0];
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      // échelle sur l'ENVERGURE (plus grand axe horizontal), pas la longueur
      this.baseScale = TARGET_SPAN / Math.max(size.x, size.z, 1e-3);
      // amener l'axe long du corps sur +Z (nez) : si la longueur est sur X, tourner de π/2
      this.yaw = (LEN_AXIS === 'x' ? Math.PI / 2 : 0) + FLIP;
      this.proto.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;    // skinned bbox instable
        o.castShadow = false;
        o.layers.set(1);            // réfraction (vu à travers l'eau)
      });
    }, (e) => console.warn('[manta] chargement échoué', e));
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
      a.play(); a.time = rand(0, this.clip.duration); a.timeScale = rand(0.5, 0.75); // battement lent
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
      f.heading = angLerp(f.heading, Math.atan2(th.ax, th.az), Math.min(1, dt * 2.2));
      speed = 1.4 + th.u * 1.8;   // s'écarte, sans jamais paniquer
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
      if (_v.length() > DESPAWN || f.life > 200) {
        this.scene.remove(f.g); f.mixer.stopAllAction();
        this.mantas.splice(i, 1);
      }
    }
  }
}
