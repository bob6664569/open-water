import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VESSEL_SPECS } from './vessels.js';
import { VesselAnimationRig } from './vessel-animations.js';

const G = 9.81;
// Diagnostic visuel volontairement activable par URL : les masques gardent
// exactement leur géométrie et leur écriture de profondeur, mais deviennent
// vert fluo afin de révéler immédiatement tout débordement hors de la coque.
const DEBUG_WATER_MASK = new URLSearchParams(window.location.search).has('masks');

// Réglages du modèle GLB (à ajuster selon l'asset, ici le Zefiro)
const MODEL_TWEAK = {
  yawOffset: 0,      // rotation Y additionnelle si la proue ne pointe pas +Z
  yOffset: -0.5,     // point le plus bas de la coque sous la flottaison
  targetLength: 6.5, // longueur normalisée (m)
};

// Cap de secours tant que la scène n'en fournit pas un (face à la houle).
const PRIMARY_SWELL = new THREE.Vector2(1, 0.18).normalize();
const FALLBACK_START_YAW = Math.atan2(-PRIMARY_SWELL.x, -PRIMARY_SWELL.y);

function disposeObject(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material])
      .forEach(m => { if (m && m.dispose) m.dispose(); });
  });
}

// Sur mobile/tactile, certains GLB embarquent des textures 4096² (jusqu'à 3 à 8
// par modèle). Décodées en RGBA elles pèsent 64 Mo pièce : la VRAM sature au
// chargement → perte de contexte WebGL et rechargement/plantage de l'onglet.
// On plafonne donc leur taille AVANT l'envoi au GPU (aucune incidence desktop).
const MAX_TEXTURE = (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) ? 1024 : Infinity;
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'specularMap'];

function capTextureSize(tex, cache) {
  if (!tex || !tex.image) return;
  const img = tex.image;
  if (cache.has(img)) { tex.image = cache.get(img); tex.needsUpdate = true; return; }
  const w = img.width | 0, h = img.height | 0;
  if (!w || !h || Math.max(w, h) <= MAX_TEXTURE) return;
  const s = MAX_TEXTURE / Math.max(w, h);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * s));
  cv.height = Math.max(1, Math.round(h * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  cache.set(img, cv);
  tex.image = cv;
  tex.needsUpdate = true;
  if (img.close) img.close(); // libère l'ImageBitmap 4k décodé (mémoire CPU)
}

function capModelTextures(model) {
  if (MAX_TEXTURE === Infinity) return;
  const cache = new Map(); // images partagées entre matériaux : traitées une fois
  model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m) TEXTURE_SLOTS.forEach(slot => capTextureSize(m[slot], cache));
    });
  });
}

// Certains exports fusionnent dans un même primitive le vrai vitrage et des
// panneaux de carrosserie déconnectés. Three.js ne peut attribuer qu'un seul
// matériau au primitive : on recrée donc des groupes de triangles pour rendre
// opaques uniquement les régions signalées par la fiche du bateau.
//
// Une région peut être définie soit par un seul axe (legacy : { axis, min, max }),
// soit par une boîte 3D (chaque borne facultative) : { x:[min,max], y:[…], z:[…] }.
// PLUSIEURS régions peuvent viser le même mesh : un triangle devient opaque dès
// qu'il tombe dans l'une d'elles, avec son propre matériau (couleur/métal/rugosité).
function centroidInRegion(r, cx, cy, cz) {
  if (r.axis) {
    const c = r.axis === 'x' ? cx : r.axis === 'y' ? cy : cz;
    return c >= (r.min ?? -Infinity) && c <= (r.max ?? Infinity);
  }
  const within = (v, span) =>
    !span || (v >= (span[0] ?? -Infinity) && v <= (span[1] ?? Infinity));
  return within(cx, r.x) && within(cy, r.y) && within(cz, r.z);
}

