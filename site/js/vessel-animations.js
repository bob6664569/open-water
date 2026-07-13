import * as THREE from 'three';

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

let _bitcoinFlagTexture = null;
function bitcoinFlagTexture() {
  if (_bitcoinFlagTexture) return _bitcoinFlagTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7931a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const disk = new Path2D(
    'm63.033,39.744c-4.274,17.143-21.637,27.576-38.782,23.301-17.138-4.274-27.571-21.638-23.295-38.78,4.272-17.145,21.635-27.579,38.775-23.305,17.144,4.274,27.576,21.64,23.302,38.784z',
  );
  const mark = new Path2D(
    'm46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z',
  );
  ctx.save();
  const logoSize = 350;
  const logoScale = logoSize / 64;
  ctx.translate((canvas.width - logoSize) * 0.5, (canvas.height - logoSize) * 0.5);
  ctx.scale(logoScale, logoScale);
  ctx.fillStyle = '#ffffff';
  ctx.fill(disk);
  ctx.fillStyle = '#f7931a';
  ctx.fill(mark);
  ctx.restore();
  _bitcoinFlagTexture = new THREE.CanvasTexture(canvas);
  _bitcoinFlagTexture.colorSpace = THREE.SRGBColorSpace;
  _bitcoinFlagTexture.wrapS = THREE.ClampToEdgeWrapping;
  _bitcoinFlagTexture.wrapT = THREE.ClampToEdgeWrapping;
  _bitcoinFlagTexture.anisotropy = 8;
  return _bitcoinFlagTexture;
}

let _navHaloTexture = null;
function navHaloTexture() {
  if (_navHaloTexture) return _navHaloTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.34)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.13)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.035)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _navHaloTexture = new THREE.CanvasTexture(canvas);
  _navHaloTexture.colorSpace = THREE.SRGBColorSpace;
  return _navHaloTexture;
}

function localBounds(object, root) {
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const box = new THREE.Box3().makeEmpty();

  object.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    const bounds = child.geometry.boundingBox;
    if (!bounds) return;
    rel.multiplyMatrices(invRoot, child.matrixWorld);
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          box.expandByPoint(point.set(x, y, z).applyMatrix4(rel));
        }
      }
    }
  });
  return box;
}

function componentMatches(component, selection) {
  for (const axis of ['x', 'y', 'z']) {
    const range = selection[`center${axis.toUpperCase()}`];
    if (range && (component.center[axis] < range[0]
                  || component.center[axis] > range[1])) return false;
  }
  return true;
}

