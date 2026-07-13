import * as THREE from 'three';


const ENGINE_BANKS = {
  zefiro: {
    low: './assets/audio/engines/zefiro-low.mp3',
    high: './assets/audio/engines/zefiro-high.mp3',
    lowRate: rpm => 0.80 + rpm * 0.54,
    highRate: rpm => 0.72 + rpm * 0.43,
  },
  'assault-boat': {
    low: './assets/audio/engines/assault-low.mp3',
    high: './assets/audio/engines/assault-high.mp3',
    lowRate: rpm => 0.78 + rpm * 0.56,
    highRate: rpm => 0.70 + rpm * 0.45,
  },
  racer: {
    full: './assets/audio/engines/racer-full.wav',
    loopStart: 8.05,
    loopEnd: 9.68,
    loopCrossfade: 0.12,
    introCrossfade: 0.42,
    loopRate: rpm => 0.92 + rpm * 0.18,
  },
  'seadoo-gti': {
    low: './assets/audio/engines/seadoo-low.wav',
    high: './assets/audio/engines/seadoo-high.wav',
    lowRate: rpm => 0.76 + rpm * 0.56,
    highRate: rpm => 0.72 + rpm * 0.48,
  },
  motoryacht: {
    low: './assets/audio/engines/yacht-low.mp3',
    high: './assets/audio/engines/yacht-high.mp3',
    lowRate: rpm => 0.82 + rpm * 0.40,
    highRate: rpm => 0.75 + rpm * 0.34,
  },
};

const engineAssets = bank => bank.full ? [bank.full] : [bank.low, bank.high];

const AMBIENT_ASSETS = {
  rainLight: './assets/audio/weather/rain-light.mp3',
  rainHeavy: './assets/audio/weather/rain-heavy.mp3',
  wavesCalm: './assets/audio/sea/waves-calm.mp3',
  wavesMedium: './assets/audio/sea/waves-medium.mp3',
  wavesStorm: './assets/audio/sea/waves-storm.mp3',
};

const THUNDER_BANKS = {
  near: [
    './assets/audio/weather/thunder-652690.mp3',
    './assets/audio/weather/thunder-744722.mp3',
  ],
  mid: [
    './assets/audio/weather/thunder-683421.mp3',
    './assets/audio/weather/thunder-795412.mp3',
    './assets/audio/weather/thunder-696550.mp3',
  ],
  far: [
    './assets/audio/weather/thunder-476739.mp3',
    './assets/audio/weather/thunder-795412.mp3',
  ],
};

const GULL_CRIES = [
  './assets/audio/animals/gull-1.mp3',
  './assets/audio/animals/gull-2.mp3',
  './assets/audio/animals/gull-3.mp3',
  './assets/audio/animals/gull-4.mp3',
];

const BIRD_CRIES = {
  parrot: [
    './assets/audio/animals/parrot-1.mp3',
    './assets/audio/animals/parrot-2.mp3',
    './assets/audio/animals/parrot-3.mp3',
  ],
};

const ALL_ASSETS = [...new Set([
  ...Object.values(ENGINE_BANKS).flatMap(engineAssets),
  ...Object.values(AMBIENT_ASSETS),
  ...Object.values(THUNDER_BANKS).flat(),
  ...GULL_CRIES,
  ...Object.values(BIRD_CRIES).flat(),
])];
const CONSTRAINED_AUDIO = matchMedia('(pointer: coarse)').matches
  || 'ontouchstart' in window
  || (navigator.deviceMemory != null && navigator.deviceMemory <= 4);
const CORE_ASSETS = [...new Set([
  ...Object.values(ENGINE_BANKS).flatMap(engineAssets),
  ...Object.values(AMBIENT_ASSETS),
])];

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = (value, min, max) => {
  const x = clamp01((value - min) / (max - min));
  return x * x * (3 - 2 * x);
};

function noiseBuffer(ctx, seconds = 3) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function setSmooth(param, value, time, constant = 0.08) {
  param.setTargetAtTime(value, time, constant);
}

