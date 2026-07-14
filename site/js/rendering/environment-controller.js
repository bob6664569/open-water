import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SEA_PRESETS } from '../simulation/waves.js';

const SUN_START_OFFSET = THREE.MathUtils.degToRad(12);
const CLEAR_FOG = 0x9cbfd8;
const STORM_FOG = 0x4a5962;
const CLOUDINESS_BY_PRESET = {
  1: 0,
  2: 0.24,
  3: 0.62,
  4: 1,
};

export function cloudinessForWaveHeight(height) {
  if (height <= SEA_PRESETS[1].hs) return CLOUDINESS_BY_PRESET[1];
  for (let preset = 2; preset <= 4; preset++) {
    const previous = preset - 1;
    if (height > SEA_PRESETS[preset].hs) continue;
    const mix = THREE.MathUtils.smoothstep(
      height,
      SEA_PRESETS[previous].hs,
      SEA_PRESETS[preset].hs,
    );
    return THREE.MathUtils.lerp(
      CLOUDINESS_BY_PRESET[previous],
      CLOUDINESS_BY_PRESET[preset],
      mix,
    );
  }
  return 1;
}

export function analyzeHdrTexture(texture) {
  const { data, width, height } = texture.image;
  const channel = texture.type === THREE.HalfFloatType
    ? index => THREE.DataUtils.fromHalfFloat(data[index])
    : index => data[index];
  let bestLum = -1;
  let bestU = 0;
  let bestV = 0;
  let horizonR = 0;
  let horizonG = 0;
  let horizonB = 0;
  let horizonSamples = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;
      const r = channel(index);
      const g = channel(index + 1);
      const b = channel(index + 2);
      const luminance = r * 0.3 + g * 0.6 + b * 0.1;
      const v = 1 - y / height;
      if (luminance > bestLum) {
        bestLum = luminance;
        bestU = x / width;
        bestV = v;
      }
      if (v > 0.5 && v < 0.54) {
        horizonR += r;
        horizonG += g;
        horizonB += b;
        horizonSamples++;
      }
    }
  }

  const longitude = (bestU - 0.5) * Math.PI * 2;
  const latitude = (bestV - 0.5) * Math.PI;
  const sunDirection = new THREE.Vector3(
    Math.cos(longitude) * Math.cos(latitude),
    Math.sin(latitude),
    Math.sin(longitude) * Math.cos(latitude),
  );
  if (sunDirection.y < 0.05) sunDirection.y = 0.05;
  sunDirection.normalize();

  const fogColor = horizonSamples > 0
    ? new THREE.Color(
      horizonR / horizonSamples,
      horizonG / horizonSamples,
      horizonB / horizonSamples,
    )
    : new THREE.Color(CLEAR_FOG);
  fogColor.r /= 1 + fogColor.r;
  fogColor.g /= 1 + fogColor.g;
  fogColor.b /= 1 + fogColor.b;
  return { sunDirection, fogColor };
}

