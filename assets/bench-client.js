// Изолированный браузерный замер: каждая сборка получает свой Worker,
// запускается по очереди и завершается до старта следующей.
// Так результаты не зависят от того, сколько модулей разогрето в одном контексте.

const workerUrl = new URL('./bench-worker.js', import.meta.url);

export const BENCH_PROTOCOL = { warmupMs: 500, rounds: 7, durationMs: 150 };

/**
 * @param {Array<{id: string, url: string}>} engines
 * @param {{warmupMs?: number, rounds?: number, durationMs?: number,
 *          onProgress?: (info: {index: number, total: number, engine: object}) => void}} [opts]
 * @returns {Promise<Array<{engine: object, ok: boolean, error?: string,
 *          bytes?: number, tests?: {passed: number, total: number},
 *          perf?: {opsPerSec: number, samples: number[], stats: object, workloadOps: number}}>>}
 */
export async function benchIsolated(engines, opts = {}) {
  const { onProgress, ...rest } = opts;
  const config = { ...BENCH_PROTOCOL, ...rest };
  const base = globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/';
  const results = [];

  for (let index = 0; index < engines.length; index++) {
    const engine = engines[index];
    if (onProgress) onProgress({ index, total: engines.length, engine });
    // Абсолютный URL: внутри Worker относительные пути считаются от bench-worker.js.
    const url = new URL(engine.url, base).href;
    results.push({ engine, ...(await benchOne(url, config)) });
  }

  return results;
}

function benchOne(url, config) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(workerUrl, { type: 'module' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    const finish = (result) => {
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = (ev) => finish(ev.data);
    worker.onerror = (ev) => finish({ ok: false, error: ev.message || 'worker error' });
    worker.postMessage({ url, ...config });
  });
}
