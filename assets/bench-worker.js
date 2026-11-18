// Один Worker — одна сборка.
//
// Зачем: если измерять несколько горячих wasm-модулей в одном JS-контексте,
// V8 не успевает поднять оптимизацию для всех и последняя сборка проседает
// в 2–3 раза. Отдельный Worker даёт каждому модулю собственный изолят.
//
// Клиент: assets/bench-client.js.

import { benchmark, missingExports, runTests, WORKLOAD_OPS } from './protocol.js';

self.onmessage = async (ev) => {
  const { url, warmupMs, rounds, durationMs } = ev.data;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!WebAssembly.validate(bytes)) throw new Error('invalid wasm');

    const mod = new WebAssembly.Module(bytes);
    const imports = {};
    for (const imp of WebAssembly.Module.imports(mod)) {
      (imports[imp.module] ||= {})[imp.name] = () => {};
    }
    const { exports } = await WebAssembly.instantiate(mod, imports);

    const missing = missingExports(exports);
    if (missing.length) throw new Error(`нет экспортов: ${missing.join(', ')}`);

    const tests = runTests(exports);
    if (tests.passed !== tests.total) throw new Error(tests.failures.join('; '));

    const perf = benchmark(exports, { warmupMs, rounds, durationMs });

    self.postMessage({
      ok: true,
      bytes: bytes.length,
      tests: { passed: tests.passed, total: tests.total },
      perf: {
        opsPerSec: perf.opsPerSec,
        samples: perf.samples,
        workloadOps: WORKLOAD_OPS,
      },
    });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
