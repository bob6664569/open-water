import * as THREE from 'three';

// A coarse far mesh and a boat-following fine patch share uniforms. Their crossed
// skirts hide overlap z-fighting while preserving detailed near-field displacement.
const FAR_SIZE = 2200;
const FAR_SEGS = 768;
const PATCH_SIZE = 92;
const PATCH_SEGS = 320;
const FAR_VTX_WAVES = 10;

const NOISE_GLSL = /* glsl */`
  float ob_hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float ob_vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(ob_hash(i), ob_hash(i + vec2(1, 0)), u.x),
               mix(ob_hash(i + vec2(0, 1)), ob_hash(i + vec2(1, 1)), u.x), u.y);
  }
  float ob_fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * ob_vnoise(p); p = p * 2.13 + 17.0; a *= 0.5; }
    return v;
  }
`;

function makeWaterNormalTexture(size = 1024) {
  const lat = (n, seed) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < n * n; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
      return at(xi, yi) * (1 - ux) * (1 - uy) + at(xi + 1, yi) * ux * (1 - uy)
           + at(xi, yi + 1) * (1 - ux) * uy + at(xi + 1, yi + 1) * ux * uy;
    };
  };
  const n8 = lat(8, 12345), n16 = lat(16, 67891);
  const n32 = lat(32, 24680), n64 = lat(64, 13579);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = 0.45 * n8(u * 8, v * 8)
                      + 0.28 * n16(u * 16, v * 16)
                      + 0.17 * n32(u * 32, v * 32)
                      + 0.1 * n64(u * 64, v * 64);
    }
  }
  const data = new Uint8Array(size * size * 4);
  const S = 5.5 * (size / 256);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) * S;
      const dy = (h[yp * size + x] - h[ym * size + x]) * S;
      const il = 1 / Math.hypot(dx, dy, 1);
      const i4 = (y * size + x) * 4;
      data[i4] = (-dx * il * 0.5 + 0.5) * 255;
      data[i4 + 1] = (-dy * il * 0.5 + 0.5) * 255;
      data[i4 + 2] = (il * 0.5 + 0.5) * 255;
      data[i4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

function makeEmptyTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}

function makeFoamLaceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,150,150)';
  ctx.fillRect(0, 0, 256, 256);
  let s = 424242;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const blob = (x, y, r, col) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, 7); ctx.fill();
      }
    }
  };
  for (let i = 0; i < 130; i++) {
    blob(rnd() * 256, rnd() * 256, 4 + rnd() * 13, 'rgba(35,35,35,0.55)');
  }
  for (let i = 0; i < 190; i++) {
    blob(rnd() * 256, rnd() * 256, 1.5 + rnd() * 4.5, 'rgba(255,255,255,0.75)');
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class Ocean {
  constructor(waveField, quality = {}) {
    this.waveField = waveField;
    const u = waveField.uniformData();

    this.uniforms = {
      uTime: { value: 0 },
      uSeaState: { value: 1 },
      uWaveDirs: { value: u.dirs },
      uWaveAmps: { value: u.amps },
      uSteepSum: { value: waveField.steepnessSum() },
      uNormalTex: { value: makeWaterNormalTexture() },
      uBoat: { value: new THREE.Vector4(0, 0, 0, 1) },
      uBoatSpeed: { value: 0 },
      uBoatFroude: { value: 0 },
      uBoatWet: { value: 1 },
      uBoatSize: { value: new THREE.Vector2(6.5, 2.35) },
      uBoatY: { value: 0 },
      uPatchCenter: { value: new THREE.Vector2() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uReflMap: { value: makeEmptyTexture() },
      uReflMatrix: { value: new THREE.Matrix4() },
      uRefrMap: { value: makeEmptyTexture() },
      uRefrDepth: { value: makeEmptyTexture() },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 4000 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFoamTex: { value: makeFoamLaceTexture() },
      uFoamTrail: { value: makeEmptyTexture() },
      uTrailCenter: { value: new THREE.Vector2() },
      uTrailSize: { value: 150 },
      uNavCount: { value: 0 },
      uNav: {
        value: [new THREE.Vector4(), new THREE.Vector4(),
                new THREE.Vector4(), new THREE.Vector4()],
      },
      uNavCol: {
        value: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0),
                new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)],
      },
    };
    this._waveCount = u.count;

    const farSegments = quality.oceanFarSegments || FAR_SEGS;
    const patchSegments = quality.oceanPatchSegments || PATCH_SEGS;
    const farGeo = this._makeGeometry(FAR_SIZE, farSegments);
    const patchGeo = this._makeGeometry(PATCH_SIZE, patchSegments);

    this.mesh = new THREE.Mesh(farGeo, this._makeMaterial(false));
    this.patch = new THREE.Mesh(patchGeo, this._makeMaterial(true));
    for (const m of [this.mesh, this.patch]) {
      m.renderOrder = 2;
      m.frustumCulled = false;
      m.receiveShadow = true;
    }

    this.farSegments = farSegments;
    this.patchSegments = patchSegments;
    this.farCell = FAR_SIZE / farSegments;
    this.patchCell = PATCH_SIZE / patchSegments;
  }

  _makeGeometry(size, segments) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  setPerformanceBudget({ oceanFarSegments, oceanPatchSegments } = {}) {
    if (!oceanFarSegments || !oceanPatchSegments) return;
    if (oceanFarSegments === this.farSegments
        && oceanPatchSegments === this.patchSegments) return;
    const oldFar = this.mesh.geometry;
    const oldPatch = this.patch.geometry;
    this.mesh.geometry = this._makeGeometry(FAR_SIZE, oceanFarSegments);
    this.patch.geometry = this._makeGeometry(PATCH_SIZE, oceanPatchSegments);
    oldFar.dispose();
    oldPatch.dispose();
    this.farSegments = oceanFarSegments;
    this.patchSegments = oceanPatchSegments;
    this.farCell = FAR_SIZE / oceanFarSegments;
    this.patchCell = PATCH_SIZE / oceanPatchSegments;
  }

  _makeMaterial(isPatch) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x07293f),
      roughness: 0.15,
      metalness: 0.0,
      ior: 1.33,
      envMapIntensity: 0.5,
    });

    mat.defines = {
      WAVE_COUNT: this._waveCount,
      WAVE_VTX: isPatch ? this._waveCount
                        : Math.min(FAR_VTX_WAVES, this._waveCount),
      WAVE_NRM: 2,
      IS_PATCH: isPatch ? 1 : 0,
      NAV_MAX: 4,
    };

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform float uTime;
          uniform float uSeaState;
          uniform vec4 uWaveDirs[WAVE_COUNT];
          uniform vec3 uWaveAmps[WAVE_COUNT];
          uniform vec4 uBoat;
          uniform float uBoatSpeed;
          uniform float uBoatFroude;
          uniform float uBoatWet;
          uniform vec2 uBoatSize;
          uniform vec2 uPatchCenter;
          uniform mat4 uReflMatrix;
          varying vec3 vOWorldPos;
          varying vec4 vReflCoord;
          varying float vFoam;
          varying float vElev;
          ${NOISE_GLSL}
        `)
        .replace('#include <beginnormal_vertex>', /* glsl */`

          vec2 gXZ = (modelMatrix * vec4(position, 1.0)).xz;
          vec3 gDisp = vec3(0.0);
          vec3 gN = vec3(0.0, 1.0, 0.0);
          float gSteep = 0.0;
          for (int i = 0; i < WAVE_VTX; i++) {
            vec4 d = uWaveDirs[i];
            vec3 aq = uWaveAmps[i];
            float A = aq.x;
            float phi = d.z * dot(d.xy, gXZ) + aq.z;
            float c = cos(phi), s = sin(phi);
            float qa = aq.y * A;
            gDisp += vec3(qa * d.x * c, A * s, qa * d.y * c);
            float ka = d.z * A;
            if (i < WAVE_NRM) {
              gN.x -= d.x * ka * c;
              gN.z -= d.y * ka * c;
              gN.y -= aq.y * ka * s;
            }
            gSteep += aq.y * ka * max(s, 0.0);
          }

          {
            vec2 rel = gXZ - uBoat.xy;
            float along = dot(rel, uBoat.zw);
            float lat = dot(rel, vec2(-uBoat.w, uBoat.z));
            float hullL = max(uBoatSize.x, 1.0);
            float hullB = max(uBoatSize.y, 0.6);

            // Remove hull displacement completely while airborne.
            float contact = smoothstep(0.0, 0.04, uBoatWet);
            float spf = clamp((uBoatFroude - 0.12) / 0.85, 0.0, 1.3)
                        * mix(0.25, 1.0, uBoatWet) * contact;
            float wetF = mix(0.3, 1.0, uBoatWet) * contact;

            float hull = -(0.025 * hullL + 0.055 * hullB * spf) * wetF
              * exp(-(pow(along / (0.42 * hullL), 2.0)
                    + pow(lat / (0.48 * hullB), 2.0)));

            float bowSide = (0.025 * hullB + 0.11 * hullB * spf) * wetF
              * exp(-(pow((along - 0.36 * hullL) / (0.18 * hullL), 2.0)
                      + pow((abs(lat) - 0.48 * hullB) / (0.3 * hullB), 2.0)));
            float behind = -(along + 0.43 * hullL);
            float wk = 0.0;
            if (behind > 0.0 && uBoatSpeed > 1.0) {

              float washHalf = 0.34 * hullB + behind * 0.11;
              float washW = exp(-pow(lat / washHalf, 2.0)) * exp(-behind / 15.0);
              wk -= 0.04 * hullB * spf * washW * exp(-behind * 0.2);
              float turb = ob_vnoise(vec2(behind * 0.7 - uTime * 2.6, lat * 1.1))
                           - 0.5;
              wk += turb * 0.035 * hullB * spf * washW;

              float grow = smoothstep(1.0, 7.0, behind);
              float wakeSlope = mix(0.34, 0.2, smoothstep(0.5, 1.5, uBoatFroude));
              float arm = abs(abs(lat) - 0.42 * hullB - behind * wakeSlope);
              float amp = 0.09 * hullB * spf * grow
                        * exp(-behind / (2.2 * hullL + 8.0 * spf));
              wk += amp * exp(-pow(arm / max(0.32 * hullB, 0.4), 2.0))
                    * (0.65 + 0.35 * sin(behind * 0.8 - arm));
              gSteep += washW * spf * 0.105 * exp(-behind / (1.6 * hullL))
                      + amp * exp(-pow(arm / max(0.32 * hullB, 0.4), 2.0)) * 0.03;
            }

            float ring = exp(-pow((abs(lat) - 0.46 * hullB)
                                   / max(0.18 * hullB, 0.22), 2.0))
                       * (1.0 - smoothstep(0.4 * hullL, 0.54 * hullL,
                                           abs(along)));
            gSteep += ring * (0.008 + 0.035 * spf) * wetF;
            gDisp.y += hull + bowSide + wk;
          }

          {
            float pd = distance(gXZ, uPatchCenter);
            #if IS_PATCH == 1
              gDisp.y -= smoothstep(40.0, 44.5, pd) * 2.5;
            #else
              gDisp.y -= (1.0 - smoothstep(34.0, 40.0, pd)) * 2.5;
            #endif
          }

          vFoam = gSteep;
          vElev = gDisp.y;
          vOWorldPos = vec3(gXZ.x + gDisp.x, gDisp.y, gXZ.y + gDisp.z);
          vReflCoord = uReflMatrix * vec4(vOWorldPos, 1.0);

          float gVd = distance(cameraPosition, vOWorldPos);
          gN.xz *= 1.0 - 0.45 * smoothstep(80.0, 500.0, gVd);
          vec3 objectNormal = normalize(gN);
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          vec3 transformed = position + gDisp;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform float uTime;
          uniform float uSeaState;
          uniform vec4 uWaveDirs[WAVE_COUNT];
          uniform vec3 uWaveAmps[WAVE_COUNT];
          uniform float uSteepSum;
          uniform sampler2D uNormalTex;
          uniform vec3 uSunDir;
          uniform sampler2D uReflMap;
          uniform sampler2D uRefrMap;
          uniform sampler2D uRefrDepth;
          uniform float uCameraNear;
          uniform float uCameraFar;
          uniform vec2 uResolution;
          uniform sampler2D uFoamTex;
          uniform sampler2D uFoamTrail;
          uniform vec2 uTrailCenter;
          uniform float uTrailSize;
          uniform vec4 uBoat;
          uniform float uBoatSpeed;
          uniform vec2 uBoatSize;
          uniform float uBoatY;
          uniform int uNavCount;
          uniform vec4 uNav[NAV_MAX];
          uniform vec3 uNavCol[NAV_MAX];
          varying vec4 vReflCoord;
          varying vec3 vOWorldPos;
          varying float vFoam;
          varying float vElev;
          ${NOISE_GLSL}
          float ob_linearDepth(float depth) {
            float z = depth * 2.0 - 1.0;
            return (2.0 * uCameraNear * uCameraFar)
                 / (uCameraFar + uCameraNear
                    - z * (uCameraFar - uCameraNear));
          }
        `)
        .replace('#include <normal_fragment_begin>', /* glsl */`
          #include <normal_fragment_begin>
          {
            float camDist = length(vOWorldPos - cameraPosition);
            float rippleFade = 1.0 - smoothstep(60.0, 320.0, camDist);
            vec3 rN = vec3(0.0);

            for (int i = WAVE_NRM; i < WAVE_COUNT; i++) {
              vec4 d = uWaveDirs[i];
              vec3 aq = uWaveAmps[i];
              float A = aq.x;
              float phi = d.z * dot(d.xy, vOWorldPos.xz) + aq.z;
              float ka = d.z * A * cos(phi);
              rN.x -= d.x * ka;
              rN.z -= d.y * ka;
            }

            vec2 s1 = texture2D(uNormalTex, vOWorldPos.xz * 0.037
                        + vec2(uTime * 0.011, uTime * 0.006)).xy * 2.0 - 1.0;
            vec2 rot = vec2(vOWorldPos.z, -vOWorldPos.x);
            vec2 s2 = texture2D(uNormalTex, rot * 0.145
                        - vec2(uTime * 0.02, -uTime * 0.012)).xy * 2.0 - 1.0;
            float rippleStrength = clamp(0.46 + uSeaState * 0.54, 0.42, 1.45);
            vec2 sTex = (s1 * 0.20 + s2.yx * vec2(-0.18, 0.18))
                      * rippleStrength;
            normal = normalize(normal + rN * rippleFade
                               + vec3(sTex.x, 0.0, sTex.y));
          }
        `)
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          {

            // GLSL smoothstep takes x as its final argument.
            float paradise = 1.0 - smoothstep(0.3, 0.6, uSeaState);
            float storm    = smoothstep(0.6, 3.45, uSeaState);
            vec3 calmWater  = vec3(0.03, 0.34, 0.44);
            vec3 oceanWater = vec3(0.02, 0.22, 0.40);
            vec3 stormWater = vec3(0.05, 0.12, 0.16);
            vec3 water = mix(oceanWater, calmWater, paradise);
            water = mix(water, stormWater, storm);
            diffuseColor.rgb = water;

            float cDist = length(vOWorldPos - cameraPosition);
            float crest = smoothstep(0.15, 1.6, vElev)
              * (1.0 - smoothstep(150.0, 400.0, cDist));

            vec3 crestTint = mix(vec3(0.06, 0.33, 0.42), vec3(0.10, 0.52, 0.55), paradise);
            crestTint = mix(crestTint, vec3(0.20, 0.26, 0.29), storm);
            diffuseColor.rgb = mix(diffuseColor.rgb, crestTint,
                                   crest * mix(0.42, 0.22, storm));

            float n = ob_fbm(vOWorldPos.xz * 0.45 + vec2(uTime * 0.15, -uTime * 0.1));
            float nFoam = vFoam / uSteepSum;
            float seaFoamGain = mix(0.58, 1.38,
              smoothstep(0.3, 1.8, uSeaState));
            float baseFoam = smoothstep(0.46, 0.82,
              nFoam * (0.35 + 0.65 * n) * seaFoamGain);
            baseFoam *= 1.0 - smoothstep(80.0, 300.0, cDist);

            vec2 tUV = (vOWorldPos.xz - uTrailCenter) / uTrailSize + 0.5;
            float edge = 1.0 - smoothstep(0.42, 0.5,
              max(abs(tUV.x - 0.5), abs(tUV.y - 0.5)));
            float trail = texture2D(uFoamTrail, tUV).r * edge;

            float lace = texture2D(uFoamTex, vOWorldPos.xz * 0.31).r * 0.62
                       + texture2D(uFoamTex, vOWorldPos.xz * 0.085
                                   + vec2(uTime * 0.004)).r * 0.38;
            float fCrest = smoothstep(0.16, 0.72, baseFoam * (0.25 + 1.05 * lace));

            vec2 relT = vOWorldPos.xz - uBoat.xy;
            vec2 bfT = vec2(dot(relT, uBoat.zw),
                            dot(relT, vec2(-uBoat.w, uBoat.z)));
            float laceA = texture2D(uFoamTex,
              vec2(bfT.x * 0.05, bfT.y * 0.27)).r * 0.6
                        + texture2D(uFoamTex,
              vec2(bfT.x * 0.016, bfT.y * 0.1) + vec2(uTime * 0.003)).r * 0.4;

            float laceSlow = texture2D(uFoamTex, vOWorldPos.xz * 0.55).r * 0.6
                           + texture2D(uFoamTex, vOWorldPos.xz * 0.17
                                       + vec2(uTime * 0.006)).r * 0.4;
            float laceMix = mix(laceSlow, laceA,
                                smoothstep(3.5, 8.0, uBoatSpeed));
            float fTrail = smoothstep(0.02, 0.34,
              trail * (0.12 + 1.05 * laceMix)) * 0.72;

            float solid = smoothstep(0.8, 1.4, nFoam);
            vFoamOut = clamp(max(max(fCrest, fTrail), solid), 0.0, 1.0);

            {
              vec2 relC   = vOWorldPos.xz - uBoat.xy;
              float alongC = dot(relC, uBoat.zw);
              float latC   = dot(relC, vec2(-uBoat.w, uBoat.z));
              float halfL = max(uBoatSize.x * 0.5, 1.0);
              float halfB = max(uBoatSize.y * 0.5, 0.4);

              float fp = length(vec2(alongC / halfL, latC / halfB));

              float rise = vOWorldPos.y - uBoatY;

              float w1 = ob_fbm(vOWorldPos.xz * 2.3 + vec2(uTime * 0.9, uTime * 0.5));
              float w2 = ob_fbm(vOWorldPos.xz * 5.1 - vec2(uTime * 0.6, uTime * 1.1));
              float ww = w1 * 0.6 + w2 * 0.4;

              float rimC = exp(-pow((fp - 1.0) / 0.14, 2.0))
                         * (1.0 - smoothstep(0.5, 1.6, abs(rise)));

              float over = smoothstep(0.03, 0.6, rise)
                         * (1.0 - smoothstep(0.85, 1.25, fp));
              float contact = max(rimC * 0.7, over);
              contact *= smoothstep(0.30, 0.72, ww);
              contact = clamp(contact, 0.0, 0.82);
              vFoamOut = max(vFoamOut, contact);
            }
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.97), vFoamOut);
          }
        `)
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          #include <roughnessmap_fragment>
          {
            float camDist = length(vOWorldPos - cameraPosition);
            roughnessFactor = mix(roughnessFactor, 0.45, vFoamOut);

            float rn = ob_vnoise(vOWorldPos.xz * 0.11 + vec2(uTime * 0.05, 0.0)) * 0.65
                     + ob_vnoise(vOWorldPos.xz * 0.031) * 0.35;
            roughnessFactor = mix(roughnessFactor, 0.2 + 0.3 * rn,
                                  smoothstep(40.0, 300.0, camDist));
          }
        `)
        .replace('#include <opaque_fragment>', /* glsl */`
          #include <opaque_fragment>
          {

            vec2 sUV = gl_FragCoord.xy / uResolution;
            vec2 refrUV = sUV + normal.xz * 0.045;
            vec4 refr = texture2D(uRefrMap, refrUV);
            float boatDepth = ob_linearDepth(texture2D(uRefrDepth, refrUV).r);
            float waterDepth = ob_linearDepth(gl_FragCoord.z);
            float thickness = clamp(boatDepth - waterDepth, 0.0, 10.0);
            vec3 transmittance = exp(-vec3(0.24, 0.085, 0.045) * thickness);
            vec3 refracted = refr.rgb * transmittance
                           + diffuseColor.rgb * (1.0 - transmittance) * 0.45;
            gl_FragColor.rgb = mix(gl_FragColor.rgb,
              refracted * vec3(0.72, 0.9, 0.94) + gl_FragColor.rgb * 0.25,
              refr.a * 0.55 * (1.0 - vFoamOut));

            vec3 reflViewDir = normalize(cameraPosition - vOWorldPos);
            // Projective reflections become invalid overhead and Fresnel is minimal there.
            float reflFade = 1.0 - smoothstep(0.55, 0.9, reflViewDir.y);
            float roughRefl = smoothstep(0.6, 1.6, uSeaState);
            float stormRefl = smoothstep(1.6, 3.47, uSeaState);
            float seaReflStrength = mix(1.0, 0.75, roughRefl);
            seaReflStrength = mix(seaReflStrength, 0.45, stormRefl);
            vec2 rUV = vReflCoord.xy / vReflCoord.w + normal.xz * 0.18;
            vec4 refl = texture2D(uReflMap, rUV);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, refl.rgb,
                                   refl.a * 0.32 * seaReflStrength
                                   * reflFade * (1.0 - vFoamOut));
          }
          {
            vec3 viewV = vOWorldPos - cameraPosition;
            float camD = length(viewV);
            float far = smoothstep(18.0, 140.0, camD);

            float facing = pow(clamp(dot(normalize(viewV.xz),
                                         normalize(uSunDir.xz)), 0.0, 1.0), 2.0);
            float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
            float k = 1.0 / (1.0 + max(lum - 0.5, 0.0)
                                   * (0.6 + 0.9 * far) * (1.0 + 1.3 * facing));
            gl_FragColor.rgb *= mix(1.0, k, 0.8);
            gl_FragColor.rgb = mix(gl_FragColor.rgb,
                                   gl_FragColor.rgb * vec3(0.88, 0.94, 1.0),
                                   far * 0.3);
          }

          vec2 navLat = vec2(-uBoat.w, uBoat.z);
          for (int i = 0; i < NAV_MAX; i++) {
            if (i >= uNavCount) break;
            vec4 nl = uNav[i];
            float d = length(vOWorldPos.xz - nl.xy);
            float g = nl.w * exp(-(d * d) / max(nl.z * nl.z, 0.25));

            float latF = dot(vOWorldPos.xz - uBoat.xy, navLat);
            float latL = dot(nl.xy - uBoat.xy, navLat);
            g *= smoothstep(0.0, 1.6, latF * sign(latL));
            gl_FragColor.rgb += uNavCol[i] * g;
          }
        `)
        .replace('void main() {', /* glsl */`
          float vFoamOut = 0.0;
          void main() {
        `);
    };

    return mat;
  }

  _fwd = new THREE.Vector3();
  update(dt, focusX, focusZ, boat) {
    this.uniforms.uTime.value = this.waveField.time;
    this.uniforms.uSeaState.value = this.waveField.seaState;
    this.uniforms.uSteepSum.value = Math.max(this.waveField.steepnessSum(), 0.001);
    const fc = this.farCell;
    this.mesh.position.set(Math.round(focusX / fc) * fc, 0,
                           Math.round(focusZ / fc) * fc);
    if (boat) {
      const pc = this.patchCell;
      const px = Math.round(boat.pos.x / pc) * pc;
      const pz = Math.round(boat.pos.z / pc) * pc;
      this.patch.position.set(px, 0, pz);
      this.uniforms.uPatchCenter.value.set(px, pz);
      const f = this._fwd.set(0, 0, 1).applyQuaternion(boat.quat);
      const fl = Math.hypot(f.x, f.z) || 1;
      this.uniforms.uBoat.value.set(boat.pos.x, boat.pos.z, f.x / fl, f.z / fl);
      const waterSpeed = boat.speedKn / 1.94384;
      this.uniforms.uBoatSpeed.value = waterSpeed;
      this.uniforms.uBoatFroude.value = waterSpeed
        / Math.sqrt(9.81 * boat.spec.length);
      this.uniforms.uBoatWet.value = boat.wet;
      this.uniforms.uBoatSize.value.set(boat.spec.length, boat.spec.beam);
      this.uniforms.uBoatY.value = boat.pos.y;
    }
    const navLights = boat && boat.visualRig && boat.visualRig.getWaterLights
      ? boat.visualRig.getWaterLights() : null;
    const navUniforms = this.uniforms.uNav.value;
    const navColors = this.uniforms.uNavCol.value;
    const count = navLights ? Math.min(navLights.length, navUniforms.length) : 0;
    for (let i = 0; i < count; i++) {
      const l = navLights[i];
      navUniforms[i].set(l.x, l.z, l.radius, l.intensity);
      navColors[i].copy(l.color);
    }
    this.uniforms.uNavCount.value = count;
  }
}
