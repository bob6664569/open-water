const PROFILES = [
  {
    id: 'low', dprMax: 1, scaleMin: 0.7, scaleStart: 0.85,
    msaa: 0, bloom: false, bloomStrength: 0,
    shadowSize: 512, reflectionSize: 256, reflectionHz: 0,
    refractionScale: 0.25, refractionHz: 15,
    physicsHz: 120, physicsMaxSteps: 4,
    oceanFarSegments: 192, oceanPatchSegments: 128,
    particleScale: 0.25, rainScale: 0.3,
  },
  {
    id: 'medium', dprMax: 1.25, scaleMin: 0.72, scaleStart: 0.9,
    msaa: 0, bloom: true, bloomStrength: 0.14,
    shadowSize: 1024, reflectionSize: 512, reflectionHz: 0,
    refractionScale: 0.35, refractionHz: 24,
    physicsHz: 120, physicsMaxSteps: 5,
    oceanFarSegments: 320, oceanPatchSegments: 192,
    particleScale: 0.5, rainScale: 0.5,
  },
  {
    id: 'high', dprMax: 1.5, scaleMin: 0.75, scaleStart: 1,
    msaa: 2, bloom: true, bloomStrength: 0.2,
    shadowSize: 1536, reflectionSize: 768, reflectionHz: 0,
    refractionScale: 0.5, refractionHz: 0,
    physicsHz: 180, physicsMaxSteps: 7,
    oceanFarSegments: 512, oceanPatchSegments: 256,
    particleScale: 0.75, rainScale: 0.75,
  },
  {
    id: 'ultra', dprMax: 2, scaleMin: 0.8, scaleStart: 1,
    msaa: 4, bloom: true, bloomStrength: 0.22,
    shadowSize: 2048, reflectionSize: 1024, reflectionHz: 0,
    refractionScale: 0.65, refractionHz: 0,
    physicsHz: 240, physicsMaxSteps: 12,
    oceanFarSegments: 768, oceanPatchSegments: 320,
    particleScale: 1, rainScale: 1,
  },
];
const QUALITY_STORAGE_KEY = 'ocean-boat:quality-mode';

function storedMode() {
  try { return localStorage.getItem(QUALITY_STORAGE_KEY); } catch { return null; }
}