export class EnvironmentController {
  constructor({
    renderer,
    scene,
    waveField,
    isTouch = false,
    loaderFactory = () => new RGBELoader(),
    pmremFactory = activeRenderer => new THREE.PMREMGenerator(activeRenderer),
    sunSpriteFactory = null,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.waveField = waveField;
    this.isTouch = isTouch;
    this.loaderFactory = loaderFactory;
    this.pmremFactory = pmremFactory;
    this.sunSpriteFactory = sunSpriteFactory;
    this.clearFogColor = new THREE.Color(CLEAR_FOG);
    this.stormFogColor = new THREE.Color(STORM_FOG);
    this.atmosphereFogColor = new THREE.Color();
    this.clearSunColor = new THREE.Color(0xfff2dd);
    this.overcastSunColor = new THREE.Color(0xd9e4e9);
    this.stormSunColor = new THREE.Color(0xa9bfd0);
    this.sunTargetColor = new THREE.Color();
    this.sun = new THREE.Vector3(-0.4, 0.6, -0.7).normalize();
    this.sunSprite = null;
    this.ocean = null;
    this.cloudiness = waveField.preset === 1
      ? 0 : cloudinessForWaveHeight(waveField.significantWaveHeight);
    this.cloudOffset = new THREE.Vector2();
    this.cloudShadowScale = isTouch ? 0.55 : 0.82;
    this.cloudOctaves = isTouch ? 3 : 4;

    scene.fog = new THREE.Fog(CLEAR_FOG, 180, 640);
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
    this.sunLight.shadow.camera.left = -14;
    this.sunLight.shadow.camera.right = 14;
    this.sunLight.shadow.camera.top = 14;
    this.sunLight.shadow.camera.bottom = -14;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 160;
    this.sunLight.shadow.bias = -0.0004;
    scene.add(this.sunLight, this.sunLight.target);

    this.paradiseSkyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCalm: { value: 0 },
        uZenith: { value: new THREE.Color(0x48d9e4) },
        uHorizon: { value: new THREE.Color(0xffc59f) },
        uCloudiness: { value: this.cloudiness },
        uCloudOffset: { value: this.cloudOffset },
        uStorm: { value: 0 },
        uSunDir: { value: this.sun },
        uLightning: { value: 0 },
      },
      defines: { CLOUD_OCTAVES: this.cloudOctaves },
      vertexShader: /* glsl */`
        varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uCalm;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform float uCloudiness;
        uniform vec2 uCloudOffset;
        uniform float uStorm;
        uniform vec3 uSunDir;
        uniform float uLightning;
        varying vec3 vSkyDirection;

        float cloudHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float cloudNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
            mix(cloudHash(i + vec2(0.0, 1.0)),
                cloudHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float cloudFbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.54;
          for (int octave = 0; octave < CLOUD_OCTAVES; octave++) {
            value += amplitude * cloudNoise(p);
            p = mat2(1.62, 1.18, -1.18, 1.62) * p + 13.7;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec3 skyDirection = normalize(vSkyDirection);
          float sky = max(skyDirection.y, 0.0);
          float horizon = 1.0 - smoothstep(0.02, 0.42, abs(skyDirection.y));
          float zenith = smoothstep(0.08, 0.82, sky);
          vec3 tint = mix(uHorizon, uZenith, smoothstep(0.05, 0.72, sky));
          float paradiseAlpha = uCalm * (horizon * 0.13 + zenith * 0.075);

          float cloudAlpha = 0.0;
          vec3 cloudColor = vec3(1.0);
          if (uCloudiness > 0.001 && skyDirection.y > -0.015) {
            vec2 dome = skyDirection.xz / (0.3 + max(skyDirection.y, 0.0));
            vec2 cloudUv = dome * 1.04 + uCloudOffset;
            float broad = cloudNoise(cloudUv * 0.31 - vec2(7.3, 2.8));
            float density = cloudFbm(cloudUv) * mix(0.76, 1.12, broad);
            float threshold = mix(0.70, 0.48, uCloudiness);
            float cloud = smoothstep(
              threshold,
              threshold + mix(0.13, 0.09, uCloudiness),
              density
            );
            float cloudDepth = smoothstep(
              threshold + 0.025,
              threshold + 0.31,
              density
            );
            float skyGate = smoothstep(-0.015, 0.10, skyDirection.y);
            float sunFacing = pow(max(dot(skyDirection, uSunDir), 0.0), 7.0);
            float silverLining = smoothstep(0.03, 0.32, cloud)
                               * (1.0 - smoothstep(0.42, 0.96, cloud));
            vec3 fairCloud = mix(vec3(0.72, 0.78, 0.82), vec3(1.0, 0.97, 0.91),
                                 0.34 + sunFacing * 0.66);
            float stormDepth = clamp(cloudDepth * 0.82 + (1.0 - broad) * 0.18, 0.0, 1.0);
            vec3 stormCloud = mix(vec3(0.40, 0.47, 0.52), vec3(0.10, 0.14, 0.19),
                                  stormDepth);
            stormCloud += vec3(0.12, 0.16, 0.19)
                        * (sky * 0.36 + silverLining * sunFacing);
            cloudColor = mix(fairCloud, stormCloud, uStorm);
            cloudColor += silverLining * sunFacing * (1.0 - uStorm * 0.45) * 0.38;
            cloudColor = mix(cloudColor, vec3(0.68, 0.82, 0.98), uLightning * 0.82);
            cloudAlpha = cloud * skyGate * mix(0.44, 0.82, uCloudiness);
          }

          float alpha = cloudAlpha + paradiseAlpha * (1.0 - cloudAlpha);
          vec3 premultiplied = cloudColor * cloudAlpha
            + tint * paradiseAlpha * (1.0 - cloudAlpha);
          gl_FragColor = vec4(premultiplied / max(alpha, 0.001), alpha);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.paradiseSky = new THREE.Mesh(
      new THREE.SphereGeometry(3500, 32, 16),
      this.paradiseSkyMaterial,
    );
    this.paradiseSky.renderOrder = -1000;
    this.paradiseSky.frustumCulled = false;
    scene.add(this.paradiseSky);

    this.sunHolder = new THREE.Group();
    scene.add(this.sunHolder);
  }

  startYaw() {
    return Math.atan2(this.sun.x, this.sun.z) + SUN_START_OFFSET;
  }

  load({ ocean, boat, cameraController, onReady }) {
    this.ocean = ocean;
    this._syncOceanAtmosphere();
    const skyUrl = this.isTouch ? './assets/sky_clear_1k.hdr' : './assets/sky_clear_4k.hdr';
    this.loaderFactory()
      .setDataType(THREE.HalfFloatType)
      .load(skyUrl, texture => {
        this._applyTexture(texture, ocean, boat, cameraController);
        onReady();
      }, undefined, onReady);
  }

  updateAtmosphere(dt) {
    const { renderer, scene, waveField, sunLight } = this;
    const cloudTarget = waveField.preset === 1
      ? 0 : cloudinessForWaveHeight(waveField.significantWaveHeight);
    this.cloudiness = THREE.MathUtils.damp(
      this.cloudiness,
      cloudTarget,
      waveField.preset === 1 ? 2.4 : 0.9,
      dt,
    );
    const storm = THREE.MathUtils.smoothstep(this.cloudiness, 0.38, 1);
    const ease = 1 - Math.exp(-dt * 0.75);
    const windDirection = waveField.windDirection ?? 0;
    const cloudTravel = (waveField.windSpeed ?? 0) * dt * 0.0011;
    this.cloudOffset.x += Math.cos(windDirection) * cloudTravel;
    this.cloudOffset.y += Math.sin(windDirection) * cloudTravel;
    this.paradiseSkyMaterial.uniforms.uCloudiness.value = this.cloudiness;
    this.paradiseSkyMaterial.uniforms.uStorm.value = storm;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      renderer.toneMappingExposure,
      THREE.MathUtils.lerp(0.85, 0.48, Math.pow(this.cloudiness, 1.22)),
      ease,
    );
    if (scene.background) {
      scene.backgroundIntensity = THREE.MathUtils.lerp(
        scene.backgroundIntensity,
        THREE.MathUtils.lerp(1, 0.34, Math.pow(this.cloudiness, 1.18)),
        ease,
      );
    }
    if (scene.environment) {
      scene.environmentIntensity = THREE.MathUtils.lerp(
        scene.environmentIntensity ?? 1,
        THREE.MathUtils.lerp(1, 0.56, Math.pow(this.cloudiness, 1.08)),
        ease,
      );
    }
    sunLight.intensity = THREE.MathUtils.lerp(
      sunLight.intensity,
      THREE.MathUtils.lerp(2, 0.48, Math.pow(this.cloudiness, 1.12)),
      ease,
    );
    this.sunTargetColor.copy(this.clearSunColor)
      .lerp(this.overcastSunColor, this.cloudiness)
      .lerp(this.stormSunColor, storm * 0.72);
    sunLight.color.lerp(this.sunTargetColor, ease);
    scene.fog.near = THREE.MathUtils.lerp(
      scene.fog.near,
      THREE.MathUtils.lerp(180, 54, Math.pow(this.cloudiness, 1.16)),
      ease,
    );
    scene.fog.far = THREE.MathUtils.lerp(
      scene.fog.far,
      THREE.MathUtils.lerp(640, 215, Math.pow(this.cloudiness, 1.12)),
      ease,
    );
    this.atmosphereFogColor.copy(this.clearFogColor)
      .lerp(this.stormFogColor, Math.pow(this.cloudiness, 1.1) * 0.84);
    scene.fog.color.lerp(this.atmosphereFogColor, ease);
    if (this.sunSprite) {
      this.sunSprite.material.opacity = THREE.MathUtils.lerp(
        this.sunSprite.material.opacity,
        THREE.MathUtils.lerp(1, 0.08, Math.pow(this.cloudiness, 1.35)),
        ease,
      );
    }
    const calmTarget = waveField.preset === 1 ? 1 : 0;
    this.paradiseSkyMaterial.uniforms.uCalm.value = THREE.MathUtils.damp(
      this.paradiseSkyMaterial.uniforms.uCalm.value,
      calmTarget,
      0.9,
      dt,
    );
    this._syncOceanAtmosphere();
  }

  setLightning(strength = 0) {
    this.paradiseSkyMaterial.uniforms.uLightning.value = THREE.MathUtils.clamp(
      strength,
      0,
      1,
    );
  }

  setPerformanceBudget({ cloudOctaves = 4, cloudShadowScale = 1 } = {}) {
    const octaves = THREE.MathUtils.clamp(Math.round(cloudOctaves), 2, 5);
    if (octaves !== this.cloudOctaves) {
      this.cloudOctaves = octaves;
      this.paradiseSkyMaterial.defines.CLOUD_OCTAVES = octaves;
      this.paradiseSkyMaterial.needsUpdate = true;
    }
    this.cloudShadowScale = cloudShadowScale;
    this._syncOceanAtmosphere();
  }

  positionSunHolder(cameraPosition) {
    this.sunHolder.position.set(cameraPosition.x, 0, cameraPosition.z);
  }

  positionSky(cameraPosition) {
    this.paradiseSky.position.copy(cameraPosition);
  }

  positionSunLight(boatPosition) {
    this.sunLight.position.copy(boatPosition).addScaledVector(this.sun, 80);
    this.sunLight.target.position.copy(boatPosition);
  }

  _syncOceanAtmosphere() {
    const uniforms = this.ocean?.uniforms;
    if (!uniforms) return;
    if (uniforms.uCloudiness) uniforms.uCloudiness.value = this.cloudiness;
    if (uniforms.uCloudOffset) uniforms.uCloudOffset.value.copy(this.cloudOffset);
    if (uniforms.uCloudShadowStrength) {
      uniforms.uCloudShadowStrength.value = this.cloudShadowScale * this.cloudiness;
    }
  }

  _applyTexture(texture, ocean, boat, cameraController) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const { sunDirection, fogColor } = analyzeHdrTexture(texture);
    this.sun.copy(sunDirection);
    ocean.uniforms.uSunDir.value.copy(this.sun);
    boat.setStartYaw(this.startYaw(), true);
    cameraController.snap();
    this.scene.fog.color.copy(fogColor);
    this.clearFogColor.copy(fogColor);
    this.scene.background = texture;
    this.scene.backgroundIntensity = 1;

    const pmrem = this.pmremFactory(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(texture).texture;
    pmrem.dispose();

    this.sunSprite = this.sunSpriteFactory
      ? this.sunSpriteFactory(this.sun)
      : this._createSunSprite();
    this.sunHolder.add(this.sunSprite);
  }

  _createSunSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,252,240,1)');
    gradient.addColorStop(0.07, 'rgba(255,248,225,0.95)');
    gradient.addColorStop(0.2, 'rgba(255,238,195,0.35)');
    gradient.addColorStop(0.55, 'rgba(255,228,175,0.1)');
    gradient.addColorStop(1, 'rgba(255,225,165,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    sprite.position.copy(this.sun).multiplyScalar(3000);
    sprite.scale.set(750, 750, 1);
    return sprite;
  }
}