function extractExistingComponents(mesh, selection, pivotCenter,
                                   suffix = 'existing-component', weldEps = 0) {
  // Recover movable parts from merged exports by selecting connected components;
  // optional welding reconnects coincident vertices from face-per-quad models.
  const geometry = mesh && mesh.geometry;
  const index = geometry && geometry.index;
  const position = geometry && geometry.attributes.position;
  if (!index || !position || !mesh.parent) return null;

  const parent = new Int32Array(position.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = value => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const indices = index.array;
  for (let i = 0; i < indices.length; i += 3) {
    union(indices[i], indices[i + 1]);
    union(indices[i], indices[i + 2]);
  }
  if (weldEps > 0) {
    const cell = new Map();
    for (let i = 0; i < position.count; i++) {
      const key = Math.round(position.getX(i) / weldEps) + '_'
        + Math.round(position.getY(i) / weldEps) + '_'
        + Math.round(position.getZ(i) / weldEps);
      const seen = cell.get(key);
      if (seen === undefined) cell.set(key, i); else union(i, seen);
    }
  }

  const components = new Map();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    let component = components.get(root);
    if (!component) {
      component = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
      };
      components.set(root, component);
    }
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    component.min.x = Math.min(component.min.x, x);
    component.min.y = Math.min(component.min.y, y);
    component.min.z = Math.min(component.min.z, z);
    component.max.x = Math.max(component.max.x, x);
    component.max.y = Math.max(component.max.y, y);
    component.max.z = Math.max(component.max.z, z);
  }
  const selectedRoots = new Set();
  for (const [root, component] of components) {
    component.center = component.min.clone().add(component.max).multiplyScalar(0.5);
    if (componentMatches(component, selection)) selectedRoots.add(root);
  }

  const movingIndices = [];
  const fixedIndices = [];
  for (let i = 0; i < indices.length; i += 3) {
    const destination = selectedRoots.has(find(indices[i]))
      ? movingIndices : fixedIndices;
    destination.push(indices[i], indices[i + 1], indices[i + 2]);
  }
  if (!movingIndices.length) return null;

  const original = geometry;
  const fixedGeometry = original.clone();
  fixedGeometry.setIndex(fixedIndices);
  fixedGeometry.clearGroups();
  fixedGeometry.addGroup(0, fixedIndices.length, 0);
  const movingGeometry = original.clone();
  movingGeometry.setIndex(movingIndices);
  movingGeometry.clearGroups();
  movingGeometry.addGroup(0, movingIndices.length, 0);
  movingGeometry.computeBoundingBox();
  const center = pivotCenter
    ? new THREE.Vector3().fromArray(pivotCenter)
    : movingGeometry.boundingBox.getCenter(new THREE.Vector3());

  mesh.geometry = fixedGeometry;
  const movingMesh = new THREE.Mesh(movingGeometry, mesh.material);
  movingMesh.name = `${mesh.name}-${suffix}`;
  movingMesh.position.copy(mesh.position);
  movingMesh.quaternion.copy(mesh.quaternion);
  movingMesh.scale.copy(mesh.scale);
  movingMesh.castShadow = mesh.castShadow;
  movingMesh.receiveShadow = mesh.receiveShadow;
  movingMesh.layers.mask = mesh.layers.mask;
  mesh.parent.add(movingMesh);

  movingMesh.updateMatrix();
  const pivot = new THREE.Group();
  pivot.name = `${mesh.name}-${suffix}-pivot`;
  pivot.position.copy(center).applyMatrix4(movingMesh.matrix);
  pivot.quaternion.copy(movingMesh.quaternion);
  movingMesh.parent.add(pivot);
  movingMesh.parent.updateMatrixWorld(true);
  pivot.attach(movingMesh);
  original.dispose();
  return pivot;
}

function splitMeshByBox(mesh, box) {
  // Fragmented exports may spread one motor across several material meshes.
  // Return the selected geometry without a pivot so callers can group the pieces.
  const geometry = mesh && mesh.geometry;
  const index = geometry && geometry.index;
  const position = geometry && geometry.attributes.position;
  if (!index || !position || !mesh.parent) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (bb.max.x < box.x[0] || bb.min.x > box.x[1]
      || bb.max.y < box.y[0] || bb.min.y > box.y[1]
      || bb.max.z < box.z[0] || bb.min.z > box.z[1]) return null;

  const parent = new Int32Array(position.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = value => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const indices = index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const a = find(indices[i]), b = find(indices[i + 1]), c = find(indices[i + 2]);
    if (a !== b) parent[b] = a;
    if (a !== c) parent[c] = a;
  }
  const bounds = new Map();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    let s = bounds.get(root);
    if (!s) { s = { mnx: Infinity, mny: Infinity, mnz: Infinity, mxx: -Infinity, mxy: -Infinity, mxz: -Infinity }; bounds.set(root, s); }
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < s.mnx) s.mnx = x; if (x > s.mxx) s.mxx = x;
    if (y < s.mny) s.mny = y; if (y > s.mxy) s.mxy = y;
    if (z < s.mnz) s.mnz = z; if (z > s.mxz) s.mxz = z;
  }
  const selectedRoots = new Set();
  for (const [root, s] of bounds) {
    const cx = (s.mnx + s.mxx) / 2, cy = (s.mny + s.mxy) / 2, cz = (s.mnz + s.mxz) / 2;
    if (cx >= box.x[0] && cx <= box.x[1] && cy >= box.y[0] && cy <= box.y[1]
        && cz >= box.z[0] && cz <= box.z[1]) selectedRoots.add(root);
  }
  if (!selectedRoots.size) return null;
  const movingIndices = [], fixedIndices = [];
  for (let i = 0; i < indices.length; i += 3) {
    const dest = selectedRoots.has(find(indices[i])) ? movingIndices : fixedIndices;
    dest.push(indices[i], indices[i + 1], indices[i + 2]);
  }
  if (!movingIndices.length) return null;

  const original = geometry;
  const fixedGeometry = original.clone();
  fixedGeometry.setIndex(fixedIndices);
  fixedGeometry.clearGroups();
  fixedGeometry.addGroup(0, fixedIndices.length, 0);
  const movingGeometry = original.clone();
  movingGeometry.setIndex(movingIndices);
  movingGeometry.clearGroups();
  movingGeometry.addGroup(0, movingIndices.length, 0);

  mesh.geometry = fixedGeometry;
  const movingMesh = new THREE.Mesh(movingGeometry, mesh.material);
  movingMesh.name = `${mesh.name}-region`;
  movingMesh.position.copy(mesh.position);
  movingMesh.quaternion.copy(mesh.quaternion);
  movingMesh.scale.copy(mesh.scale);
  movingMesh.castShadow = mesh.castShadow;
  movingMesh.receiveShadow = mesh.receiveShadow;
  movingMesh.layers.mask = mesh.layers.mask;
  mesh.parent.add(movingMesh);
  original.dispose();
  return movingMesh;
}

