import * as THREE from 'three';

const GUIDE_STORAGE_KEY = 'ocean-boat:first-voyage-guide:v1';
const NM = 1852;
const OPEN_WATER_METERS = 0.5 * NM;
const START_DELAY = 2200;
const ARRIVAL_RADIUS = 14;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _projected = new THREE.Vector3();
const _cameraSpace = new THREE.Vector3();
const _arrowLocal = new THREE.Vector3();

function storageValue() {
  try { return localStorage.getItem(GUIDE_STORAGE_KEY); } catch { return null; }
}

function remember(value) {
  try { localStorage.setItem(GUIDE_STORAGE_KEY, value); } catch { /* optional */ }
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function maritimeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function makeBuoy() {
  const group = new THREE.Group();
  const red = maritimeMaterial(0xe15b3e, { roughness: 0.5 });
  const pale = maritimeMaterial(0xe9f0ed, { roughness: 0.7 });
  const dark = maritimeMaterial(0x263d45, { roughness: 0.48, metalness: 0.28 });
  const lamp = maritimeMaterial(0xbbeeff, {
    roughness: 0.25, emissive: 0x6fc8ef, emissiveIntensity: 1.5,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.78, 14), red);
  base.position.y = 0.38;
  const shoulder = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.62, 14, 1, true), pale);
  shoulder.position.y = 1.06;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.15, 8), dark);
  pole.position.y = 1.72;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 7), lamp);
  cap.position.y = 2.34;
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), lamp);
  beacon.position.y = 5.2;
  group.add(base, shoulder, pole, cap, beacon);

  const rings = [];
  for (let i = 0; i < 3; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x72d7ff, transparent: true, opacity: 0.3 - i * 0.045,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const radius = 9 + i * 6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.42, 72), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08 + i * 0.015;
    ring.userData.phase = i * 0.7;
    rings.push(ring);
    group.add(ring);
  }

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x72d7ff, transparent: true, opacity: 0.15,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  // Le pied du cône EST la zone de validation : ARRIVAL_RADIUS est partagé
  // avec le test de distance plus bas, sans rayon logique invisible.
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, ARRIVAL_RADIUS, 30, 24, 1, true), beamMaterial);
  beam.position.y = 15;
  group.add(beam);

  group.userData.pulse = rings;
  group.userData.beam = beam;
  group.userData.beacon = beacon;
  group.userData.arrived = false;
  return group;
}

function makeDirectionArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.18, -0.58);
  shape.lineTo(0.18, -0.58);
  shape.lineTo(0.18, 0.12);
  shape.lineTo(0.48, 0.12);
  shape.lineTo(0, 0.64);
  shape.lineTo(-0.48, 0.12);
  shape.lineTo(-0.18, 0.12);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.13, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.045, bevelThickness: 0.045,
  });
  geometry.center();
  const group = new THREE.Group();
  const arrows = [];
  for (let i = 0; i < 3; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x72d7ff, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.48 - i * 0.52;
    mesh.scale.setScalar(0.72);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1000;
    arrows.push(mesh);
    group.add(mesh);
  }
  group.visible = false;
  group.userData.arrows = arrows;
  return group;
}

function makeSightingPoint() {
  const group = new THREE.Group();
  group.userData.arrived = false;
  group.userData.sighting = true;
  return group;
}

export class FirstVoyageGuide {
  constructor({ scene, camera, boat, waveField, achievements, fish, wildlife }) {
    this.scene = scene;
    this.camera = camera;
    this.boat = boat;
    this.waveField = waveField;
    this.achievements = achievements;
    this.fish = fish;
    this.wildlife = wildlife;

    this.root = document.getElementById('first-voyage-guide');
    this.kicker = document.getElementById('first-voyage-kicker');
    this.title = document.getElementById('first-voyage-title');
    this.copy = document.getElementById('first-voyage-copy');
    this.steps = [...document.querySelectorAll('.first-voyage-step')];
    this.skipButton = document.getElementById('first-voyage-skip');

    this.active = false;
    this.stage = 'idle';
    this.elapsed = 0;
    this.stageElapsed = 0;
    this.steerEnergy = 0;
    this.marker = null;
    this.markers = [];
    this.directionArrow = makeDirectionArrow();
    this.scene.add(this.directionArrow);
    this.target = new THREE.Vector3();
    this.guidedSchool = null;
    this.guidedBirdsSpawned = false;
    this.dispersedAtStart = 0;
    this.initialBoatId = null;
    this.initialSea = null;
    this.experimented = false;
    this.arrivalTimer = null;

    this.skipButton?.addEventListener('click', event => {
      this.stop('skipped');
      if (event.detail > 0) event.currentTarget.blur();
    });
  }

