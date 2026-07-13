import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareBenchmarks,
  percentile,
  summarizeBenchmark,
} from '../tools/benchmark-core.mjs';

test('benchmark percentiles are order-independent and use the nearest rank', () => {
  const samples = [9, 1, 5, 3, 7];
  assert.equal(percentile(samples, 0.5), 5);
  assert.equal(percentile(samples, 0.95), 9);
  assert.equal(percentile([], 0.5), 0);
});

test('benchmark summaries expose stable per-operation metrics', () => {
  const summary = summarizeBenchmark('case', [4, 2, 3], 1_000, 42);
  assert.deepEqual(summary, {
    name: 'case',
    iterationsPerSample: 1_000,
    samples: 3,
    medianMs: 3,
    p95Ms: 4,
    medianNsPerOp: 3_000,
    opsPerSecond: 1_000_000 / 3,
    checksum: 42,
  });
});

test('baseline comparison flags only regressions beyond the configured tolerance', () => {
  const baseline = [
    { name: 'stable', medianNsPerOp: 100 },
    { name: 'slow', medianNsPerOp: 100 },
  ];
  const current = [
    { name: 'stable', medianNsPerOp: 114 },
    { name: 'slow', medianNsPerOp: 116 },
    { name: 'new', medianNsPerOp: 50 },
  ];

  const comparison = compareBenchmarks(current, baseline, 15);
  assert.equal(comparison[0].status, 'ok');
  assert.ok(Math.abs(comparison[0].regressionPercent - 14) < 1e-9);
  assert.equal(comparison[1].status, 'regression');
  assert.ok(Math.abs(comparison[1].regressionPercent - 16) < 1e-9);
  assert.deepEqual(comparison[2], {
    name: 'new', status: 'missing', regressionPercent: null,
  });
});