function createClothStrip(stripe, stripeCount, columns, rows, uvConfig = {}) {
  const vertexColumns = columns + 1;
  const vertexRows = rows + 1;
  const position = new Float32Array(vertexColumns * vertexRows * 3);
  const uv = new Float32Array(vertexColumns * vertexRows * 2);
  const flow = new Float32Array(vertexColumns * vertexRows);
  const across = new Float32Array(vertexColumns * vertexRows);
  const indices = [];
  const uScale = uvConfig.uScale ?? 1;
  const uOffset = uvConfig.uOffset ?? 0;
  const vScale = uvConfig.vScale ?? 1;
  const vOffset = uvConfig.vOffset ?? 0;

  for (let column = 0; column < vertexColumns; column++) {
    const u = (stripe + column / columns) / stripeCount;
    for (let row = 0; row < vertexRows; row++) {
      const index = column * vertexRows + row;
      flow[index] = u;
      across[index] = row / rows * 2 - 1;
      position[index * 3] = u;
      position[index * 3 + 1] = across[index];
      uv[index * 2] = u * uScale + uOffset;
      uv[index * 2 + 1] = row / rows * vScale + vOffset;
    }
  }
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const a = column * vertexRows + row;
      const b = (column + 1) * vertexRows + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(position, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, position: positionAttribute, flow, across };
}