function makeSolidFromGlass(glass, r) {
  const solid = glass.clone();
  solid.name = `${glass.name}_solid_repair`;
  solid.transparent = false;
  solid.opacity = 1;
  solid.alphaTest = 0;
  solid.alphaMap = null;
  solid.depthWrite = true;
  if (solid.transmission !== undefined) solid.transmission = 0;
  if (solid.thickness !== undefined) solid.thickness = 0;
  if (solid.metalness !== undefined) solid.metalness = r.metalness ?? 0.55;
  if (solid.roughness !== undefined) solid.roughness = r.roughness ?? 0.32;
  if (solid.clearcoat !== undefined) solid.clearcoat = r.clearcoat ?? 0.45;
  if (r.color !== undefined && solid.color) solid.color.setHex(r.color);
  return solid;
}

function repairOpaqueMaterialRegions(model, repairs = []) {
  if (!repairs.length) return;
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes.position || !o.material) return;
    if (Array.isArray(o.material)) return;
    const matching = repairs.filter(r => r.material === o.material.name
      && (!r.mesh || r.mesh === o.name));
    if (!matching.length) return;

    // capot plein sans aucun vrai vitrage : tout le mesh devient opaque
    const allRule = matching.find(r => r.all);
    if (allRule) { o.material = makeSolidFromGlass(o.material, allRule); return; }

    const geo = o.geometry;
    const pos = geo.attributes.position;
    const index = geo.index;
    const elementCount = index ? index.count : pos.count;
    const coord = (i, c) => pos.getComponent(i, c);
    // 0 = vitrage conservé, sinon 1..N = indice de la région opaque correspondante
    const regionOf = offset => {
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      const cx = (coord(a, 0) + coord(b, 0) + coord(c, 0)) / 3;
      const cy = (coord(a, 1) + coord(b, 1) + coord(c, 1)) / 3;
      const cz = (coord(a, 2) + coord(b, 2) + coord(c, 2)) / 3;
      for (let k = 0; k < matching.length; k++) {
        if (centroidInRegion(matching[k], cx, cy, cz)) return k + 1;
      }
      return 0;
    };

    let hasOpaque = false;
    for (let i = 0; i < elementCount; i += 3) {
      if (regionOf(i)) { hasOpaque = true; break; }
    }
    if (!hasOpaque) return;

    const glass = o.material;
    const palette = [glass, ...matching.map(r => makeSolidFromGlass(glass, r))];

    geo.clearGroups();
    let start = 0;
    let cur = regionOf(0);
    for (let i = 3; i < elementCount; i += 3) {
      const next = regionOf(i);
      if (next === cur) continue;
      geo.addGroup(start, i - start, cur);
      start = i;
      cur = next;
    }
    geo.addGroup(start, elementCount - start, cur);
    o.material = palette;
  });
}

export class Boat {
  constructor(waveField, scene, startYaw = FALLBACK_START_YAW) {
    this.wf = waveField;
    this.spec = VESSEL_SPECS.zefiro;
    this.startYaw = startYaw;

    this.pos = new THREE.Vector3(0, 0.1, 0);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVelB = new THREE.Vector3();

    this.throttle = 0;
    this.steer = 0; // +1 = virage à gauche
    this.propWet = 1;
    this.wet = 1; // fraction immergée de la coque (pour le rendu du sillage)
    this.speedKn = 0;
    this.slam = 0; // intensité d'impact (pour les embruns)
    this.slamSpeed = 0;
    this.slamPoint = new THREE.Vector3();
    this.slamNormal = new THREE.Vector3(0, 1, 0);

    this.group = new THREE.Group();
    scene.add(this.group);
    // masque d'occlusion: volume de coque écrit dans le depth buffer avant
    // l'océan -> la surface d'eau n'est plus visible à l'intérieur du bateau
    this.waterMask = buildWaterMask();
    this.group.add(this.waterMask);
    this._maskWanted = false; // coque assez grande + contour trouvé (cf. _load)

    this._accum = 0;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._omegaW = new THREE.Vector3();
    this._F = new THREE.Vector3();
    this._tauW = new THREE.Vector3();
    this._tauB = new THREE.Vector3();
    this._qi = new THREE.Quaternion();
    this._s = Array.from({ length: 10 }, () => new THREE.Vector3());
    this._waterVel = new THREE.Vector3();
    this._relVel = new THREE.Vector3();
    this._effSteer = 0;
    this._loadId = 0;
    this.visualRig = null;
    this.physicsHz = 240;
    this.physicsMaxSteps = 12;

    this.reset();
  }