function rememberMode(mode) {
  try { localStorage.setItem(QUALITY_STORAGE_KEY, mode); } catch { /* stockage indisponible */ }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function initialTier(isTouch) {
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const pixels = screen.width * screen.height * Math.min(devicePixelRatio, 2) ** 2;
  if (isTouch && (memory <= 4 || cores <= 4)) return 0;
  if (memory <= 4 || cores <= 4 || pixels > 8_500_000) return 1;
  if (memory >= 12 && cores >= 10 && !isTouch) return 3;
  return 2;
}

export class PerformanceManager {
  constructor(renderer, { isTouch = false, targetFps = isTouch ? 30 : 60, onChange } = {}) {
    this.renderer = renderer;
    this.targetFps = targetFps;
    this.onChange = onChange;
    const params = new URLSearchParams(location.search);
    // L'URL est une surcharge explicite (benchmark/lien partagé), sinon le choix
    // durable de l'utilisateur est restauré. Toute valeur inconnue revient à Auto.
    const requested = params.has('quality') ? params.get('quality') : storedMode();
    const requestedTier = PROFILES.findIndex(profile => profile.id === requested);
    this.auto = requestedTier < 0;
    this.active = false;
    this.tier = this.auto ? initialTier(isTouch) : requestedTier;
    this.scale = PROFILES[this.tier].scaleStart;
    this.frameTimes = [];
    this.cpuTimes = [];
    this.gpuTimes = [];
    this.lastAdjust = performance.now();
    this.lastChange = this.lastAdjust;
    this.frameStart = this.lastAdjust;
    this.lastFrameAt = null;
    this._gpuQuery = null;
    this._gpuPending = [];

    const gl = renderer.getContext();
    this.gl = gl;
    this.timerExt = renderer.capabilities.isWebGL2
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  }

  get profile() { return PROFILES[this.tier]; }
  get quality() { return { ...this.profile, tier: this.tier, scale: this.scale }; }

  apply() {
    this.onChange?.(this.quality);
  }

  setMode(mode = 'auto') {
    const tier = PROFILES.findIndex(profile => profile.id === mode);
    this.auto = tier < 0;
    if (!this.auto) this.tier = tier;
    this.scale = this.profile.scaleStart;
    this.lastChange = performance.now();
    rememberMode(this.auto ? 'auto' : this.profile.id);
    this.apply();
  }

  setActive(active) {
    this.active = active;
    this._resetSamples();
    this.lastAdjust = performance.now();
    this.lastChange = this.lastAdjust;
  }

  // Vide les fenêtres de mesure. À appeler après chaque changement de qualité pour
  // que la décision suivante porte sur le nouveau niveau, pas sur des frames
  // périmées : sinon un pic transitoire cascade en plusieurs rétrogradations (le
  // buffer met ~3 s à se vider alors que l'on réévalue toutes les 1,5 s), et
  // l'à-coup de réallocation d'`applyQuality`, appliqué dans la frame mesurée,
  // fausse la mesure d'après.
  _resetSamples() {
    this.frameTimes.length = 0;
    this.cpuTimes.length = 0;
    this.gpuTimes.length = 0;
    this.lastFrameAt = null;
  }

  beginFrame(now = performance.now()) {
    if (this.lastFrameAt !== null) {
      const frameTime = now - this.lastFrameAt;
      if (frameTime < 250) {
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > 180) this.frameTimes.shift();
      }
    }
    this.lastFrameAt = now;
    this.frameStart = now;
    this._pollGpuQueries();
  }

  beginGpu() {
    if (!this.active || !this.timerExt || this._gpuQuery) return;
    const query = this.gl.createQuery();
    this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
    this._gpuQuery = query;
  }

  endGpu() {
    if (!this._gpuQuery) return;
    this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this._gpuPending.push(this._gpuQuery);
    this._gpuQuery = null;
  }

  endFrame(now = performance.now()) {
    const cpu = now - this.frameStart;
    this.cpuTimes.push(cpu);
    if (this.cpuTimes.length > 180) this.cpuTimes.shift();
    this._adjust(now);
  }

  _pollGpuQueries() {
    if (!this.timerExt || !this._gpuPending.length) return;
    const disjoint = this.gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
    while (this._gpuPending.length) {
      const query = this._gpuPending[0];
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this._gpuPending.shift();
      if (!disjoint) {
        const ns = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
        this.gpuTimes.push(ns / 1e6);
        if (this.gpuTimes.length > 120) this.gpuTimes.shift();
      }
      this.gl.deleteQuery(query);
    }
  }

  _adjust(now) {
    if (!this.auto || !this.active) return;
    if (this.frameTimes.length < 45 || now - this.lastAdjust < 1500) return;
    const budget = 1000 / this.targetFps;
    const cpu95 = percentile(this.cpuTimes, 0.95);
    const gpu95 = percentile(this.gpuTimes, 0.9);
    this.lastAdjust = now;

    // On décide sur le travail réel par frame, pas sur l'intervalle rAF : celui-ci
    // est plancher au VSync (≈16,7 ms à 60 Hz) et pollué par des à-coups que baisser
    // la qualité ne corrige pas (GC, compositeur), s'en servir comme déclencheur
    // faisait rétrograder sans fin. Avec timer GPU on mesure directement la charge
    // (symétrique dans les deux sens). Sans timer, on se rabat sur le CPU réel plus
    // la *médiane* de l'intervalle rAF : une médiane franchement au-dessus du budget
    // = frames réellement perdues en continu (on est GPU-bound), insensible à un pic
    // isolé ; et on n'autorise la remontée que si les frames tardives restent rares.
    let overloaded, comfortable;
    if (gpu95) {
      const work = Math.max(gpu95, cpu95);
      overloaded = work > budget * 1.05;
      comfortable = work < budget * 0.72;
    } else {
      const frameMedian = percentile(this.frameTimes, 0.5);
      const frameP90 = percentile(this.frameTimes, 0.9);
      overloaded = cpu95 > budget * 1.05 || frameMedian > budget * 1.25;
      comfortable = cpu95 < budget * 0.72 && frameP90 < budget * 1.25;
    }

    if (overloaded) {
      if (this.scale > this.profile.scaleMin + 0.01) {
        this.scale = Math.max(this.profile.scaleMin, this.scale - 0.1);
      } else if (this.tier > 0) {
        this.tier--;
        this.scale = PROFILES[this.tier].scaleStart;
      } else return;
      this.lastChange = now;
      this.apply();
      this._resetSamples();
      return;
    }

    if (!comfortable || now - this.lastChange < 3500) return;
    if (this.scale < 0.99) {
      this.scale = Math.min(1, this.scale + 0.1);
    } else if (this.tier < PROFILES.length - 1) {
      this.tier++;
      this.scale = PROFILES[this.tier].scaleStart;
    } else return;
    this.lastChange = now;
    this.apply();
    this._resetSamples();
  }

  get stats() {
    return {
      profile: this.profile.id,
      mode: this.auto ? 'auto' : 'manual',
      scale: this.scale,
      frameP95: percentile(this.frameTimes, 0.95),
      cpuP95: percentile(this.cpuTimes, 0.95),
      gpuP90: percentile(this.gpuTimes, 0.9),
      targetFps: this.targetFps,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

}