export class VesselAnimationRig {
  constructor(model, spec) {
    this.steerPivots = [];
    this.propellers = [];
    this.rotators = [];
    this.bones = [];
    this.flags = [];
    this.navLights = [];
    this.navWater = [];
    this._navCfg = null;
    this._steer = 0;
    this._time = 0;
    this._point = new THREE.Vector3();
    this._clothDirection = new THREE.Vector3();
    this._clothNormal = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();

    const config = spec.rig;
    if (!config) return;

    const propConfigs = [
      ...(config.existingPropeller ? [config.existingPropeller] : []),
      ...(config.existingPropellers || []),
    ];
    const extractedPropSources = new Set();
    for (const propConfig of propConfigs) {
      const mesh = model.getObjectByName(propConfig.mesh);
      const pivot = extractExistingComponents(
        mesh, propConfig.selection, propConfig.pivot, 'existing-propeller',
      );
      if (pivot) {
        if (mesh) extractedPropSources.add(mesh);
        this.propellers.push({
          pivot,
          axis: propConfig.axis || 'z',
          handedness: propConfig.handedness || 1,
          spinRate: propConfig.spinRate,
        });
      }
    }
    for (const name of config.hideExtractedPropRemainders || []) {
      for (const mesh of extractedPropSources) {
        if (mesh.name === name) mesh.visible = false;
      }
    }
    for (const steerConfig of config.existingSteerComponents || []) {
      const mesh = model.getObjectByName(steerConfig.mesh);
      const pivot = extractExistingComponents(
        mesh, steerConfig.selection, steerConfig.pivot, 'existing-rudder',
      );
      if (!pivot) continue;
      this.steerPivots.push({
        pivot,
        base: pivot.quaternion.clone(),
        axis: AXES[steerConfig.axis || 'y'],
        ratio: steerConfig.ratio ?? 1,
      });
    }
    for (const rotConfig of config.rotators || []) {
      const mesh = model.getObjectByName(rotConfig.mesh);
      const pivot = extractExistingComponents(
        mesh, rotConfig.selection, rotConfig.pivot, 'rotator', rotConfig.weld || 0,
      );
      if (!pivot) continue;
      this.rotators.push({
        pivot,
        axis: rotConfig.axis || 'y',
        rate: rotConfig.rate ?? 2.5,
      });
    }
    for (const propConfig of config.nodePropellers || []) {
      const pivot = this._rigNodePivot(model, propConfig, 'propeller');
      if (!pivot) continue;
      this.propellers.push({
        pivot,
        axis: propConfig.axis || 'z',
        handedness: propConfig.handedness || 1,
        spinRate: propConfig.spinRate,
      });
    }
    if (config.modelSteer) this._rigModelSteering(model, config.modelSteer);
    if (config.regionMotors) this._rigRegionMotors(model, config.regionMotors);
    for (const controlConfig of config.nodeControls || []) {
      const pivot = this._rigNodePivot(model, controlConfig, 'control');
      if (!pivot) continue;
      this.steerPivots.push({
        pivot,
        base: pivot.quaternion.clone(),
        axis: AXES[controlConfig.axis || 'y'],
        ratio: controlConfig.ratio ?? 1,
      });
    }
    if (config.existingFlag) this._rigExistingFlag(model, config.existingFlag);
    if (config.navLights) this._rigNavLights(model, config.navLights);
    for (const boneConfig of config.bones || []) {
      const bone = model.getObjectByName(boneConfig.node);
      if (!bone) continue;
      this.bones.push({
        bone,
        base: bone.quaternion.clone(),
        axis: AXES[boneConfig.axis || 'y'],
        ratio: boneConfig.ratio || 1,
        vibration: boneConfig.vibration || 0,
      });
    }
  }

  _rigModelSteering(model, config) {
    const motor = model.getObjectByName(config.node);
    if (!motor) return;
    const box = localBounds(motor, model);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `${config.node}-steering-pivot`;
    pivot.position.set(
      center.x,
      box.max.y - size.y * (config.pivotTop ?? 0.2),
      box.max.z - size.z * (config.pivotForward ?? 0.08),
    );
    model.add(pivot);
    model.updateMatrixWorld(true);
    pivot.attach(motor);
    this.steerPivots.push({
      pivot,
      base: pivot.quaternion.clone(),
      axis: AXES[config.axis || 'y'],
      ratio: config.ratio ?? 1,
    });
  }

  _rigRegionMotors(model, config) {
    const exclude = config.exclude || [];
    const sources = [];
    model.traverse(o => {
      if (o.isMesh && o.geometry && !exclude.includes(o.material?.name)) sources.push(o);
    });
    for (const motor of config.motors || []) {
      const propMeshes = [];
      for (const src of sources) {
        const moving = splitMeshByBox(src, motor.prop.box);
        if (moving) propMeshes.push(moving);
      }
      const bodyMeshes = [];
      for (const src of sources) {
        const moving = splitMeshByBox(src, motor.box);
        if (moving) bodyMeshes.push(moving);
      }
      const anchor = bodyMeshes[0] || propMeshes[0];
      if (!anchor) continue;
      const parent = anchor.parent;

      const steerPivot = new THREE.Group();
      steerPivot.name = 'region-motor-steer';
      steerPivot.position.fromArray(motor.steer.pivot);
      parent.add(steerPivot);
      parent.updateMatrixWorld(true);
      for (const m of bodyMeshes) steerPivot.attach(m);
      this.steerPivots.push({
        pivot: steerPivot,
        base: steerPivot.quaternion.clone(),
        axis: AXES[motor.steer.axis || 'z'],
        ratio: motor.steer.ratio ?? 1,
      });

      if (propMeshes.length) {
        const propPivot = new THREE.Group();
        propPivot.name = 'region-motor-prop';
        propPivot.position.fromArray(motor.prop.pivot);
        parent.add(propPivot);
        parent.updateMatrixWorld(true);
        for (const m of propMeshes) propPivot.attach(m);
        steerPivot.attach(propPivot);
        this.propellers.push({
          pivot: propPivot,
          axis: motor.prop.axis || 'y',
          handedness: motor.prop.handedness || 1,
          spinRate: motor.prop.spinRate,
        });
      }
    }
  }

