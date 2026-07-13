export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function summarizeBenchmark(name, samples, iterationsPerSample, checksum) {
  const medianMs = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  return {
    name,
    iterationsPerSample,
    samples: samples.length,
    medianMs,
    p95Ms,
    medianNsPerOp: medianMs * 1e6 / iterationsPerSample,
    opsPerSecond: iterationsPerSample * 1000 / medianMs,
    checksum,
  };
}

export function compareBenchmarks(current, baseline, maxRegressionPercent) {
  const baselineByName = new Map(baseline.map(result => [result.name, result]));
  return current.map(result => {
    const reference = baselineByName.get(result.name);
    if (!reference || !(reference.medianNsPerOp > 0)) {
      return { name: result.name, status: 'missing', regressionPercent: null };
    }
    const regressionPercent = (result.medianNsPerOp / reference.medianNsPerOp - 1) * 100;
    return {
      name: result.name,
      status: regressionPercent > maxRegressionPercent ? 'regression' : 'ok',
      regressionPercent,
    };
  });
}