  // Sur tactile, préfère la variante allégée (textures ≤1024²) si elle existe :
  // les GLB à textures 4096² décodent en pleine résolution AVANT le plafonnement
  // runtime (jusqu'à 512 Mo transitoires) → plantage mobile. La variante évite
  // ce pic ; repli sur le modèle complet si aucune variante n'est publiée.
  async _resolveModelUrl(url) {
    if (MAX_TEXTURE === Infinity || !url.includes('/assets/boats/')) return url;
    const mobileUrl = url.replace('/assets/boats/', '/assets/boats-mobile/');
    try {
      const res = await fetch(mobileUrl, { method: 'HEAD' });
      if (res.ok) return mobileUrl;
    } catch { /* réseau indispo → modèle complet */ }
    return url;
  }

  // charge/remplace le modèle à chaud (sélecteur de bateaux)
  async loadModel(url, targetLength = MODEL_TWEAK.targetLength,
                  reversed = false) {
    const loadId = ++this._loadId;
    try {
      const gltf = await new GLTFLoader().loadAsync(await this._resolveModelUrl(url));
      const model = gltf.scene;
      if (loadId !== this._loadId) {
        disposeObject(model);
        return;
      }
      // retire lumières/caméras embarquées dans le GLB (Google Blocks)
      const strip = [];
      model.traverse(o => { if (o.isLight || o.isCamera) strip.push(o); });
      strip.forEach(o => o.removeFromParent());
      let box = new THREE.Box3().setFromObject(model);
      let size = box.getSize(new THREE.Vector3());
      if (size.x > size.z) model.rotation.y = Math.PI / 2; // axe long -> Z
      if (reversed) model.rotation.y += Math.PI; // proue/poupe inversées
      model.rotation.y += MODEL_TWEAK.yawOffset;
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      size = box.getSize(new THREE.Vector3());
      const scale = targetLength / Math.max(size.x, size.z);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      // tirant d'eau visuel proportionnel à la taille (~8 % de la longueur):
      // un yacht s'enfonce plus qu'un jet-ski
      model.position.y += -this.spec.visualDraft - box.min.y;
      // matériaux specular-glossiness (extension legacy non supportée par
      // three): on restaure au moins la couleur diffuse depuis le JSON
      const jmats = (gltf.parser.json && gltf.parser.json.materials) || [];
      const assoc = gltf.parser.associations;
      // matériaux du modèle conservés, mais bornés (anti-éblouissement)
      model.traverse(o => {
        if (o.isMesh && o.material) {
          const m = o.material;
          const a = assoc && assoc.get(m);
          if (a && a.materials !== undefined && jmats[a.materials]) {
            const ext = jmats[a.materials].extensions || {};
            const sg = ext.KHR_materials_pbrSpecularGlossiness;
            if (sg && sg.diffuseFactor && m.color) {
              m.color.setRGB(sg.diffuseFactor[0], sg.diffuseFactor[1],
                             sg.diffuseFactor[2]);
              if (sg.glossinessFactor !== undefined) {
                m.roughness = 1 - sg.glossinessFactor;
              }
            }
          }
          m.envMapIntensity = 0.8;
          if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.28);
          if (m.color) {
            const lum = m.color.r * 0.3 + m.color.g * 0.6 + m.color.b * 0.1;
            if (lum > 0.82) m.color.multiplyScalar(0.82 / lum);
          }
          if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
            m.emissive.multiplyScalar(0.15);
          }
          // remplacement de teinte par nom de matériau (ex: sellerie/cuir)
          const override = this.spec.materialColors?.[m.name];
          if (override !== undefined && m.color) m.color.setHex(override);
          o.castShadow = true;
          o.layers.enable(1); // passes réflexion/réfraction
        }
      });
      repairOpaqueMaterialRegions(model, this.spec.materialRepairs);
      // mobile : réduit les textures 4k avant l'upload GPU (anti-OOM)
      capModelTextures(model);
      // masque anti-eau et hors-bord mis à l'échelle de la coque réelle
      const nsize = new THREE.Box3().setFromObject(model)
        .getSize(new THREE.Vector3());
      const len = Math.max(nsize.x, nsize.z);
      // masque anti-eau EN FORME DE COQUE: enveloppe convexe des sommets du
      // modèle autour de la flottaison, rétrécie de 18 % pour rester
      // strictement à l'intérieur. Désactivé pour les petits engins fermés.
      // Ne jamais afficher la geometrie rectangulaire d'initialisation. Elle
      // sert uniquement de conteneur avant le premier chargement: si aucun
      // contour fiable n'est trouve, mieux vaut ne pas masquer l'eau du tout.
      const wantsWaterMask = len >= 4.5;
      this._maskWanted = false;
      this.waterMask.visible = false;
      if (wantsWaterMask) {
        const m4 = new THREE.Matrix4();
        const v = new THREE.Vector3();
        const pts = [];
        model.updateMatrixWorld(true);
        model.traverse(o => {
          if (!o.isMesh || !o.geometry.attributes.position) return;
          const pos = o.geometry.attributes.position;
          m4.copy(o.matrixWorld);
          const stride = Math.max(1, Math.floor(pos.count / 8000));
          for (let vi = 0; vi < pos.count; vi += stride) {
            v.fromBufferAttribute(pos, vi).applyMatrix4(m4);
            if (v.y > -0.3 && v.y < 0.8) pts.push({ x: v.x, z: v.z });
          }
        });
        if (pts.length > 8) {
          const hull = convexHull2D(pts);
          let cx = 0, cz = 0;
          hull.forEach(p => { cx += p.x; cz += p.z; });
          cx /= hull.length; cz /= hull.length;
          // rétrécissement anisotrope: fort en largeur (la carène en V
          // s'affine sous la flottaison), faible en longueur (couverture
          // du cockpit proue-poupe)
          const mask = this.spec.waterMask || {};
          const beamScale = mask.beamScale ?? 0.6;
          const bowScale = mask.bowScale ?? 0.86;
          const sternScale = mask.sternScale ?? 0.86;
          let shrunk = hull.map(p => ({
            x: cx + (p.x - cx) * beamScale,
            z: cz + (p.z - cz) * (p.z < cz ? sternScale : bowScale),
          }));
          if (mask.sternSquare) {
            const minZ = Math.min(...shrunk.map(p => p.z));
            const cutZ = minZ + (cz - minZ) * mask.sternSquare;
            shrunk = clipPolygonAtStern(shrunk, cutZ);
          }
          this.waterMask.geometry.dispose();
          this.waterMask.geometry = prismGeometry(
            shrunk, mask.bottom ?? -0.12, mask.top ?? 0.35,
            { bowRise: mask.bowRise ?? 0, sternRise: mask.sternRise ?? 0 },
          );
          this.waterMask.scale.set(1, 1, 1);
          this.waterMask.position.set(0, 0, 0);
          this._maskWanted = true;
          this.waterMask.visible = true;
        }
      }
      this._disposeModel();
      this.group.add(model);
      this.model = model;
      this.visualRig = new VesselAnimationRig(model, this.spec);
    } catch (e) {
      if (loadId !== this._loadId) return;
      console.warn(url + ' indisponible', e);
      if (!this.model) { // coque procédurale seulement si rien à afficher
        const fb = buildFallbackBoat();
        fb.traverse(o => {
          if (o.isMesh) { o.castShadow = true; o.layers.enable(1); }
        });
        this.group.add(fb);
        this.model = fb;
        this.visualRig = new VesselAnimationRig(fb, this.spec);
      }
    }
  }

  _disposeModel() {
    if (!this.model) return;
    if (this.visualRig) {
      this.visualRig.dispose();
      this.visualRig = null;
    }
    this.group.remove(this.model);
    disposeObject(this.model);
    this.model = null;
  }

  setControls(throttle, steer) {
    this.throttle = THREE.MathUtils.clamp(throttle, -1, 1);
    this.steer = THREE.MathUtils.clamp(steer, -1, 1);
  }

  setPerformanceBudget({ physicsHz = 240, physicsMaxSteps = 12 } = {}) {
    this.physicsHz = physicsHz;
    this.physicsMaxSteps = physicsMaxSteps;
    this._accum = Math.min(this._accum, physicsMaxSteps / physicsHz);
  }

  setSpec(spec) {
    this.spec = spec || VESSEL_SPECS.zefiro;
  }

  setStartYaw(yaw, applyNow = false) {
    this.startYaw = yaw;
    if (!applyNow) return;
    this.quat.setFromAxisAngle(this._up.set(0, 1, 0), this.startYaw);
    this.angVelB.set(0, 0, 0);
  }

  reset() {
    this.pos.set(0, this.spec.rideHeight, 0);
    this.quat.setFromAxisAngle(this._up.set(0, 1, 0), this.startYaw);
    this.vel.set(0, 0, 0);
    this.angVelB.set(0, 0, 0);
    this.slam = 0;
    this.slamSpeed = 0;
    this.slamPoint.copy(this.pos);
    this.slamNormal.set(0, 1, 0);
    this._accum = 0;
  }

  worldPoint(local, out) {
    return out.copy(local).applyQuaternion(this.quat).add(this.pos);
  }

  update(frameDt) {
    const h = 1 / this.physicsHz;
    this._accum = Math.min(this._accum + frameDt, 0.05);
    this.slam = Math.max(this.slam - frameDt * 4, 0);
    if (this.slam <= 0) this.slamSpeed = 0;
    let steps = 0;
    while (this._accum >= h && steps < this.physicsMaxSteps) {
      this._step(h);
      this._accum -= h;
      steps++;
    }
    if (steps === this.physicsMaxSteps) this._accum = Math.min(this._accum, h);
    if (this.visualRig) this.visualRig.update(frameDt, this);

    // retourné depuis > 2,5 s: redressement (on garde le cap)
    const upY = this._up.set(0, 1, 0).applyQuaternion(this.quat).y;
    this._invTime = upY < 0.15 ? (this._invTime || 0) + frameDt : 0;
    if (this._invTime > 2.5) {
      const f = this._fwd.set(0, 0, 1).applyQuaternion(this.quat);
      this.quat.setFromAxisAngle(this._up.set(0, 1, 0), Math.atan2(f.x, f.z));
      this.angVelB.set(0, 0, 0);
      this.vel.multiplyScalar(0.2);
      this.pos.y = this.wf.heightAt(this.pos.x, this.pos.z) + 0.15;
      this._invTime = 0;
    }
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    // masque d'occlusion de l'eau: n'a de sens que si la coque touche la
    // flottaison. Bateau en l'air (wet == 0) -> on le cache, sinon il découpe
    // un contour de coque dans l'eau sous le bateau pendant les sauts.
    this.waterMask.visible = this._maskWanted && this.wet > 0;
    this.wf.velocityAt(this.pos.x, this.pos.z, this._waterVel);
    this._relVel.copy(this.vel).sub(this._waterVel);
    this.speedKn = Math.hypot(this._relVel.x, this._relVel.z) * 1.94384;
  }

  _step(h) {
    const S = this.spec, s = this._s;
    const F = this._F.set(0, -S.mass * G, 0);
    const tauW = this._tauW.set(0, 0, 0);
    const tauB = this._tauB.set(0, 0, 0);

    const fwd = this._fwd.set(0, 0, 1).applyQuaternion(this.quat);
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(this.quat);
    const omegaW = this._omegaW.copy(this.angVelB).applyQuaternion(this.quat);

    // Toutes les forces hydrodynamiques utilisent la vitesse relative à l'eau,
    // y compris son mouvement orbital horizontal sous la houle.
    this.wf.velocityAt(this.pos.x, this.pos.z, s[8]);
    const relCenter = s[9].copy(this.vel).sub(s[8]);
    const vLong = relCenter.dot(fwd);
    const vLat = relCenter.dot(right);
    const vVert = relCenter.dot(up);

    // ---- flottabilité + amortissement, par point de coque ----
    let wet = 0; // fraction immergée de la coque (0..1)
    for (const bp of S.buoyPoints) {
      const wp = this.worldPoint(bp.p, s[0]);
      const depth = this.wf.heightAt(wp.x, wp.z) - wp.y;
      if (depth <= 0) continue;
      wet += bp.w * Math.min(depth / S.restDraft, 1);
      const d = Math.min(depth / S.restDraft, S.maxDepthFactor);
      const r = s[1].copy(wp).sub(this.pos);
      const pointVel = s[2].crossVectors(omegaW, r).add(this.vel);
      const waterVel = this.wf.velocityAt(wp.x, wp.z, s[3]);
      const relPoint = s[4].copy(pointVel).sub(waterVel);
      const waveNormal = this.wf.normalAt(wp.x, wp.z, s[5]);
      const hydroNormal = s[6].set(
        waveNormal.x * S.wavePush,
        Math.max(waveNormal.y, 0.32),
        waveNormal.z * S.wavePush,
      ).normalize();
      const relNormal = relPoint.dot(hydroNormal);
      const slamming = relNormal < -0.55 ? S.slamFactor : 1;
      if (relNormal < -2.4) {
        const impactSpeed = -relNormal;
        this.slam = Math.min(this.slam + 0.45, 2);
        // Plusieurs points peuvent toucher pendant le même pas graphique.
        // On garde le contact le plus violent jusqu'à consommation par les FX.
        if (impactSpeed > this.slamSpeed) {
          this.slamSpeed = impactSpeed;
          this.slamPoint.set(wp.x, this.wf.heightAt(wp.x, wp.z), wp.z);
          this.slamNormal.copy(waveNormal);
        }
      }
      let fN = bp.w * (S.mass * G * d - S.heaveDamp * relNormal * slamming);
      fN = Math.max(fN, -0.3 * bp.w * S.mass * G); // succion limitée
      const Fn = s[7].copy(hydroNormal).multiplyScalar(fN);
      F.add(Fn);
      tauW.add(s[2].crossVectors(r, Fn));
    }

    this.wet = wet;

    // ---- propulsion vectorielle (hors-bord) ----
    const speed = Math.hypot(relCenter.x, relCenter.y, relCenter.z);
    const effSteer = this.steer * S.maxSteerRad / (1 + speed * 0.045);
    this._effSteer = effSteer;
    const propW = this.worldPoint(S.propPos, s[0]);
    const propDepth = this.wf.heightAt(propW.x, propW.z) - propW.y;
    this.propWet = THREE.MathUtils.smoothstep(propDepth, 0, 0.25);
    // coupe-circuit: le moteur coupe au-delà de ~60 degrés de gîte
    const heelCut = THREE.MathUtils.smoothstep(up.y, 0.25, 0.6);
    const advanceRatio = THREE.MathUtils.clamp(
      1 - 0.38 * Math.abs(vLong) / S.maxPropSpeed, 0.58, 1);
    const thrustMag = (this.throttle >= 0 ? S.maxThrustFwd : S.maxThrustRev)
                      * this.throttle * this.propWet * heelCut * advanceRatio;
    if (thrustMag !== 0) {
      const dir = s[1].set(Math.sin(effSteer), 0, Math.cos(effSteer))
        .applyQuaternion(this.quat);
      const Ft = dir.multiplyScalar(thrustMag);
      F.add(Ft);
      tauW.add(s[2].crossVectors(s[3].copy(propW).sub(this.pos), Ft));
    }

    // ---- barre passive (safran/embase dans le flux) ----
    if (Math.abs(vLong) > 0.5) {
      const fRud = Math.sin(effSteer) * S.rudderLift * vLong * Math.abs(vLong)
                   * Math.max(this.propWet, wet);
      const Fr = s[1].copy(right).multiplyScalar(fRud);
      F.add(Fr);
      tauW.add(s[2].crossVectors(this.worldPoint(S.propPos, s[3]).sub(this.pos), Fr));
    }

    // ---- traînées (uniquement la partie immergée; résidu aérodynamique) ----
    const wetDrag = 0.12 + 0.88 * wet;
    // tableau arrière non profilé: traînée majorée en marche arrière
    const revPenalty = vLong < 0 ? 2.6 : 1.0;
    F.addScaledVector(fwd, -(S.dragLong[0] * vLong + S.dragLong[1] * vLong * Math.abs(vLong)) * wetDrag * revPenalty);
    const fLat = -(S.dragLat[0] * vLat + S.dragLat[1] * vLat * Math.abs(vLat)) * wetDrag;
    const FlatV = s[1].copy(right).multiplyScalar(fLat);
    F.add(FlatV);
    tauW.add(s[2].crossVectors(this.worldPoint(S.latDragPos, s[3]).sub(this.pos), FlatV));
    F.addScaledVector(up, -S.dragVert * vVert * wetDrag);

    // ---- portance de déjaugeage (nulle hors de l'eau) ----
    if (vLong > 2 && wet > 0) {
      const lift = Math.min(S.planingLift * vLong * vLong, S.planingLiftMax * S.mass * G) * wet;
      const Fl = s[1].set(0, lift, 0);
      F.add(Fl);
      const planing = THREE.MathUtils.smoothstep(vLong, 2, S.maxPropSpeed * 0.72);
      const cp = s[4].copy(S.planingPos);
      cp.z = THREE.MathUtils.lerp(S.length * 0.04, -S.length * 0.1, planing);
      tauW.add(s[2].crossVectors(this.worldPoint(cp, s[3]).sub(this.pos), Fl));
    }

    // ---- couples explicites (repère local) ----
    tauB.y -= (S.yawDamp[0] + S.yawDamp[1] * Math.abs(vLong)
               + S.yawDamp[2] * Math.abs(this.angVelB.y)) * this.angVelB.y;
    tauB.x -= S.pitchRollDamp[0] * this.angVelB.x;
    tauB.z -= S.pitchRollDamp[1] * this.angVelB.z;
    // gîte dans le virage, plafonnée
    tauB.z -= THREE.MathUtils.clamp(
      S.bankGain * this.angVelB.y * vLong, -S.bankMax, S.bankMax);
    // rappel de roulis non linéaire: right.y ~ sin(roulis), raidit avec la gîte
    tauB.z -= S.rollStiff * right.y * (1 + 2.5 * Math.abs(right.y))
              * (0.35 + 0.65 * Math.min(wet, 1));

    // conversion couple monde -> local puis intégration
    this._qi.copy(this.quat).invert();
    tauB.add(tauW.applyQuaternion(this._qi));
    // Terme gyroscopique du corps rigide diagonal: tau = I*w' + w x Iw.
    const iOmega = s[4].set(
      S.inertia.x * this.angVelB.x,
      S.inertia.y * this.angVelB.y,
      S.inertia.z * this.angVelB.z,
    );
    tauB.sub(s[5].crossVectors(this.angVelB, iOmega));

    this.vel.addScaledVector(F, h / S.mass);
    this.pos.addScaledVector(this.vel, h);

    this.angVelB.x += (tauB.x / S.inertia.x) * h;
    this.angVelB.y += (tauB.y / S.inertia.y) * h;
    this.angVelB.z += (tauB.z / S.inertia.z) * h;
    this.angVelB.clampLength(0, 2.6);
    const wl = this.angVelB.length();
    if (wl > 1e-9) {
      this._qi.setFromAxisAngle(s[0].copy(this.angVelB).divideScalar(wl), wl * h);
      this.quat.multiply(this._qi).normalize();
    }
  }
}

