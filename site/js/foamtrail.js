import * as THREE from 'three';

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const SPLAT_MAX = 56;

// The boat paints a world-space ping-pong texture so foam persists through turns.
export class FoamTrail {
  constructor() {
    this.worldSize = 150;
    const res = 512;
    const opts = { depthBuffer: false, stencilBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(res, res, opts);
    this.rtB = new THREE.WebGLRenderTarget(res, res, opts);
    this.texel = this.worldSize / res;
    this.center = new THREE.Vector2(0, 0);

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 10);
    this.cam.position.z = 1;

    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uDecay: { value: 1 },
        uSpread: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uPrev;
        uniform vec2 uShift;
        uniform float uDecay;
        uniform float uSpread;
        varying vec2 vUv;
        float tap(vec2 uv) {
          return (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
                 ? 0.0 : texture2D(uPrev, uv).r;
        }
        void main() {
          vec2 uv = vUv + uShift;

          float e = 1.6 / 512.0;
          float c = tap(uv);
          float nb = (tap(uv + vec2(e, 0.0)) + tap(uv - vec2(e, 0.0))
                    + tap(uv + vec2(0.0, e)) + tap(uv - vec2(0.0, e))) * 0.25;
          float v = mix(c, nb, uSpread);
          gl_FragColor = vec4(vec3(v * uDecay), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fadeMat);
    quad.position.set(0.5, 0.5, 0);
    quad.renderOrder = 0;
    this.scene.add(quad);

    const tex = splatTexture();
    this.splats = [];
    for (let i = 0; i < SPLAT_MAX; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        }));
      m.renderOrder = 1;
      m.position.z = 0.1;
      this.scene.add(m);
      this.splats.push(m);
    }

    this._p = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._lastStern = null;
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  get texture() { return this.rtA.texture; }

  _place(i, x, z, widthM, lengthM, yaw, alpha) {
    const s = this.splats[i];
    s.position.x = (x - this.center.x) / this.worldSize + 0.5;
    s.position.y = (z - this.center.y) / this.worldSize + 0.5;
    s.scale.set(widthM / this.worldSize, lengthM / this.worldSize, 1);
    s.rotation.z = yaw;
    s.material.opacity = Math.min(alpha, 0.85);
    return i + 1;
  }

  update(renderer, dt, boat) {
    const nx = Math.round(boat.pos.x / this.texel) * this.texel;
    const nz = Math.round(boat.pos.z / this.texel) * this.texel;
    this.fadeMat.uniforms.uShift.value.set(
      (nx - this.center.x) / this.worldSize,
      (nz - this.center.y) / this.worldSize);
    this.center.set(nx, nz);
    this.fadeMat.uniforms.uPrev.value = this.rtA.texture;
    this.fadeMat.uniforms.uDecay.value = Math.exp(-dt * 0.14);
    this.fadeMat.uniforms.uSpread.value = Math.min(dt * 0.55, 1);

    let i = 0;
    const speed = boat.speedKn / 1.94384;
    const fx = boat.spec.effects;
    const wet = boat.wet <= 0.02 ? 0 : Math.min(1, 0.5 + boat.wet * 1.5);
    const stern = boat.worldPoint(fx.wakeOrigin, this._p);
    const sx = stern.x, sz = stern.z;
    this._right.set(1, 0, 0).applyQuaternion(boat.quat);
    this._fwd.set(0, 0, 1).applyQuaternion(boat.quat);
    const rx = this._right.x, rz = this._right.z;
    const yaw = Math.atan2(this._fwd.z, this._fwd.x) - Math.PI / 2;
    if (this._lastStern === null) this._lastStern = { x: sx, z: sz };
    const dx = sx - this._lastStern.x, dz = sz - this._lastStern.z;
    const dist = Math.hypot(dx, dz);
    const froude = speed / Math.sqrt(9.81 * boat.spec.length);
    const planing = froude > 0.55;
    if (speed > 2.5 && wet > 0.05 && dist < 30) {
      const spacing = THREE.MathUtils.clamp(boat.spec.beam * 0.28, 0.45, 1.05);
      const steps = Math.min(Math.ceil(dist / spacing), 14);
      for (let s = 1; s <= steps && i < SPLAT_MAX - 4; s++) {
        const t = s / steps;
        const px = this._lastStern.x + dx * t;
        const pz = this._lastStern.z + dz * t;
        if (planing) {
          const railWidth = Math.max(0.34, boat.spec.beam * 0.2);
          const trailLength = THREE.MathUtils.clamp(0.9 + speed * 0.13, 1.2, 3.8);
          const off = fx.wakeHalfWidth;
          i = this._place(i, px + rx * off, pz + rz * off,
            railWidth, trailLength, yaw, 0.2 * wet);
          i = this._place(i, px - rx * off, pz - rz * off,
            railWidth, trailLength, yaw, 0.2 * wet);
          i = this._place(i, px, pz, boat.spec.beam * 0.34,
            trailLength * 0.9, yaw, 0.13 * wet);
        } else {
          const jitter = boat.spec.beam * 0.14;
          i = this._place(i, px + (Math.random() - 0.5) * jitter,
            pz + (Math.random() - 0.5) * jitter,
            boat.spec.beam * 0.48, boat.spec.beam * 0.9,
            yaw, 0.09 * wet);
        }
      }
    }
    if (dist < 30) { this._lastStern.x = sx; this._lastStern.z = sz; }
    else { this._lastStern = { x: sx, z: sz }; }
    if (boat.slam > 1.0 && speed > 1.5 && i < SPLAT_MAX - 3) {
      const hit = boat.slamPoint;
      const localSide = this._local.copy(hit).sub(boat.pos).dot(this._right);
      const outward = (Math.abs(localSide) > boat.spec.beam * 0.08
        ? Math.sign(localSide) : (Math.random() < 0.5 ? -1 : 1))
        * boat.spec.beam * 0.36;
      i = this._place(i, hit.x, hit.z, boat.spec.beam * 0.72,
        boat.spec.beam * 0.95, yaw, 0.11);
      i = this._place(i, hit.x + rx * outward, hit.z + rz * outward,
        boat.spec.beam * 0.44, boat.spec.beam * 0.72, yaw, 0.09);
      i = this._place(i, hit.x - this._fwd.x * boat.spec.beam * 0.28,
        hit.z - this._fwd.z * boat.spec.beam * 0.28,
        boat.spec.beam * 0.4, boat.spec.beam * 0.68, yaw, 0.07);
    }
    for (; i < SPLAT_MAX; i++) this.splats[i].material.opacity = 0;

    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
    const t = this.rtA; this.rtA = this.rtB; this.rtB = t;
  }
}
