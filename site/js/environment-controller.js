import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SEA_PRESETS } from './waves.js';

const SUN_START_OFFSET = THREE.MathUtils.degToRad(12);
const CLEAR_FOG = 0x9cbfd8;
const STORM_FOG = 0x4a5962;

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
    this.sun = new THREE.Vector3(-0.4, 0.6, -0.7).normalize();
    this.sunSprite = null;

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
      },
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
        varying vec3 vSkyDirection;
        void main() {
          float sky = max(vSkyDirection.y, 0.0);
          float horizon = 1.0 - smoothstep(0.02, 0.42, abs(vSkyDirection.y));
          float zenith = smoothstep(0.08, 0.82, sky);
          vec3 tint = mix(uHorizon, uZenith, smoothstep(0.05, 0.72, sky));
          float alpha = uCalm * (horizon * 0.13 + zenith * 0.075);
          gl_FragColor = vec4(tint, alpha);
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
    const storm = THREE.MathUtils.smoothstep(
      waveField.significantWaveHeight,
      SEA_PRESETS[2].hs,
      SEA_PRESETS[4].hs,
    );
    const ease = 1 - Math.exp(-dt * 0.75);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      renderer.toneMappingExposure,
      THREE.MathUtils.lerp(0.85, 0.48, storm),
      ease,
    );
    if (scene.background) {
      scene.backgroundIntensity = THREE.MathUtils.lerp(
        scene.backgroundIntensity,
        THREE.MathUtils.lerp(1, 0.38, storm),
        ease,
      );
    }
    if (scene.environment) {
      scene.environmentIntensity = THREE.MathUtils.lerp(
        scene.environmentIntensity ?? 1,
        THREE.MathUtils.lerp(1, 0.62, storm),
        ease,
      );
    }
    sunLight.intensity = THREE.MathUtils.lerp(
      sunLight.intensity,
      THREE.MathUtils.lerp(2, 0.55, storm),
      ease,
    );
    scene.fog.near = THREE.MathUtils.lerp(
      scene.fog.near,
      THREE.MathUtils.lerp(180, 58, storm),
      ease,
    );
    scene.fog.far = THREE.MathUtils.lerp(
      scene.fog.far,
      THREE.MathUtils.lerp(640, 225, storm),
      ease,
    );
    this.atmosphereFogColor.copy(this.clearFogColor).lerp(this.stormFogColor, storm * 0.82);
    scene.fog.color.lerp(this.atmosphereFogColor, ease);
    if (this.sunSprite) {
      this.sunSprite.material.opacity = THREE.MathUtils.lerp(
        this.sunSprite.material.opacity,
        THREE.MathUtils.lerp(1, 0.12, storm),
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
