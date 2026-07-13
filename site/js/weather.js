import * as THREE from 'three';

const DROP_COUNT = 5200;

export class WeatherEffects {
  constructor(scene, camera, waveField, audio) {
    this.scene = scene;
    this.camera = camera;
    this.waveField = waveField;
    this.audio = audio;
    this.storm = 0;
    this.flashTime = 0;
    this.flashDuration = 0;
    this.nextFlash = 5 + Math.random() * 5;
    this.activeDropCount = DROP_COUNT;

    const origins = new Float32Array(DROP_COUNT * 3);
    const motion = new Float32Array(DROP_COUNT * 2);
    const seeds = new Float32Array(DROP_COUNT);
    for (let i = 0; i < DROP_COUNT; i++) {
      const originOffset = i * 3;
      origins[originOffset] = (Math.random() - 0.5) * 120;
      origins[originOffset + 1] = (Math.random() - 0.5) * 58;
      origins[originOffset + 2] = (Math.random() - 0.5) * 120;
      motion[i * 2] = 27 + Math.random() * 20;
      motion[i * 2 + 1] = 0.18 + Math.random() * 0.48;
      seeds[i] = Math.random();
    }
    this.rainGeometry = new THREE.InstancedBufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, 1, 0]), 3,
    ));
    this.rainGeometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(
      origins, 3,
    ));
    this.rainGeometry.setAttribute('aMotion', new THREE.InstancedBufferAttribute(
      motion, 2,
    ));
    this.rainGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(
      seeds, 1,
    ));
    this.rainGeometry.instanceCount = DROP_COUNT;
    this.rainGeometry.setDrawRange(0, 2);
    this.rainUniforms = {
      uRainTime: { value: 0 },
      uWindOffset: { value: 0 },
    };
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0x9eafba,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: true,
    });
    this.rainMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.rainUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          attribute vec3 aOrigin;
          attribute vec2 aMotion;
          attribute float aSeed;
          uniform float uRainTime;
          uniform float uWindOffset;

          float rainHash(vec2 value) {
            return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453);
          }
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          float rawY = aOrigin.y - aMotion.x * uRainTime;
          float cycle = max(0.0, floor((29.0 - rawY) / 58.0));
          float recycled = step(0.5, cycle);
          float baseX = mix(
            aOrigin.x, rainHash(vec2(aSeed, cycle)) * 120.0 - 60.0, recycled
          );
          float baseZ = mix(
            aOrigin.z, rainHash(vec2(aSeed + 17.31, cycle)) * 120.0 - 60.0,
            recycled
          );
          float endpoint = position.y;
          float x = mod(baseX + uWindOffset + 60.0, 120.0) - 60.0;
          vec3 transformed = vec3(
            x - endpoint * aMotion.y * 0.42,
            rawY + cycle * 58.0 + endpoint * aMotion.y,
            baseZ
          );
        `);
    };
    this.rainMaterial.customProgramCacheKey = () => 'gpu-rain-v1';
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    scene.add(this.rain);

    // Native fog does not affect the HDR background, so this belt joins sea and sky.
    this.horizonMistMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uStorm: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x71818a) },
      },
      vertexShader: /* glsl */`
        varying float vHeight;
        varying vec2 vLocalXZ;
        void main() {
          vHeight = position.y;
          vLocalXZ = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uStorm;
        uniform float uTime;
        uniform vec3 uColor;
        varying float vHeight;
        varying vec2 vLocalXZ;
        void main() {
          float band = exp(-pow(abs(vHeight - 3.0) / 39.0, 1.35));
          float rainNoise = sin(vLocalXZ.x * 0.075 + uTime * 0.18)
                          * sin(vLocalXZ.y * 0.052 - uTime * 0.11);
          float core = exp(-pow(abs(vHeight - 3.0) / 13.0, 1.7));
          float alpha = uStorm * band
                      * (0.57 + core * 0.25 + rainNoise * 0.035);
          gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.86));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.horizonMist = new THREE.Mesh(
      new THREE.CylinderGeometry(210, 210, 190, 96, 18, true),
      this.horizonMistMaterial,
    );
    this.horizonMist.renderOrder = 1;
    this.horizonMist.frustumCulled = false;
    this.horizonMist.visible = false;
    scene.add(this.horizonMist);

    this.boltCanvas = document.createElement('canvas');
    this.boltCanvas.width = 256;
    this.boltCanvas.height = 512;
    this.boltTexture = new THREE.CanvasTexture(this.boltCanvas);
    this.boltMaterial = new THREE.SpriteMaterial({
      map: this.boltTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.bolt = new THREE.Sprite(this.boltMaterial);
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 9;
    scene.add(this.bolt);

    this.light = new THREE.PointLight(0xc9e6ff, 0, 260, 2);
    scene.add(this.light);
    this.rainVeil = document.createElement('div');
    Object.assign(this.rainVeil.style, {
      position: 'fixed', inset: '0', zIndex: '3', pointerEvents: 'none',
      opacity: '0',
      background: 'radial-gradient(ellipse at 50% 42%, rgba(122,139,149,.02), rgba(105,122,133,.16))',
      backdropFilter: 'blur(1.15px) saturate(.72)',
      webkitBackdropFilter: 'blur(1.15px) saturate(.72)',
    });
    document.body.appendChild(this.rainVeil);
    this.skyFlash = document.createElement('div');
    Object.assign(this.skyFlash.style, {
      position: 'fixed', inset: '0 0 42% 0', zIndex: '7', pointerEvents: 'none',
      opacity: '0', background: 'radial-gradient(ellipse at 55% 15%, rgba(220,238,255,.75), rgba(130,165,190,.2) 40%, transparent 76%)',
      mixBlendMode: 'screen',
    });
    document.body.appendChild(this.skyFlash);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  _triggerLightning() {
    this.flashTime = 0;
    this.flashDuration = 0.42 + Math.random() * 0.18;
    this.nextFlash = 5 + Math.random() * 9;

    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 0.01) this._forward.set(0, 0, 1);
    this._forward.normalize();
    this._right.set(this._forward.z, 0, -this._forward.x);
    const distanceRoll = Math.random();
    const acousticDistance = distanceRoll < 0.22
      ? 140 + Math.random() * 260
      : distanceRoll < 0.7
        ? 420 + Math.random() * 980
        : 1500 + Math.random() * 2300;
    const distance = 95 + Math.random() * 115;
    const side = (Math.random() - 0.5) * 130;
    const base = this.camera.position.clone()
      .addScaledVector(this._forward, distance)
      .addScaledVector(this._right, side);
    const ctx = this.boltCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 512);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trunk = [{ x: 128, y: 0 }];
    let x = 128;
    for (let i = 1; i <= 20; i++) {
      x = THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 34, 48, 208);
      trunk.push({ x, y: i * 25.6 });
    }
    const paths = [{ points: trunk, strength: 1 }];
    const branchCount = 7 + Math.floor(Math.random() * 6);
    for (let b = 0; b < branchCount; b++) {
      const startIndex = 3 + Math.floor(Math.random() * 15);
      const start = trunk[startIndex];
      const direction = Math.random() < 0.5 ? -1 : 1;
      const branch = [{ ...start }];
      let bx = start.x, by = start.y;
      const segments = 3 + Math.floor(Math.random() * 5);
      for (let j = 0; j < segments; j++) {
        bx += direction * (8 + Math.random() * 18) + (Math.random() - 0.5) * 9;
        by += 12 + Math.random() * 17;
        branch.push({ x: THREE.MathUtils.clamp(bx, 8, 248), y: Math.min(by, 510) });
      }
      const strength = 0.42 + Math.random() * 0.25;
      paths.push({ points: branch, strength });
      if (segments > 4 && Math.random() < 0.65) {
        const forkStart = branch[2 + Math.floor(Math.random() * (segments - 2))];
        const fork = [{ ...forkStart }];
        let fx = forkStart.x, fy = forkStart.y;
        for (let j = 0; j < 3; j++) {
          fx -= direction * (7 + Math.random() * 12);
          fy += 10 + Math.random() * 13;
          fork.push({ x: THREE.MathUtils.clamp(fx, 8, 248), y: Math.min(fy, 510) });
        }
        paths.push({ points: fork, strength: strength * 0.62 });
      }
    }
    const drawPaths = (baseWidth, color, blur = 0) => {
      for (const path of paths) {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        path.points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
        ctx.lineWidth = baseWidth * path.strength;
        ctx.strokeStyle = color;
        ctx.shadowColor = '#b9e5ff'; ctx.shadowBlur = blur; ctx.stroke();
      }
      ctx.shadowBlur = 0;
    };
    drawPaths(5.2, 'rgba(130,195,235,.2)', 13);
    drawPaths(1.75, 'rgba(220,244,255,.9)', 3);
    drawPaths(0.65, '#ffffff');
    this.boltTexture.needsUpdate = true;
    this.bolt.position.copy(base).add(new THREE.Vector3(0, 40, 0));
    this.bolt.scale.set(42, 96, 1);
    this.light.position.set(base.x, 42, base.z);
    this.audio?.thunder({
      distance: acousticDistance,
      intensity: 0.78 + Math.random() * 0.22,
      position: this.light.position,
    });
  }

  setPerformanceBudget({ rainScale = 1 } = {}) {
    this.activeDropCount = Math.max(400, Math.floor(DROP_COUNT * rainScale));
    this.rainGeometry.instanceCount = this.activeDropCount;
  }

  update(dt) {
    const height = this.waveField.significantWaveHeight;
    const targetStorm = THREE.MathUtils.smoothstep(height, 3.0, 5.2);
    this.storm = THREE.MathUtils.lerp(
      this.storm, targetStorm, 1 - Math.exp(-dt * 1.25),
    );

    this.rain.visible = this.storm > 0.015;
    this.rainMaterial.opacity = this.storm * 0.14;
    this.rainVeil.style.opacity = String(this.storm * 0.58);
    this.rain.position.copy(this.camera.position);
    this.horizonMist.visible = this.storm > 0.015;
    this.horizonMist.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.horizonMistMaterial.uniforms.uStorm.value = this.storm;
    this.horizonMistMaterial.uniforms.uTime.value += dt;
    if (this.storm <= 0.015) {
      this.light.intensity = 0;
      this.skyFlash.style.opacity = '0';
      this.boltMaterial.opacity = 0;
      return;
    }
    const wind = 8 + this.storm * 13;
    this.rainUniforms.uRainTime.value += dt;
    this.rainUniforms.uWindOffset.value = (
      this.rainUniforms.uWindOffset.value + wind * dt
    ) % 120;

    if (this.storm > 0.72) {
      this.nextFlash -= dt * this.storm;
      if (this.nextFlash <= 0 && this.flashTime >= this.flashDuration) {
        this._triggerLightning();
      }
    }

    let flash = 0;
    if (this.flashTime < this.flashDuration) {
      this.flashTime += dt;
      const t = this.flashTime;
      flash = Math.max(
        Math.exp(-t * 24),
        t > 0.12 ? 0.62 * Math.exp(-(t - 0.12) * 32) : 0,
      ) * this.storm;
    }
    this.light.intensity = flash * 7;
    this.skyFlash.style.opacity = String(flash * 0.7);
    this.boltMaterial.opacity = flash > 0.08 ? Math.min(1, flash * 2.4) : 0;
  }
}
