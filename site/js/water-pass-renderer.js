import * as THREE from 'three';
import { REFLECTION_LAYER, REFRACTION_LAYER } from './render-layers.js';

export class WaterPassRenderer {
  constructor({
    renderer,
    scene,
    camera,
    ocean,
    waveField,
    boat,
    paradiseSky,
    isTouch = false,
    width = globalThis.innerWidth ?? 1,
    height = globalThis.innerHeight ?? 1,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ocean = ocean;
    this.waveField = waveField;
    this.boat = boat;
    this.paradiseSky = paradiseSky;

    const reflectionSize = isTouch ? 512 : 1024;
    const refractionWidth = Math.floor(width / 2);
    const refractionHeight = Math.floor(height / 2);
    this.reflectionTarget = new THREE.WebGLRenderTarget(reflectionSize, reflectionSize);
    this.refractionTarget = new THREE.WebGLRenderTarget(refractionWidth, refractionHeight);
    this.refractionTarget.depthTexture = new THREE.DepthTexture(
      refractionWidth,
      refractionHeight,
      THREE.UnsignedIntType,
    );
    this.refractionTarget.depthTexture.format = THREE.DepthFormat;

    this.mirrorCamera = new THREE.PerspectiveCamera();
    this.mirrorCamera.layers.set(REFLECTION_LAYER);
    this.reflectionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05);
    this.refractionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.35);
    this.biasMatrix = new THREE.Matrix4().set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    this.direction = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.reflectionClipping = [this.reflectionPlane];
    this.refractionClipping = [this.refractionPlane];
    this.noClipping = [];
    this.lastReflectionAt = -Infinity;
    this.lastRefractionAt = -Infinity;

    ocean.uniforms.uReflMap.value = this.reflectionTarget.texture;
    ocean.uniforms.uRefrMap.value = this.refractionTarget.texture;
    ocean.uniforms.uRefrDepth.value = this.refractionTarget.depthTexture;
    ocean.uniforms.uCameraNear.value = camera.near;
    ocean.uniforms.uCameraFar.value = camera.far;
  }

  setQuality(quality, previous, width, height, { force = false, viewportChanged = false } = {}) {
    if (force || !previous || previous.reflectionSize !== quality.reflectionSize) {
      this.reflectionTarget.setSize(quality.reflectionSize, quality.reflectionSize);
      this.lastReflectionAt = -Infinity;
    }
    if (viewportChanged || !previous || previous.refractionScale !== quality.refractionScale) {
      this.refractionTarget.setSize(
        Math.max(1, Math.floor(width * quality.refractionScale)),
        Math.max(1, Math.floor(height * quality.refractionScale)),
      );
      this.lastRefractionAt = -Infinity;
    }
  }

  render(now, quality) {
    const reflectionDue = quality.reflectionHz <= 0
      || now - this.lastReflectionAt >= 1000 / quality.reflectionHz;
    const refractionDue = quality.refractionHz <= 0
      || now - this.lastRefractionAt >= 1000 / quality.refractionHz;
    if (!reflectionDue && !refractionDue) return;

    const { renderer, scene, camera } = this;
    const waterY = this.waveField.heightAt(this.boat.pos.x, this.boat.pos.z);
    this.reflectionPlane.constant = -waterY + 0.05;
    this.refractionPlane.constant = waterY + 0.35;
    const oldMask = camera.layers.mask;
    const oldBackground = scene.background;
    const oldFog = scene.fog;
    const oldParadiseSkyVisible = this.paradiseSky.visible;
    scene.background = null;
    scene.fog = null;
    this.paradiseSky.visible = false;
    renderer.setClearColor(0x000000, 0);

    try {
      if (refractionDue) this._renderRefraction(now, oldMask);
      if (reflectionDue) this._renderReflection(now, waterY);
    } finally {
      camera.layers.mask = oldMask;
      renderer.clippingPlanes = this.noClipping;
      renderer.setRenderTarget(null);
      scene.background = oldBackground;
      scene.fog = oldFog;
      this.paradiseSky.visible = oldParadiseSkyVisible;
    }
  }

  _renderRefraction(now, oldMask) {
    const { renderer, scene, camera } = this;
    camera.layers.set(REFRACTION_LAYER);
    renderer.clippingPlanes = this.refractionClipping;
    renderer.setRenderTarget(this.refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = oldMask;
    this.lastRefractionAt = now;
  }

  _renderReflection(now, waterY) {
    const { renderer, scene, camera, mirrorCamera } = this;
    mirrorCamera.position.copy(camera.position);
    mirrorCamera.position.y = 2 * waterY - mirrorCamera.position.y;
    camera.getWorldDirection(this.direction);
    this.target.copy(camera.position).add(this.direction);
    this.target.y = 2 * waterY - this.target.y;
    // Reflect the active camera up vector; fixed world-up degenerates in top view.
    mirrorCamera.up.set(camera.up.x, -camera.up.y, camera.up.z);
    mirrorCamera.lookAt(this.target);
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCamera.updateMatrixWorld();
    this.ocean.uniforms.uReflMatrix.value
      .copy(this.biasMatrix)
      .multiply(mirrorCamera.projectionMatrix)
      .multiply(mirrorCamera.matrixWorldInverse);
    renderer.clippingPlanes = this.reflectionClipping;
    renderer.setRenderTarget(this.reflectionTarget);
    renderer.clear();
    renderer.render(scene, mirrorCamera);
    this.lastReflectionAt = now;
  }
}