// Enveloppe convexe 2D (monotone chain) de points {x, z}
function convexHull2D(pts) {
  const s = pts.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  for (const p of s) {
    while (lower.length >= 2
           && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2
           && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Coupe l'extrémité arrière (Z négatif) d'un polygone convexe par une droite
// transversale. Les deux intersections deviennent les coins francs du tableau
// arrière, au lieu de conserver une poupe arrondie ou pointue.
function clipPolygonAtStern(poly, minZ) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aIn = a.z >= minZ, bIn = b.z >= minZ;
    if (aIn) out.push(a);
    if (aIn === bIn) continue;
    const t = (minZ - a.z) / (b.z - a.z);
    out.push({ x: THREE.MathUtils.lerp(a.x, b.x, t), z: minZ });
  }
  return out.length >= 3 ? out : poly;
}

// Prisme fermé bâti sur un polygone convexe (masque forme de coque). Les
// remontées optionnelles permettent de suivre la tonture d'une étrave/poupe au
// lieu d'imposer un volume parfaitement horizontal sur toute la longueur.
function prismGeometry(poly, y0, y1, { bowRise = 0, sternRise = 0 } = {}) {
  const verts = [];
  const n = poly.length;
  let cx = 0, cz = 0;
  poly.forEach(p => { cx += p.x; cz += p.z; });
  cx /= n; cz /= n;
  let minZ = Infinity, maxZ = -Infinity;
  poly.forEach(p => { minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
  const riseAt = p => {
    if (p.z >= cz) {
      const t = (p.z - cz) / Math.max(maxZ - cz, 1e-4);
      return bowRise * t * t;
    }
    const t = (cz - p.z) / Math.max(cz - minZ, 1e-4);
    return sternRise * t * t;
  };
  const push = (p, y) => verts.push(p.x, y, p.z);
  const center = { x: cx, z: cz };
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ar = riseAt(a), br = riseAt(b);
    push(a, y0 + ar); push(b, y0 + br); push(a, y1 + ar); // flanc
    push(b, y0 + br); push(b, y1 + br); push(a, y1 + ar);
    push(center, y1); push(a, y1 + ar); push(b, y1 + br); // capot haut
    push(center, y0); push(b, y0 + br); push(a, y0 + ar); // capot bas
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
}

// Volume de coque invisible, profondeur seule (anti eau-dans-le-cockpit)
function buildWaterMask() {
  // doit rester strictement DANS la coque: s'il déborde sous l'eau il perce
  // un trou dans la surface (ciel visible entre coque et eau).
  // Peu profond: juste la zone où la surface peut affleurer l'intérieur.
  const geo = new THREE.BoxGeometry(1.55, 0.6, 4.95, 1, 1, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, z / 2.47);
    p.setXYZ(i, x * (1 - 0.7 * t * t), y + 0.18 * t * t, z);
  }
  const mat = new THREE.MeshBasicMaterial({
    color: DEBUG_WATER_MASK ? 0x39ff14 : 0xffffff,
    colorWrite: DEBUG_WATER_MASK,
    side: THREE.DoubleSide, // le prisme convexe n'a pas de winding garanti
    toneMapped: false,
    fog: !DEBUG_WATER_MASK,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = DEBUG_WATER_MASK ? 'water-mask-debug' : 'water-mask';
  mesh.position.y = 0.12; // couvre ~[-0.18, +0.42]
  mesh.renderOrder = 1; // après bateau et ciel, avant l'océan (renderOrder 2)
  return mesh;
}

// Coque procédurale de secours (si boat.glb absent)
function buildFallbackBoat() {
  const g = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f2, roughness: 0.25, clearcoat: 0.8 });
  const navy = new THREE.MeshPhysicalMaterial({ color: 0x12263b, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fc4d8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35,
  });

  // coque effilée vers la proue, fond en V
  const hullGeo = new THREE.BoxGeometry(1.95, 0.85, 5.4, 1, 1, 12);
  const p = hullGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, z / 2.7);            // 0 au milieu -> 1 à la proue
    let nx = x * (1 - 0.72 * t * t);           // effilement
    let ny = y + 0.32 * t * t;                 // relevé d'étrave
    if (y < 0) ny += Math.abs(nx) * 0.18;      // fond en V
    p.setXYZ(i, nx, ny, z);
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, white);
  hull.position.y = -0.08;
  g.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 4.4), navy);
  deck.position.set(0, 0.38, -0.2);
  g.add(deck);

  const console = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.7), white);
  console.position.set(0, 0.68, 0.35);
  g.add(console);

  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.05), glass);
  shield.position.set(0, 1.05, 0.62);
  shield.rotation.x = -0.35;
  g.add(shield);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.6), navy);
  seat.position.set(0, 0.6, -0.5);
  g.add(seat);

  return g; // le hors-bord articulé est ajouté séparément
}
