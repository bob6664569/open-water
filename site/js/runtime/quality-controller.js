import { requestNextFrame } from './browser-platform.js';

const PERFORMANCE_HUD_INTERVAL = 250;

export class QualityController {
  constructor({
    performanceManager,
    renderer,
    composer,
    waterPasses,
    bloom,
    smaa,
    sunLight,
    budgetTargets = [],
    resolutionTarget = null,
    achievements,
    elements = {},
    document = globalThis.document,
    location = globalThis.location,
    history = globalThis.history,
    requestFrame = requestNextFrame,
    viewportWidth = () => globalThis.innerWidth,
    viewportHeight = () => globalThis.innerHeight,
    devicePixelRatio = () => globalThis.devicePixelRatio,
  }) {
    this.performanceManager = performanceManager;
    this.renderer = renderer;
    this.composer = composer;
    this.waterPasses = waterPasses;
    this.bloom = bloom;
    this.smaa = smaa;
    this.sunLight = sunLight;
    this.budgetTargets = budgetTargets;
    this.resolutionTarget = resolutionTarget;
    this.achievements = achievements;
    this.controlElement = elements.control ?? null;
    this.currentElement = elements.current ?? null;
    this.selectElement = elements.select ?? null;
    this.document = document;
    this.location = location;
    this.history = history;
    this.requestFrame = requestFrame;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.devicePixelRatio = devicePixelRatio;

    this.current = null;
    this.pending = null;
    this.pendingForce = false;
    this.appliedPixelRatio = 0;
    this.appliedWidth = 0;
    this.appliedHeight = 0;
    this.pointerInteraction = false;
    this.performanceHud = null;
    this.nextPerformanceHudAt = 0;
    this.bound = false;

    this._pointerDown = () => { this.pointerInteraction = true; };
    this._keyboardInteraction = () => { this.pointerInteraction = false; };
    this._pointerCancel = () => { this.pointerInteraction = false; };
    this._selectionChange = () => this._handleSelectionChange();
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.performanceManager.onChange = quality => this.queue(quality);
    this.selectElement?.addEventListener('pointerdown', this._pointerDown);
    this.selectElement?.addEventListener('keydown', this._keyboardInteraction);
    this.selectElement?.addEventListener('pointercancel', this._pointerCancel);
    this.selectElement?.addEventListener('change', this._selectionChange);
    this._installPerformanceHud();
    this.apply(this.performanceManager.quality, true);
  }

  destroy() {
    if (!this.bound) return;
    this.bound = false;
    this.selectElement?.removeEventListener('pointerdown', this._pointerDown);
    this.selectElement?.removeEventListener('keydown', this._keyboardInteraction);
    this.selectElement?.removeEventListener('pointercancel', this._pointerCancel);
    this.selectElement?.removeEventListener('change', this._selectionChange);
    this.performanceHud?.remove();
    this.performanceHud = null;
    this.performanceManager.onChange = null;
  }

  queue(quality, force = false) {
    this.pending = quality;
    this.pendingForce ||= force;
  }

  resize() {
    if (this.current) this.queue(this.current, true);
  }

  applyPending() {
    if (!this.pending) return false;
    // Render-target reallocations must happen before composition to avoid black flashes.
    const quality = this.pending;
    const force = this.pendingForce;
    this.pending = null;
    this.pendingForce = false;
    this.apply(quality, force);
    return true;
  }

  apply(quality, force = false) {
    const previous = this.current;
    this.current = quality;
    const width = this.viewportWidth();
    const height = this.viewportHeight();
    const pixelRatio = Math.min(this.devicePixelRatio(), quality.dprMax) * quality.scale;
    const ratioChanged = Math.abs(pixelRatio - this.appliedPixelRatio) > 0.001;
    const viewportChanged = force || width !== this.appliedWidth || height !== this.appliedHeight;

    if (ratioChanged || viewportChanged) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height);
      if (ratioChanged) this.composer.setPixelRatio(pixelRatio);
      if (viewportChanged) this.composer.setSize(width, height);
      this.appliedPixelRatio = pixelRatio;
      this.appliedWidth = width;
      this.appliedHeight = height;
    }

    this.waterPasses.setQuality(quality, previous, width, height, {
      force,
      viewportChanged,
    });
    this.bloom.enabled = quality.bloom;
    this.bloom.strength = quality.bloomStrength;
    this.smaa.enabled = quality.smaa;
    this._setTargetSamples(this.composer.renderTarget1, quality.msaa);
    this._setTargetSamples(this.composer.renderTarget2, quality.msaa);

    if (force || !previous || previous.shadowSize !== quality.shadowSize) {
      this.sunLight.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }

    for (const target of this.budgetTargets) target.setPerformanceBudget(quality);
    if (this.resolutionTarget) this.renderer.getDrawingBufferSize(this.resolutionTarget);
    this.document.documentElement.dataset.quality = quality.id;
    this.syncControl();
  }

  syncControl() {
    if (!this.controlElement) return;
    const stats = this.performanceManager.stats;
    this.controlElement.dataset.quality = stats.profile;
    this.controlElement.dataset.mode = stats.mode;
    if (this.currentElement) this.currentElement.textContent = stats.profile;
    if (this.selectElement) {
      this.selectElement.value = stats.mode === 'auto' ? 'auto' : stats.profile;
    }
    this.controlElement.title = stats.mode === 'auto'
      ? `Adaptive quality · currently ${stats.profile}`
      : `Quality forced to ${stats.profile}`;
  }

  updateHud(now) {
    if (!this.performanceHud || now < this.nextPerformanceHudAt) return;
    this.nextPerformanceHudAt = now + PERFORMANCE_HUD_INTERVAL;
    const stats = this.performanceManager.stats;
    this.performanceHud.textContent = [
      `${stats.profile.toUpperCase()} ${stats.mode} · scale ${stats.scale.toFixed(2)}`,
      `frame p95 ${stats.frameP95.toFixed(1)} ms · target ${stats.targetFps} fps`,
      `CPU p95 ${stats.cpuP95.toFixed(1)} ms · GPU p90 ${stats.gpuP90.toFixed(1)} ms`,
      `${stats.calls} calls · ${(stats.triangles / 1e6).toFixed(2)} M triangles`,
    ].join('\n');
  }

  _setTargetSamples(target, samples) {
    if (!target || target.samples === samples) return;
    target.samples = samples;
    target.dispose();
  }

  _handleSelectionChange() {
    const releasePointerFocus = this.pointerInteraction;
    this.pointerInteraction = false;
    const mode = this.selectElement.value;
    this.performanceManager.setMode(mode);
    this.achievements.recordQualityChange();
    const url = new URL(this.location.href);
    if (mode === 'auto') url.searchParams.delete('quality');
    else url.searchParams.set('quality', mode);
    this.history.replaceState(null, '', url);
    this.syncControl();
    if (releasePointerFocus) this.requestFrame(() => this.selectElement.blur());
  }

  _installPerformanceHud() {
    if (!new URLSearchParams(this.location.search).has('perf')) return;
    this.performanceHud = this.document.createElement('pre');
    Object.assign(this.performanceHud.style, {
      position: 'fixed', left: '12px', bottom: '88px', zIndex: '50', margin: '0',
      padding: '8px 10px', color: '#bcecff', background: 'rgba(0,10,18,.78)',
      border: '1px solid rgba(188,236,255,.25)', borderRadius: '5px',
      font: '10px/1.45 ui-monospace, monospace', pointerEvents: 'none',
    });
    this.document.body.appendChild(this.performanceHud);
  }
}
