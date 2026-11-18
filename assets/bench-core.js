// Общее ядро замеров для проектов серии.
// Протокол каждого проекта описывает свою нагрузку и тесты, а статистика и
// цикл «прогрев → окна по durationMs» остаются одинаковыми.

export function describeStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: sorted[Math.floor(n / 2)],
    stddev: Math.sqrt(variance),
  };
}

export function medianSample(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ops/sec: сколько операций нагрузки выполняется в секунду.
// Медиана из `rounds` окон; протокол проекта задаёт, что считать операцией.
export function benchmarkWorkload(
  runWorkload,
  { rounds = 10, durationMs = 150, warmupMs = 750, opsPerPass = 1 } = {},
) {
  const startWarm = performance.now();
  while (performance.now() - startWarm < warmupMs) runWorkload();

  const samples = [];
  for (let r = 0; r < rounds; r++) {
    let ops = 0;
    const start = performance.now();
    let elapsed = 0;
    while (elapsed < durationMs) {
      runWorkload();
      ops += opsPerPass;
      elapsed = performance.now() - start;
    }
    samples.push(ops / (elapsed / 1000));
  }
  return { opsPerSec: medianSample(samples), samples };
}
