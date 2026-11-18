// Один замер одной сборки в отдельном процессе.
// Нужен, чтобы V8 не делил бюджет оптимизации между несколькими wasm-модулями
// и чтобы планировщик не переносил уже разогретый процесс на другое ядро.
//
//   node builds/bench-one.mjs <engine-id>
//
// Печатает JSON в stdout. Тесты выполняются здесь же: если сборка сломана,
// процесс завершается с ненулевым кодом.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmark, missingExports, runTests, WORKLOAD_OPS } from '../assets/protocol.js';
import { ENGINES } from './engines.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const engine = ENGINES.find((e) => e.id === id);

if (!engine) {
  console.error(`неизвестная сборка: ${id}`);
  process.exit(1);
}

try {
  const filePath = path.join(root, 'projects/calculator', engine.file);
  const bytes = fs.readFileSync(filePath);
  if (!WebAssembly.validate(bytes)) throw new Error(`${engine.file}: invalid wasm`);

  const mod = new WebAssembly.Module(bytes);
  const imports = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    (imports[imp.module] ||= {})[imp.name] = () => {};
  }
  const { exports } = await WebAssembly.instantiate(mod, imports);

  const missing = missingExports(exports);
  if (missing.length) throw new Error(`${engine.file}: missing exports: ${missing.join(', ')}`);

  const tests = runTests(exports);
  if (tests.failed?.length || tests.passed !== tests.total) {
    throw new Error(`${engine.file}: tests failed\n${tests.failures.join('\n')}`);
  }

  const perf = benchmark(exports, { rounds: 7, durationMs: 150, warmupMs: 500 });

  console.log(JSON.stringify({
    id,
    tests: { passed: tests.passed, total: tests.total },
    perf: {
      opsPerSec: Math.round(perf.opsPerSec),
      samples: perf.samples.map((v) => Math.round(v)),
      workloadOps: WORKLOAD_OPS,
    },
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