  shouldRun() {
    return !!this.root
      && storageValue() !== 'skipped'
      && !this.achievements.isRewardUnlocked('azure')
      && this.achievements.state.totalSeconds < 120;
  }

  start() {
    if (this.active || !this.shouldRun()) return;
    this.active = true;
    this.elapsed = 0;
    this.stageElapsed = 0;
    this.initialBoatId = this.boat.spec?.id;
    this.initialSea = this.waveField.preset;
    this.fish.prepareGuidedSchool();
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this._setStage('throttle');
  }

  stop(reason = 'complete') {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.arrivalTimer);
    this.arrivalTimer = null;
    this._removeAllMarkers();
    this.directionArrow.visible = false;
    // Une fin normale ne retire pas l'incitation aux états de mer : elle vit
    // désormais jusqu'au premier changement effectif (géré dans main.js).
    if (reason !== 'complete') document.body.classList.remove('sea-trial-visible');
    this.root?.classList.remove('visible');
    this.root?.setAttribute('aria-hidden', 'true');
    if (reason === 'skipped') remember('skipped');
    setTimeout(() => { if (this.root) this.root.hidden = true; }, 650);
  }

  _setStage(stage) {
    this.stage = stage;
    this.stageElapsed = 0;
    this.steerEnergy = 0;
    this.root?.classList.remove('stage-complete', 'waypoint-reached');
    this.steps.forEach((step, index) => {
      const activeIndex = stage === 'throttle' ? 0
        : stage === 'turn' || stage === 'course' || stage === 'course-two' ? 1
          : stage === 'sighting' ? 2 : 3;
      step.classList.toggle('active', index === activeIndex);
      step.classList.toggle('done', index < activeIndex);
    });

    if (stage === 'throttle') {
      this._show('FIRST CROSSING', 'Take the helm', 'Push the throttle and make way.');
    } else if (stage === 'turn') {
      this._placeBuoy(88, 36);
      this._show('WAYPOINT 01 · 03', 'Take a bearing', 'Enter the blue light cone around the buoy.');
    } else if (stage === 'course') {
      // Franchement sur l'autre bord : cette étape apprend volontairement à
      // suivre la flèche 3D quand la destination sort du champ.
      this._placeBuoy(115, -195);
      this._show('WAYPOINT 02 · 03', 'Find the second buoy', 'Turn and line up your course with the next blue light.');
    } else if (stage === 'course-two') {
      this._placeBuoy(220, 80);
      this._show('WAYPOINT 03 · 03', 'Confirm your course', 'Reach the final blue light cone.');
    } else if (stage === 'sighting') {
      this.dispersedAtStart = this.fish.dispersedSchools;
      this.guidedSchool = null;
      this.guidedBirdsSpawned = false;
      this._placeFinalSightingPoint();
      this._show('OPEN-WATER SIGHTING', 'Look to the sky', 'Follow the birds. The 3D arrows will guide you if they leave view.');
    } else if (stage === 'experiment') {
      this._removeAllMarkers();
      this.directionArrow.visible = false;
      this.root?.classList.remove('visible');
      this.root?.setAttribute('aria-hidden', 'true');
      document.body.classList.add('sea-trial-visible');
      document.body.classList.add('dock-revealed', 'controls-revealed');
    }
  }

  _show(kicker, title, copy) {
    if (this.kicker) this.kicker.textContent = kicker;
    if (this.title) this.title.textContent = title;
    if (this.copy) this.copy.textContent = copy;
  }

  _boatBasis() {
    _forward.set(0, 0, 1).applyQuaternion(this.boat.quat).setY(0).normalize();
    _right.set(1, 0, 0).applyQuaternion(this.boat.quat).setY(0).normalize();
  }

  _placeBuoy(forwardDistance, lateralDistance) {
    this._boatBasis();
    this.target.copy(this.boat.pos)
      .addScaledVector(_forward, forwardDistance)
      .addScaledVector(_right, lateralDistance);
    this.marker = makeBuoy();
    this.marker.position.copy(this.target);
    this.markers.push(this.marker);
    this.scene.add(this.marker);
  }

  _placeFinalSightingPoint() {
    const remaining = Math.max(0, OPEN_WATER_METERS - this.achievements.state.distanceMeters);
    const leg = THREE.MathUtils.clamp(remaining + 45, 220, 520);
    this._boatBasis();
    // Dernier changement de rythme : la ronde est sur le bord opposé, à ~58°,
    // tout en conservant exactement la longueur de jambe nécessaire au 0,5 NM.
    this.target.copy(this.boat.pos)
      .addScaledVector(_forward, leg * 0.53)
      .addScaledVector(_right, -leg * 0.848);
    this.marker = makeSightingPoint();
    this.marker.position.copy(this.target);
    this.markers.push(this.marker);
    this.scene.add(this.marker);
  }

  _spawnSightingLife() {
    if (!this.marker) return;
    const distance = horizontalDistance(this.boat.pos, this.target);
    if (!this.guidedBirdsSpawned) {
      this.guidedBirdsSpawned = this.wildlife?.spawnGuidedFlockAt(this.target, 9) || false;
      if (this.guidedBirdsSpawned) {
        this._show('WILDLIFE SIGHTED', 'Follow the circling flock', 'Keep the birds in view, or follow the blue arrows.');
      }
    }
    // Les poissons ne sont placés qu'à l'approche : ils restent ainsi sous la
    // bouée au moment du passage au lieu d'avoir dérivé pendant toute la route.
    if (!this.guidedSchool && distance <= 150) {
      this._boatBasis();
      const heading = Math.atan2(_right.x, _right.z);
      this.guidedSchool = this.fish.spawnGuidedSchoolAt(this.target, heading);
      if (this.guidedSchool) {
        this._show('MOVEMENT BELOW', 'Fish beneath the flock', 'Pass below the birds and watch the school scatter.');
      }
    }
  }

  _removeAllMarkers() {
    this.markers.forEach(marker => {
      this.scene.remove(marker);
      marker.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    });
    this.markers.length = 0;
    this.marker = null;
  }

  _updateMarkers() {
    this.markers.forEach(marker => {
      const waterY = this.waveField.heightAt(marker.position.x, marker.position.z);
      marker.position.y = waterY + Math.sin(this.elapsed * 1.8 + marker.id) * 0.05;
      const isCurrent = marker === this.marker && !marker.userData.arrived;
      const arrivalAge = marker.userData.arrivalAt == null
        ? Infinity : this.elapsed - marker.userData.arrivalAt;
      const pulse = marker.userData.pulse || [];
      pulse.forEach((ring, index) => {
        const wave = 0.5 + 0.5 * Math.sin(this.elapsed * 2.2 - index * 0.75);
        ring.material.opacity = isCurrent
          ? 0.12 + wave * 0.2
          : arrivalAge < 1.2 ? (1 - arrivalAge / 1.2) * 0.5 : 0.018;
        const travel = isCurrent ? ((this.elapsed * 0.16 + ring.userData.phase) % 1) : 0;
        const scale = isCurrent ? 0.9 + travel * 0.22 : 1;
        ring.scale.setScalar(scale);
      });
      if (marker.userData.beam) marker.userData.beam.material.opacity = isCurrent ? 0.15 : 0.006;
      if (marker.userData.beacon) {
        marker.userData.beacon.rotation.y += isCurrent ? 0.018 : 0.004;
        marker.userData.beacon.scale.setScalar(isCurrent ? 1 + Math.sin(this.elapsed * 3) * 0.12 : 0.72);
      }
    });
  }

  _updateDirectionArrow() {
    const arrow = this.directionArrow;
    if (!arrow || !this.marker || this.marker.userData.arrived || !this.camera) {
      if (arrow) arrow.visible = false;
      return;
    }
    const targetHeight = this.stage === 'sighting' ? 12 : 4.5;
    _projected.copy(this.target).setY(this.marker.position.y + targetHeight).project(this.camera);
    _cameraSpace.copy(this.target).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = _cameraSpace.z > 0;
    let dx = _projected.x;
    let dy = _projected.y;
    if (behind) { dx = -dx; dy = -dy; }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) + Math.abs(dy) < 0.01) {
      dx = 0;
      dy = -1;
    }
    const outside = behind || Math.abs(dx) > 0.98 || Math.abs(dy) > 0.92;
    arrow.visible = outside;
    if (!outside) return;

    const clampScale = Math.max(Math.abs(dx) / 0.98, Math.abs(dy) / 0.92, 1);
    const edgeX = dx / clampScale;
    const edgeY = dy / clampScale;
    const halfHeight = 3.75;
    _arrowLocal.set(edgeX * halfHeight * this.camera.aspect, edgeY * halfHeight, -8);
    arrow.position.copy(_arrowLocal).applyMatrix4(this.camera.matrixWorld);
    arrow.quaternion.copy(this.camera.quaternion);
    arrow.rotateZ(Math.atan2(edgeY, edgeX) - Math.PI / 2);
    const pulse = 0.86 + Math.sin(this.elapsed * 4.2) * 0.1;
    arrow.scale.setScalar(pulse);
    arrow.userData.arrows.forEach((mesh, index) => {
      mesh.material.opacity = 0.48 + 0.4 * (
        0.5 + 0.5 * Math.sin(this.elapsed * 5.2 - index * 0.75)
      );
    });
  }

  _arriveAtWaypoint(nextStage) {
    if (!this.marker || this.marker.userData.arrived) return;
    this.marker.userData.arrived = true;
    this.marker.userData.arrivalAt = this.elapsed;
    this.root?.classList.add('waypoint-reached');
    this._show('WAYPOINT REACHED', 'Course confirmed', 'The next navigation zone is coming into view.');
    clearTimeout(this.arrivalTimer);
    this.arrivalTimer = setTimeout(() => {
      this.arrivalTimer = null;
      if (this.active) this._setStage(nextStage);
    }, 950);
  }

  _finishAfterSchoolDispersal() {
    this.stage = 'open-water';
    this.stageElapsed = 0;
    this._removeAllMarkers();
    this.directionArrow.visible = false;
    this.root?.classList.remove('visible');
    this.root?.setAttribute('aria-hidden', 'true');
  }

  update(dt) {
    if (!this.active || dt <= 0) return;
    this.elapsed += dt;
    this.stageElapsed += dt;
    if (this.elapsed >= START_DELAY / 1000) this.root?.classList.add('visible');
    this._updateMarkers();
    this._updateDirectionArrow();

    if (this.stage === 'throttle') {
      if (this.boat.speedKn >= 12 || this.boat.throttle >= 0.75) this._setStage('turn');
      return;
    }

    if (this.stage === 'turn') {
      const reached = this.marker && horizontalDistance(this.boat.pos, this.target) < ARRIVAL_RADIUS;
      if (reached) this._arriveAtWaypoint('course');
      return;
    }

    if (this.stage === 'course') {
      const reached = this.marker && horizontalDistance(this.boat.pos, this.target) < ARRIVAL_RADIUS;
      if (reached) this._arriveAtWaypoint('course-two');
      return;
    }

    if (this.stage === 'course-two') {
      const reached = this.marker && horizontalDistance(this.boat.pos, this.target) < ARRIVAL_RADIUS;
      if (reached) this._arriveAtWaypoint('sighting');
      return;
    }

    if (this.stage === 'sighting') {
      this._spawnSightingLife();
      const crossedSchool = this.guidedSchool
        && horizontalDistance(this.boat.pos, this.target) < 26;
      if (crossedSchool) this.fish.scatterGuidedSchool(this.guidedSchool);
      const dispersed = this.fish.dispersedSchools > this.dispersedAtStart;
      if (dispersed) this._finishAfterSchoolDispersal();
      return;
    }

    if (this.stage === 'open-water') {
      if (this.achievements.isRewardUnlocked('azure')) this._setStage('experiment');
      return;
    }

    if (this.stage === 'experiment') {
      const changedBoat = this.boat.spec?.id && this.boat.spec.id !== this.initialBoatId;
      const changedSea = this.waveField.preset !== this.initialSea;
      this.experimented ||= changedBoat || changedSea;
      if (this.achievements.isRewardUnlocked('zodiac') && (this.experimented || this.stageElapsed > 18)) {
        this.stop('complete');
      }
    }
  }
}
