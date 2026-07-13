import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { WaveField } from '../site/js/waves.js';
import { compareBenchmarks, summarizeBenchmark } from './benchmark-core.mjs';

const args = process.argv.slice(2);
const hasFlag = flag => args.includes(flag);
const option = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const quick = hasFlag('--quick');
const json = hasFlag('--json');
const batches = quick ? 8 : 30;
const warmupBatches = quick ? 2 : 8;
const iterations = quick ? 500 : 2_000;
const maxRegressionPercent = Number(option('--max-regression', '15'));
const baselinePath = option('--baseline');
if (!Number.isFinite(maxRegressionPercent) || maxRegressionPercent < 0) {
  throw new Error('--max-regression must be a non-negative number');
}

function runCase(name, operation) {
  let checksum = 0;
  for (let batch = 0; batch < warmupBatches; batch++) {
    for (let i = 0; i < iterations; i++) checksum += operation(i);
  }

  const samples = [];
  for (let batch = 0; batch < batches; batch++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) checksum += operation(i);
    samples.push(performance.now() - start);
  }
  return summarizeBenchmark(name, samples, iterations, checksum);
}

const positionX = index => (index * 37 % 2_003) - 1_001;
const positionZ = index => (index * 91 % 1_999) - 999;

const waveField = new WaveField();
waveField.setSeaPreset(4);
for (let i = 0; i < 600; i++) waveField.update(1 / 60, 0, 0);
const velocity = new THREE.Vector3();
const normal = new THREE.Vector3();

const results = [
  runCase('waves.sampleSurface', (index) => {
    const x = positionX(index), z = positionZ(index);
    return waveField.sampleSurface(x, z, velocity, normal)
      + velocity.x + velocity.y + velocity.z + normal.y;
  }),
  runCase('waves.updateSpectrum', (index) => {
    const x = positionX(index), z = positionZ(index);
    waveField.update(1 / 240, x, z);
    return waveField.totalSteepness;
  }),
];

const report = {
  schemaVersion: 1,
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  configuration: { batches, warmupBatches, iterations },
  results,
};

if (baselinePath) {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  report.comparison = compareBenchmarks(results, baseline.results, maxRegressionPercent);
  report.maxRegressionPercent = maxRegressionPercent;
  if (report.comparison.some(result => result.status === 'regression')) process.exitCode = 1;
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Open Water CPU benchmark');
  console.log(`${process.version} · V8 ${process.versions.v8} · ${process.platform} ${process.arch}`);
  for (const result of results) {
    console.log(
      `${result.name.padEnd(24)} ${result.opsPerSecond.toFixed(0).padStart(9)} ops/s`
      + ` · median ${result.medianNsPerOp.toFixed(0)} ns/op`
      + ` · p95 ${result.p95Ms.toFixed(2)} ms/batch`,
    );
  }
  for (const comparison of report.comparison || []) {
    const delta = comparison.regressionPercent == null
      ? 'no baseline'
      : `${comparison.regressionPercent >= 0 ? '+' : ''}${comparison.regressionPercent.toFixed(1)}%`;
    console.log(`${comparison.status.padEnd(10)} ${comparison.name} · ${delta}`);
  }
}