  _rigNodePivot(model, config, suffix) {
    const names = config.nodes || (config.node ? [config.node] : []);
    const objects = names.map(name => model.getObjectByName(name)).filter(Boolean);
    if (!objects.length) return null;
    const parent = objects[0].parent;
    if (!parent || objects.some(object => object.parent !== parent)) return null;
    const box = new THREE.Box3().makeEmpty();
    for (const object of objects) box.union(localBounds(object, parent));
    if (box.isEmpty()) return null;
    const pivot = new THREE.Group();
    pivot.name = `${names.join('-')}-${suffix}-pivot`;
    pivot.position.copy(config.pivot
      ? new THREE.Vector3().fromArray(config.pivot)
      : box.getCenter(new THREE.Vector3()));
    parent.add(pivot);
    parent.updateMatrixWorld(true);
    for (const object of objects) pivot.attach(object);
    return pivot;
  }

  _rigExistingFlag(model, config) {
    const flag = model.getObjectByName(config.node);
    if (!flag) return;
    flag.updateMatrixWorld(true);
    const inverseFlag = new THREE.Matrix4().copy(flag.matrixWorld).invert();
    const attachmentStart = new THREE.Vector3().fromArray(config.attachmentStart);
    const attachmentEnd = new THREE.Vector3().fromArray(config.attachmentEnd);
    const span = attachmentEnd.clone().sub(attachmentStart);
    const height = span.length();
    span.normalize();
    const down = new THREE.Vector3().fromArray(config.down).normalize();
    const wind = new THREE.Vector3().fromArray(config.wind).normalize();
    const point = new THREE.Vector3();
    const relative = new THREE.Matrix4();
    const meshes = [];
    const stripeCount = config.stripeCount ?? 3;
    const length = config.length ?? height * 1.5;
    const restDirection = wind.clone().multiplyScalar(0.2)
      .addScaledVector(down, 0.52).normalize();

    flag.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
      const materialName = mesh.material.name;
      const stripe = config.stripes?.[materialName];
      if (stripe === undefined) return;
      relative.multiplyMatrices(inverseFlag, mesh.matrixWorld);
      const toLocal = relative.clone().invert();
      const cloth = createClothStrip(
        stripe, stripeCount, config.columns ?? 8, config.rows ?? 12,
        config.uv,
      );
      mesh.geometry.dispose();
      mesh.geometry = cloth.geometry;
      mesh.material = mesh.material.clone();
      mesh.material.side = THREE.DoubleSide;
      mesh.material.shadowSide = THREE.DoubleSide;
      mesh.material.vertexColors = false;
      if (config.texture === 'bitcoin') {
        mesh.material.map = bitcoinFlagTexture();
        mesh.material.emissiveMap = null;
        if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
        if (mesh.material.color) mesh.material.color.setHex(0xffffff);
      }
      const replacement = config.colors?.[materialName];
      if (replacement !== undefined && mesh.material.color) {
        mesh.material.color.setHex(replacement);
      }
      mesh.material.needsUpdate = true;
      mesh.frustumCulled = false;

      for (let i = 0; i < cloth.position.count; i++) {
        point.copy(attachmentStart)
          .addScaledVector(span, (cloth.across[i] + 1) * height * 0.5)
          .addScaledVector(restDirection, cloth.flow[i] * length)
          .applyMatrix4(toLocal);
        cloth.position.setXYZ(i, point.x, point.y, point.z);
      }
      cloth.position.needsUpdate = true;
      cloth.geometry.computeVertexNormals();
      cloth.geometry.computeBoundingSphere();
      meshes.push({
        geometry: cloth.geometry,
        position: cloth.position,
        flow: cloth.flow,
        across: cloth.across,
        toLocal,
      });
    });
    if (meshes.length !== stripeCount || height <= 0 || length <= 0) return;
    this.flags.push({
      meshes,
      span,
      attachmentStart,
      down,
      wind,
      length,
      height,
      amplitude: config.amplitude ?? 1.8,
      frequency: config.frequency ?? 1.35,
    });
  }

  _rigNavLights(model, config) {
    // Emit from cloned lens materials and project the same lights onto wave geometry.
    const lenses = config.lenses || {};
    const texture = navHaloTexture();
    const center = new THREE.Vector3();
    const worldScale = new THREE.Vector3();
    model.updateMatrixWorld(true);
    model.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material) return;
      const hex = lenses[mesh.material.name];
      if (hex === undefined) return;
      mesh.material = mesh.material.clone();
      const material = mesh.material;
      material.emissive = new THREE.Color(hex);
      material.emissiveIntensity = 0;
      material.needsUpdate = true;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox.getCenter(center);
      mesh.getWorldScale(worldScale);
      const unit = 1 / (worldScale.x || 1);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color(hex),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }));
      sprite.position.copy(center);
      sprite.scale.setScalar(unit * (config.haloSize ?? 0.6));
      sprite.visible = false;
      sprite.renderOrder = 6;
      mesh.add(sprite);
      const water = {
        color: new THREE.Color(hex), x: 0, z: 0, radius: 1, intensity: 0,
      };
      this.navWater.push(water);
      this.navLights.push({ material, sprite, unit, water });
    });
    if (this.navLights.length) this._navCfg = config;
  }

  getWaterLights() {
    return this.navWater;
  }

  _updateNavLights(boat) {
    const cfg = this._navCfg;
    const hs = boat.wf?.significantWaveHeight ?? 0.9;
    const lit = THREE.MathUtils.clamp(
      (hs - cfg.litRange[0]) / (cfg.litRange[1] - cfg.litRange[0]), 0, 1);
    const storm = THREE.MathUtils.smoothstep(
      hs, cfg.stormRange[0], cfg.stormRange[1]);
    const period = cfg.period ?? 1.5;
    const on = cfg.onFraction ?? 0.42;
    const phase = (this._time % period) / period;
    const pulse = phase < on ? Math.sin((phase / on) * Math.PI) : 0;
    const emissive = lit * pulse
      * (cfg.roughEmissive + (cfg.stormEmissive - cfg.roughEmissive) * storm);
    const halo = lit * storm * pulse * (cfg.haloOpacity ?? 0.95);
    const size = (cfg.haloSize ?? 0.6) * (0.9 + 0.14 * pulse) * (0.78 + 0.22 * storm);
    const waterRough = cfg.waterRough ?? 0.5;
    const waterStorm = cfg.waterStorm ?? 1.6;
    const waterGlow = lit * pulse
      * (waterRough + (waterStorm - waterRough) * storm);
    const waterRadius = (cfg.waterRadius ?? 3.2) * (0.82 + 0.18 * storm);
    for (const light of this.navLights) {
      light.material.emissiveIntensity = emissive;
      light.sprite.material.opacity = halo;
      light.sprite.visible = halo > 0.003;
      light.sprite.scale.setScalar(light.unit * size);
      light.sprite.getWorldPosition(this._point);
      light.water.x = this._point.x;
      light.water.z = this._point.z;
      light.water.radius = waterRadius;
      light.water.intensity = waterGlow;
    }
  }

  update(dt, boat) {
    this._time += dt;
    this._steer += (boat._effSteer - this._steer) * (1 - Math.exp(-dt * 9));
    for (const steer of this.steerPivots) {
      this._rotation.setFromAxisAngle(steer.axis, this._steer * steer.ratio);
      steer.pivot.quaternion.copy(steer.base).multiply(this._rotation);
    }
    for (const control of this.bones) {
      const vibration = control.vibration
        * Math.abs(boat.throttle) * Math.sin(this._time * 31);
      this._rotation.setFromAxisAngle(
        control.axis, this._steer * control.ratio + vibration,
      );
      control.bone.quaternion.copy(control.base).multiply(this._rotation);
    }
    const throttleAbs = Math.abs(boat.throttle);
    for (const propeller of this.propellers) {
      const spinRate = boat.throttle
        * (propeller.spinRate ?? (8 + 42 * throttleAbs));
      propeller.pivot.rotation[propeller.axis] +=
        spinRate * propeller.handedness * dt;
    }
    for (const rotator of this.rotators) {
      rotator.pivot.rotation[rotator.axis] += rotator.rate * dt;
    }
    const seaHeight = boat.wf?.significantWaveHeight ?? 0.9;
    if (this._navCfg) this._updateNavLights(boat);
    const stormWind = THREE.MathUtils.smoothstep(seaHeight, 0.9, 5.2);
    const flagAir = THREE.MathUtils.clamp(
      0.28 + boat.speedKn / 30 + stormWind * 0.72, 0.28, 1.35,
    );
    const windPull = THREE.MathUtils.clamp(
      0.2 + boat.speedKn / 26 + stormWind * 0.78, 0.2, 1,
    );
    for (const flag of this.flags) {
      this._clothDirection.copy(flag.wind).multiplyScalar(windPull)
        .addScaledVector(flag.down, (1 - windPull) * 0.65).normalize();
      this._clothNormal.crossVectors(
        flag.span, this._clothDirection,
      ).normalize();
      const phase = this._time * flag.frequency * Math.PI * 2
        * (0.78 + flagAir * 0.32 + stormWind * 0.55);
      for (const mesh of flag.meshes) {
        for (let i = 0; i < mesh.position.count; i++) {
          const flow = mesh.flow[i];
          const across = mesh.across[i];
          const freedom = THREE.MathUtils.smoothstep(flow, 0, 0.075);
          const wave = Math.sin(phase - flow * Math.PI * 2.35)
            + 0.3 * Math.sin(phase * 1.9 - flow * Math.PI * 5.1
              + across * 1.25);
          const billow = wave * flag.amplitude * flagAir * freedom;
          const edgeFlutter = Math.sin(
            phase * 1.43 - flow * Math.PI * 3.7 + across * 2.1,
          );
          const edgeFreedom = 0.35 + Math.abs(across) * 0.65;
          const edgeLift = edgeFlutter * flag.amplitude * flagAir
            * freedom * edgeFreedom * 0.38;
          const slack = -(1 - Math.cos(phase - flow * Math.PI * 2.1))
            * flag.amplitude * flagAir * freedom * 0.1;
          const gravityDrop = flag.length * 0.08 * (1 - windPull)
            * flow * flow;
          this._point.copy(flag.attachmentStart)
            .addScaledVector(flag.span, (across + 1) * flag.height * 0.5)
            .addScaledVector(this._clothDirection, flow * flag.length)
            .addScaledVector(flag.down, gravityDrop)
            .addScaledVector(this._clothNormal, billow)
            .addScaledVector(flag.span, edgeLift)
            .addScaledVector(this._clothDirection, slack)
            .applyMatrix4(mesh.toLocal);
          mesh.position.setXYZ(i, this._point.x, this._point.y, this._point.z);
        }
        mesh.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
  }

  getPropellerWorldPositions(target = []) {
    let count = 0;
    for (const propeller of this.propellers) {
      propeller.pivot.getWorldPosition(this._point);
      let duplicate = false;
      for (let i = 0; i < count; i++) {
        if (target[i].distanceToSquared(this._point) < 0.01) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;
      target[count] ||= new THREE.Vector3();
      target[count++].copy(this._point);
    }
    target.length = count;
    return target;
  }

  dispose() {
    for (const light of this.navLights) {
      light.sprite.removeFromParent();
      light.sprite.material.dispose();
    }
    this.navLights.length = 0;
    this.navWater.length = 0;
  }
}