export class BoatAudio {
  constructor(waveField) {
    this.wf = waveField;
    this.ctx = null;
    this.started = false;
    this.assetsReady = false;
    this.buffers = new Map();
    this.engineBanks = new Map();
    this.engineRpm = 0.14;
    this.activeVessel = '';
    this.lastThunder = { near: '', mid: '', far: '' };
    this.lastGull = '';
    this.lastBird = { parrot: '' };
    this.lastSlam = -10;
    this.lastExhaustPop = -10;
    this.impactProximity = 0.7;

    this.assetRequests = null;

    this._enginePosition = new THREE.Vector3();
    this._listenerForward = new THREE.Vector3();
    this._listenerUp = new THREE.Vector3();
  }

  start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }
    this.started = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    document.documentElement.dataset.audioState = 'loading';

    this.master = ctx.createGain();
    this.master.gain.value = 0.72;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.28;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.9;
    this.ambientBus = ctx.createGain();
    this.ambientDuck = ctx.createGain();
    this.ambientDuck.gain.value = 1;
    this.thunderBus = ctx.createGain();
    this.thunderBus.gain.value = 0.95;
    this.gullBus = ctx.createGain();
    this.gullBus.gain.value = 0.5;
    this.birdBus = ctx.createGain();
    this.birdBus.gain.value = 0.38;
    this.engineBus.connect(this.master);
    this.ambientBus.connect(this.ambientDuck).connect(this.master);
    this.thunderBus.connect(this.master);
    this.gullBus.connect(this.master);
    this.birdBus.connect(this.master);

    this._startProceduralLayers();
    this._requestAssets();
    this._decodeAssets();
  }

  _requestAssets() {
    if (this.assetRequests) return;
    const assets = CONSTRAINED_AUDIO ? CORE_ASSETS : ALL_ASSETS;
    this.assetRequests = new Map(assets.map(path => [path,
      fetch(path).then(response => {
        if (!response.ok) throw new Error(`${response.status} ${path}`);
        return response.arrayBuffer();
      }),
    ]));
  }

  _startProceduralLayers() {
    const ctx = this.ctx;

    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.fallbackEngineFilter = ctx.createBiquadFilter();
    this.fallbackEngineFilter.type = 'lowpass';
    this.fallbackEngineFilter.frequency.value = 500;
    this.fallbackEngineGain = ctx.createGain();
    this.fallbackEngineGain.gain.value = 0;
    const fallbackMix = ctx.createGain();
    fallbackMix.gain.value = 0.45;
    this.engOsc1.connect(fallbackMix);
    this.engOsc2.connect(fallbackMix);
    fallbackMix.connect(this.fallbackEngineFilter)
      .connect(this.fallbackEngineGain).connect(this.engineBus);
    this.engOsc1.start();
    this.engOsc2.start();

    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = noiseBuffer(ctx);
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ambientBus);
    this.windSrc.start();

    this.propSrc = ctx.createBufferSource();
    this.propSrc.buffer = noiseBuffer(ctx);
    this.propSrc.loop = true;
    this.propFilter = ctx.createBiquadFilter();
    this.propFilter.type = 'bandpass';
    this.propFilter.frequency.value = 980;
    this.propFilter.Q.value = 0.45;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 7000;
    this.enginePanner = ctx.createPanner();
    this.enginePanner.panningModel = 'HRTF';
    this.enginePanner.distanceModel = 'inverse';
    this.enginePanner.refDistance = 5;
    this.enginePanner.maxDistance = 90;
    this.enginePanner.rolloffFactor = 0.35;
    this.engineFilter.connect(this.enginePanner).connect(this.engineBus);
    this.propSrc.connect(this.propFilter).connect(this.propGain).connect(this.engineFilter);
    this.propSrc.start();

    this.racePulseOsc = ctx.createOscillator();
    this.racePulseOsc.type = 'sawtooth';
    this.racePulseFilter = ctx.createBiquadFilter();
    this.racePulseFilter.type = 'bandpass';
    this.racePulseFilter.frequency.value = 260;
    this.racePulseFilter.Q.value = 0.85;
    this.raceWhineOsc = ctx.createOscillator();
    this.raceWhineOsc.type = 'triangle';
    this.raceWhineFilter = ctx.createBiquadFilter();
    this.raceWhineFilter.type = 'highpass';
    this.raceWhineFilter.frequency.value = 680;
    this.raceWhineMix = ctx.createGain();
    this.raceWhineMix.gain.value = 0.16;
    this.raceEngineGain = ctx.createGain();
    this.raceEngineGain.gain.value = 0;
    this.racePulseOsc.connect(this.racePulseFilter).connect(this.raceEngineGain);
    this.raceWhineOsc.connect(this.raceWhineFilter)
      .connect(this.raceWhineMix).connect(this.raceEngineGain);
    this.raceEngineGain.connect(this.engineFilter);
    this.racePulseOsc.start();
    this.raceWhineOsc.start();
    this.exhaustPopBuffer = noiseBuffer(ctx, 0.24);

    this.fallbackSeaSrc = ctx.createBufferSource();
    this.fallbackSeaSrc.buffer = noiseBuffer(ctx);
    this.fallbackSeaSrc.loop = true;
    this.fallbackSeaSrc.playbackRate.value = 0.55;
    this.fallbackSeaFilter = ctx.createBiquadFilter();
    this.fallbackSeaFilter.type = 'lowpass';
    this.fallbackSeaFilter.frequency.value = 420;
    this.fallbackSeaGain = ctx.createGain();
    this.fallbackSeaGain.gain.value = 0.05;
    this.fallbackSeaSrc.connect(this.fallbackSeaFilter)
      .connect(this.fallbackSeaGain).connect(this.ambientBus);
    this.fallbackSeaSrc.start();
  }

  async _decodeAssets() {
    // Decode sequentially: Safari may hold both compressed and PCM buffers during
    // decodeAudioData, and parallel decoding causes large transient memory spikes.
    const decoded = [];
    for (const [path, request] of this.assetRequests) {
      try {
        const data = await request;
        const buffer = await this.ctx.decodeAudioData(data.slice(0));
        decoded.push([path, buffer]);
      } catch (error) {
        console.warn(`Audio unavailable: ${path}`, error);
      }
    }
    decoded.forEach(([path, buffer]) => this.buffers.set(path, buffer));
    this._startSampleLayers();
    this.assetsReady = this.engineBanks.size > 0;
    document.documentElement.dataset.audioState = this.assetsReady ? 'ready' : 'fallback';
    document.documentElement.dataset.audioBuffers = String(this.buffers.size);
  }

  _loop(path, destination, gainValue = 0) {
    const buffer = this.buffers.get(path);
    if (!buffer) return null;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.gainNode = gain;
    gain.gain.value = gainValue;
    source.connect(gain).connect(destination);
    source.start(this.ctx.currentTime, Math.random() * Math.max(0.01, buffer.duration - 0.1));
    return source;
  }

  _crossfadedTail(buffer, startSeconds, endSeconds, fadeSeconds) {
    const sampleRate = buffer.sampleRate;
    const start = Math.max(0, Math.floor(startSeconds * sampleRate));
    const end = Math.min(buffer.length, Math.floor(endSeconds * sampleRate));
    const regionLength = Math.max(2, end - start);
    const fadeLength = Math.min(
      Math.floor(fadeSeconds * sampleRate),
      Math.floor(regionLength * 0.25),
    );
    const outputLength = regionLength - fadeLength;
    const output = this.ctx.createBuffer(
      buffer.numberOfChannels,
      outputLength,
      sampleRate,
    );
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel);
      const data = output.getChannelData(channel);
      data.set(input.subarray(start, start + outputLength));
      for (let i = 0; i < fadeLength; i++) {
        const mix = i / Math.max(1, fadeLength - 1);
        data[i] = input[start + i] * mix
          + input[end - fadeLength + i] * (1 - mix);
      }
    }
    return output;
  }

  _startIntroTailBank(bank, now) {
    const intro = this.ctx.createBufferSource();
    const introGain = this.ctx.createGain();
    intro.buffer = bank.buffer;
    intro.playbackRate.value = 1;
    introGain.gain.value = 1;
    intro.connect(introGain).connect(bank.bankGain);

    const tail = this.ctx.createBufferSource();
    const tailGain = this.ctx.createGain();
    tail.buffer = bank.tailBuffer;
    tail.loop = true;
    tail.playbackRate.value = bank.config.loopRate(this.engineRpm);
    tailGain.gain.value = 0.0001;
    tail.connect(tailGain).connect(bank.bankGain);

    const fadeDuration = Math.min(
      bank.config.introCrossfade,
      bank.buffer.duration * 0.2,
    );
    const transition = now + bank.buffer.duration - fadeDuration;
    introGain.gain.setValueAtTime(1, transition);
    introGain.gain.exponentialRampToValueAtTime(0.0001, now + bank.buffer.duration);
    tailGain.gain.setValueAtTime(0.0001, transition);
    tailGain.gain.exponentialRampToValueAtTime(1, now + bank.buffer.duration);
    intro.start(now);
    tail.start(transition);
    intro.stop(now + bank.buffer.duration + 0.02);
    bank.intro = intro;
    bank.introGain = introGain;
    bank.tail = tail;
    bank.tailGain = tailGain;
  }

  _stopIntroTailBank(bank, now) {
    for (const gain of [bank.introGain, bank.tailGain]) {
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.035);
    }
    for (const source of [bank.intro, bank.tail]) {
      if (!source) continue;
      try { source.stop(now + 0.18); } catch { /* source already stopped */ }
    }
    bank.intro = bank.introGain = bank.tail = bank.tailGain = null;
  }

  _startSampleLayers() {
    for (const [id, config] of Object.entries(ENGINE_BANKS)) {
      const bankGain = this.ctx.createGain();
      if (config.full) {
        const buffer = this.buffers.get(config.full);
        if (!buffer) continue;
        bankGain.gain.value = 0;
        bankGain.connect(this.engineFilter);
        this.engineBanks.set(id, {
          config,
          bankGain,
          buffer,
          tailBuffer: this._crossfadedTail(
            buffer,
            config.loopStart,
            config.loopEnd,
            config.loopCrossfade,
          ),
          active: false,
          intro: null,
          introGain: null,
          tail: null,
          tailGain: null,
        });
        continue;
      }
      const lowGain = this.ctx.createGain();
      const highGain = this.ctx.createGain();
      bankGain.gain.value = 0;
      lowGain.gain.value = 0;
      highGain.gain.value = 0;
      const low = this._loop(config.low, lowGain, 1);
      const high = this._loop(config.high, highGain, 1);
      if (!low || !high) continue;
      lowGain.connect(bankGain);
      highGain.connect(bankGain);
      bankGain.connect(this.engineFilter);
      this.engineBanks.set(id, { config, bankGain, lowGain, highGain, low, high });
    }

    this.rainLight = this._loop(AMBIENT_ASSETS.rainLight, this.ambientBus);
    this.rainHeavy = this._loop(AMBIENT_ASSETS.rainHeavy, this.ambientBus);
    this.wavesCalm = this._loop(AMBIENT_ASSETS.wavesCalm, this.ambientBus);
    this.wavesMedium = this._loop(AMBIENT_ASSETS.wavesMedium, this.ambientBus);
    this.wavesStorm = this._loop(AMBIENT_ASSETS.wavesStorm, this.ambientBus);
  }

  exhaustPop(intensity = 1, position = null) {
    if (!this.started || !this.ctx || !this.exhaustPopBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastExhaustPop < 0.045) return;
    this.lastExhaustPop = now;
    const energy = clamp01(intensity / 1.6);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 110;
    panner.rolloffFactor = 0.42;
    if (position) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    }
    panner.connect(this.engineBus);

    const popGain = ctx.createGain();
    const peak = 0.16 + energy * 0.3;
    popGain.gain.setValueAtTime(0.001, now);
    popGain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12 + energy * 0.06);
    popGain.connect(panner);

    const crack = ctx.createBufferSource();
    crack.buffer = this.exhaustPopBuffer;
    crack.playbackRate.value = 0.72 + Math.random() * 0.48;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.value = 330 + energy * 520;
    crackFilter.Q.value = 0.72;
    crack.connect(crackFilter).connect(popGain);
    crack.start(now, Math.random() * 0.035);
    crack.stop(now + 0.18);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(105 + energy * 48, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.11);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.24 + energy * 0.34, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.115);
    thump.connect(thumpGain).connect(panner);
    thump.start(now);
    thump.stop(now + 0.12);
  }

  slam(intensity) {
    if (!this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastSlam < 0.16) return;
    this.lastSlam = now;
    const gain = ctx.createGain();
    const peak = Math.min(0.55, intensity * 0.24 * this.impactProximity);
    gain.gain.setValueAtTime(Math.max(0.001, peak), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.5);
    src.playbackRate.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.42);
  }

  gullCall(position = null, gain = 1) {
    if (!this.started) return;
    const available = GULL_CRIES.filter(path => this.buffers.has(path));
    if (!available.length) return;
    let choices = available.filter(path => path !== this.lastGull);
    if (!choices.length) choices = available;
    const path = choices[Math.floor(Math.random() * choices.length)];
    this.lastGull = path;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get(path);
    src.playbackRate.value = 0.9 + Math.random() * 0.22;
    const g = ctx.createGain();
    g.gain.value = (0.5 + Math.random() * 0.45) * gain;
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 8;
      panner.maxDistance = 320;
      panner.rolloffFactor = 0.9;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      src.connect(g).connect(panner).connect(this.gullBus);
    } else {
      src.connect(g).connect(this.gullBus);
    }
    src.start(now);
  }

  birdCall(type = 'parrot', position = null, gain = 1) {
    if (!this.started) return;
    const ctx = this.ctx, now = ctx.currentTime;
    let dest = this.birdBus;
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 8; panner.maxDistance = 340; panner.rolloffFactor = 0.9;
      if (panner.positionX) {
        panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      panner.connect(this.birdBus);
      dest = panner;
    }

    const bank = (BIRD_CRIES[type] || []).filter(path => this.buffers.has(path));
    if (bank.length) {
      let choices = bank.filter(path => path !== this.lastBird[type]);
      if (!choices.length) choices = bank;
      const path = choices[Math.floor(Math.random() * choices.length)];
      this.lastBird[type] = path;
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get(path);
      src.playbackRate.value = 0.9 + Math.random() * 0.16;
      const g = ctx.createGain();
      g.gain.value = (0.7 + Math.random() * 0.4) * gain;
      src.connect(g).connect(dest);
      src.start(now);
      return;
    }
    this._parrotSquawk(ctx, now, dest, gain);
  }

  _parrotSquawk(ctx, t0, dest, gain) {
    const n = Math.random() < 0.4 ? 2 : 1;
    let t = t0;
    for (let i = 0; i < n; i++) {
      const dur = 0.15 + Math.random() * 0.1;
      const f0 = 760 + Math.random() * 280;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + dur);
      const trem = ctx.createOscillator();
      trem.type = 'square';
      trem.frequency.value = 34 + Math.random() * 22;
      const tremDepth = ctx.createGain(); tremDepth.gain.value = 0.4;
      const rough = ctx.createGain(); rough.gain.value = 0.6;
      trem.connect(tremDepth).connect(rough.gain);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1700 + Math.random() * 500; bp.Q.value = 1.3;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.012);
      env.gain.setValueAtTime(0.9 * gain, t + dur * 0.55);
      env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      osc.connect(bp).connect(rough).connect(env).connect(dest);
      osc.start(t); osc.stop(t + dur + 0.02);
      trem.start(t); trem.stop(t + dur + 0.02);
      t += dur + 0.06 + Math.random() * 0.05;
    }
  }

  thunder({ distance = 500, intensity = 1, position = null } = {}) {
    if (!this.started) return;
    const tier = distance < 420 ? 'near' : distance < 1500 ? 'mid' : 'far';
    const available = THUNDER_BANKS[tier].filter(path => this.buffers.has(path));
    if (!available.length) {
      this._proceduralThunder(distance / 343, intensity);
      return;
    }

    let choices = available.filter(path => path !== this.lastThunder[tier]);
    if (!choices.length) choices = available;
    const path = choices[Math.floor(Math.random() * choices.length)];
    this.lastThunder[tier] = path;

    const ctx = this.ctx;
    const start = ctx.currentTime + Math.max(0.08, distance / 343);
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get(path);
    src.playbackRate.value = 0.975 + Math.random() * 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 9000 - smoothstep(distance, 250, 3500) * 7900;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.rolloffFactor = 0;
    if (position) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    }
    const gain = ctx.createGain();
    const distanceGain = Math.max(0.2, 1.15 / (1 + distance / 850));
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, distanceGain * intensity), start + 0.018,
    );
    gain.gain.setTargetAtTime(0.001, start + src.buffer.duration * 0.72, 0.7);
    src.connect(filter).connect(panner).connect(gain).connect(this.thunderBus);
    src.start(start);

    const duck = tier === 'near' ? 0.62 : tier === 'mid' ? 0.78 : 0.9;
    this.ambientDuck.gain.cancelScheduledValues(start);
    this.ambientDuck.gain.setTargetAtTime(duck, start, 0.035);
    this.ambientDuck.gain.setTargetAtTime(1, start + 0.8, 0.65);
  }

  _proceduralThunder(delay = 0.35, intensity = 1) {
    const ctx = this.ctx;
    const start = ctx.currentTime + Math.max(0.08, delay);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4);
    src.playbackRate.value = 0.64;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.55 * intensity, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 3.4);
    src.connect(filter).connect(gain).connect(this.thunderBus);
    src.start(start);
    src.stop(start + 3.5);
  }

  _updateListener(camera, now) {
    if (!camera) return;
    const listener = this.ctx.listener;
    camera.getWorldDirection(this._listenerForward);
    this._listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (listener.positionX) {
      setSmooth(listener.positionX, camera.position.x, now, 0.025);
      setSmooth(listener.positionY, camera.position.y, now, 0.025);
      setSmooth(listener.positionZ, camera.position.z, now, 0.025);
      setSmooth(listener.forwardX, this._listenerForward.x, now, 0.025);
      setSmooth(listener.forwardY, this._listenerForward.y, now, 0.025);
      setSmooth(listener.forwardZ, this._listenerForward.z, now, 0.025);
      setSmooth(listener.upX, this._listenerUp.x, now, 0.025);
      setSmooth(listener.upY, this._listenerUp.y, now, 0.025);
      setSmooth(listener.upZ, this._listenerUp.z, now, 0.025);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(
        this._listenerForward.x, this._listenerForward.y, this._listenerForward.z,
        this._listenerUp.x, this._listenerUp.y, this._listenerUp.z,
      );
    }
  }

  update(boat, camera, dt = 1 / 60) {
    if (!this.started) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this._updateListener(camera, now);

    const speed = boat.speedKn / 1.94384;
    const throttle = Math.abs(boat.throttle);
    const profile = boat.spec.audio;
    const wet = clamp01(boat.propWet);
    const throttleExponent = profile.throttleExponent ?? 0.58;
    const targetRpm = clamp01(
      0.14 + Math.pow(throttle, throttleExponent) * 0.82
      + (1 - wet) * throttle * 0.24,
    );
    const response = targetRpm > this.engineRpm
      ? (profile.rpmRise ?? 3.2)
      : (profile.rpmFall ?? 2.0);
    this.engineRpm += (targetRpm - this.engineRpm) * (1 - Math.exp(-dt * response));

    const speedNorm = clamp01(speed / Math.max(1, boat.spec.maxPropSpeed));
    const load = clamp01(throttle * (0.62 + 0.38 * (1 - speedNorm)) * (0.7 + wet * 0.3));
    const bankId = profile.bank || boat.spec.id;
    this.activeVessel = bankId;
    const blend = smoothstep(this.engineRpm, 0.38, 0.78);
    const idleLevel = profile.idleLevel ?? 0.38;
    for (const [id, bank] of this.engineBanks) {
      const active = id === bankId;
      const level = active
        ? (profile.sampleGain ?? 0.42) * (idleLevel + load * (1 - idleLevel))
        : 0.0001;
      setSmooth(bank.bankGain.gain, level, now, active ? 0.12 : 0.06);
      if (bank.buffer) {
        if (active && !bank.active) this._startIntroTailBank(bank, now);
        if (!active && bank.active) this._stopIntroTailBank(bank, now);
        bank.active = active;
        if (bank.tail) {
          setSmooth(
            bank.tail.playbackRate,
            bank.config.loopRate(this.engineRpm),
            now,
            0.12,
          );
        }
        continue;
      }
      setSmooth(bank.lowGain.gain, Math.sqrt(1 - blend), now, 0.08);
      setSmooth(bank.highGain.gain, Math.sqrt(blend), now, 0.08);
      setSmooth(bank.low.playbackRate, bank.config.lowRate(this.engineRpm), now, 0.07);
      setSmooth(bank.high.playbackRate, bank.config.highRate(this.engineRpm), now, 0.07);
    }

    const fallbackHz = (profile.idleHz + this.engineRpm
      * (profile.maxHz - profile.idleHz));
    setSmooth(this.engOsc1.frequency, fallbackHz, now, 0.08);
    setSmooth(this.engOsc2.frequency, fallbackHz * 2.02, now, 0.08);
    setSmooth(this.fallbackEngineFilter.frequency,
      profile.filterBase + throttle * profile.filterRange, now, 0.1);
    const hasBank = this.engineBanks.has(bankId);
    setSmooth(this.fallbackEngineGain.gain,
      hasBank ? 0.0001 : 0.035 + profile.gain * (0.28 + throttle * 0.72), now, 0.12);
    const racerActive = bankId === 'racer';
    setSmooth(this.racePulseOsc.frequency, fallbackHz * 1.18, now, 0.045);
    setSmooth(this.racePulseFilter.frequency, 190 + this.engineRpm * 920, now, 0.055);
    setSmooth(this.raceWhineOsc.frequency, 520 + this.engineRpm * 1950, now, 0.045);
    setSmooth(this.raceEngineGain.gain,
      racerActive ? 0.018 + load * 0.095 : 0.0001, now, racerActive ? 0.08 : 0.04);

    boat.worldPoint(boat.spec.effects.prop, this._enginePosition);
    setSmooth(this.enginePanner.positionX, this._enginePosition.x, now, 0.025);
    setSmooth(this.enginePanner.positionY, this._enginePosition.y, now, 0.025);
    setSmooth(this.enginePanner.positionZ, this._enginePosition.z, now, 0.025);

    const cameraDistance = camera ? camera.position.distanceTo(boat.pos) : 20;

    const proximity = 1 - smoothstep(cameraDistance, 6, 34);
    setSmooth(this.engineBus.gain, 0.9 * (0.68 + proximity * 0.5), now, 0.16);
    this.impactProximity = 0.35 + proximity * 0.65;

    const waterHeight = camera && this.wf
      ? this.wf.heightAt(camera.position.x, camera.position.z)
      : -Infinity;
    const underwater = camera && camera.position.y < waterHeight + 0.05;
    const perspectiveCutoff = underwater ? 520 : cameraDistance < 4.5 ? 2600 : 8200;
    setSmooth(this.engineFilter.frequency,
      Math.min(perspectiveCutoff, 2400 + load * 6500), now, 0.12);

    const ventilation = (1 - wet) * throttle;
    setSmooth(this.propGain.gain,
      (0.018 + throttle * wet * 0.085 + ventilation * 0.16)
      * (profile.propGain ?? 1), now, 0.08);
    setSmooth(this.propFilter.frequency,
      620 + throttle * 1450 + ventilation * 900, now, 0.1);

    const seaHeight = this.wf ? this.wf.significantWaveHeight : 0.9;
    const storm = smoothstep(seaHeight, 3.0, 5.2);
    setSmooth(this.windGain.gain,
      Math.min(0.32, speed * 0.009 + storm * 0.19), now, 0.3);
    setSmooth(this.windFilter.frequency,
      390 + speed * 27 + storm * 480, now, 0.3);

    const sea = clamp01((seaHeight - 0.35) / (5.2 - 0.35));
    const firstBlend = clamp01(sea / 0.48);
    const secondBlend = clamp01((sea - 0.34) / 0.66);
    if (this.wavesCalm) setSmooth(this.wavesCalm.gainNode.gain,
      0.22 * Math.sqrt(1 - firstBlend), now, 0.35);
    if (this.wavesMedium) setSmooth(this.wavesMedium.gainNode.gain,
      0.25 * Math.sqrt(firstBlend) * Math.sqrt(1 - secondBlend), now, 0.35);
    if (this.wavesStorm) setSmooth(this.wavesStorm.gainNode.gain,
      0.33 * Math.sqrt(secondBlend), now, 0.35);
    if (this.rainLight) setSmooth(this.rainLight.gainNode.gain,
      0.27 * storm * Math.sqrt(1 - smoothstep(storm, 0.45, 0.9)), now, 0.3);
    if (this.rainHeavy) setSmooth(this.rainHeavy.gainNode.gain,
      0.34 * smoothstep(storm, 0.38, 1), now, 0.3);
    setSmooth(this.fallbackSeaGain.gain,
      this.wavesCalm ? 0.0001 : 0.025 + Math.min(0.13, seaHeight * 0.035), now, 0.3);

    if (boat.slam > 1.2) this.slam(boat.slam);
  }
}
