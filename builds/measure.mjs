// Измеряет все реализации калькулятора и пишет data/calculator.json:
// размер, gzip/brotli, тесты, производительность, токены.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { ENGINES } from './engines.mjs';
import { benchmark, missingExports, runTests, WORKLOAD_OPS } from '../assets/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'data', 'calculator.json');
const tokensFile = path.join(root, 'data', 'tokens.json');

const tokens = fs.existsSync(tokensFile)
  ? JSON.parse(fs.readFileSync(tokensFile, 'utf8'))
  : { tokenizer: null, engines: {} };

const brotliOpts = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };

async function loadWasm(bytes) {
  const mod = new WebAssembly.Module(bytes);
  const imports = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    (imports[imp.module] ||= {})[imp.name] = () => {};
  }
  const instance = await WebAssembly.instantiate(mod, imports);
  return instance.exports;
}

const engines = [];
for (const engine of ENGINES) {
  const filePath = path.join(root, 'projects/calculator', engine.file);
  const bytes = fs.readFileSync(filePath);

  if (!WebAssembly.validate(bytes)) throw new Error(`${engine.file}: invalid wasm`);

  const exports = await loadWasm(bytes);
  const missing = missingExports(exports);
  if (missing.length) throw new Error(`${engine.file}: missing exports: ${missing.join(', ')}`);

  const tests = runTests(exports);
  if (tests.failed?.length || tests.passed !== tests.total) {
    throw new Error(`${engine.file}: tests failed\n${tests.failures.join('\n')}`);
  }

  const perf = benchmark(exports);
  const t = tokens.engines[engine.id] ?? null;

  engines.push({
    ...engine,
    bytes: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, brotliOpts).length,
    tests: { passed: tests.passed, total: tests.total },
    perf: {
      opsPerSec: Math.round(perf.opsPerSec),
      samples: perf.samples.map((v) => Math.round(v)),
      workloadOps: WORKLOAD_OPS,
    },
    tokens: t
      ? {
          artifact: t.artifactTokens,
          artifactFile: t.authoringFile,
          artifactBytes: t.authoringBytes,
          base64: t.binaryBase64Tokens,
        }
      : null,
  });

  console.log(`ok ${engine.name}: ${bytes.length} B, ${tests.passed}/${tests.total} tests, ${Math.round(perf.opsPerSec)} ops/s`);
}

const result = {
  project: 'calculator',
  protocol: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    tokenizer: tokens.tokenizer,
  },
  engines,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');

console.log('\n| Реализация | .wasm | gzip | brotli | тесты | ops/sec | токены |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const e of engines) {
  console.log(`| ${e.name} | ${e.bytes} Б | ${e.gzip} Б | ${e.brotli} Б | ${e.tests.passed}/${e.tests.total} | ${e.perf.opsPerSec.toLocaleString('ru-RU')} | ${e.tokens ? e.tokens.artifact : '—'} |`);
}
console.log(`\nзаписано: ${path.relative(root, outFile)}`);
