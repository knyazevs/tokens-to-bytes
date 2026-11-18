// Измеряет все реализации калькулятора и пишет data/calculator.json:
// размер, gzip/brotli, тесты, производительность, токены.
//
// Производительность меряется в изолированных процессах (builds/bench-one.mjs):
// один Node-процесс — одна сборка. Если держать несколько горячих wasm-модулей
// в одном процессе, V8 не успевает поднять оптимизацию для всех, и последняя
// измеряемая сборка проседает в 2–3 раза. Это артефакт замера, а не кода.
//
//   node builds/measure.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { ENGINES } from './engines.mjs';
import { describeStats } from '../assets/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchOne = path.join(root, 'builds', 'bench-one.mjs');
const outFile = path.join(root, 'data', 'calculator.json');
const tokensFile = path.join(root, 'data', 'tokens.json');

const REPEATS = Number(process.env.REPEATS ?? 6);
const affinity = process.env.AFFINITY ?? null;
const BENCH = { warmupMs: 750, rounds: 10, durationMs: 150 };

const tokens = fs.existsSync(tokensFile)
  ? JSON.parse(fs.readFileSync(tokensFile, 'utf8'))
  : { tokenizer: null, engines: {} };

const brotliOpts = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };

function measureIsolated(engine) {
  const samples = [];
  const runs = [];
  let tests = null;

  for (let i = 0; i < REPEATS; i++) {
    const result = spawnSync(process.execPath, [benchOne, engine.id], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BENCH_WARMUP_MS: String(BENCH.warmupMs),
        BENCH_ROUNDS: String(BENCH.rounds),
        BENCH_DURATION_MS: String(BENCH.durationMs),
      },
    });
    if (result.status !== 0) {
      throw new Error(`${engine.id}: ${result.stderr || result.stdout || 'bench failed'}`);
    }
    const parsed = JSON.parse(result.stdout);
    if (parsed.perf.samples.length !== BENCH.rounds) {
      throw new Error(`${engine.id}: expected ${BENCH.rounds} rounds, got ${parsed.perf.samples.length}`);
    }
    tests = parsed.tests;
    runs.push(parsed.perf.opsPerSec);
    samples.push(...parsed.perf.samples);
  }

  return { tests, samples, runs };
}

const engines = [];

for (const engine of ENGINES) {
  const filePath = path.join(root, 'projects/calculator', engine.file);
  const bytes = fs.readFileSync(filePath);
  if (!WebAssembly.validate(bytes)) throw new Error(`${engine.file}: invalid wasm`);

  const { tests, samples, runs } = measureIsolated(engine);
  if (tests.failed?.length || tests.passed !== tests.total) {
    throw new Error(`${engine.file}: tests failed ${tests.passed}/${tests.total}`);
  }

  const stats = describeStats(samples);
  const t = tokens.engines[engine.id] ?? null;

  engines.push({
    ...engine,
    bytes: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, brotliOpts).length,
    tests: { passed: tests.passed, total: tests.total },
    perf: {
      opsPerSec: Math.round(stats.median),
      samples: samples.map((v) => Math.round(v)),
      runs: runs.map((v) => Math.round(v)),
      stats: {
        min: Math.round(stats.min),
        max: Math.round(stats.max),
        mean: Math.round(stats.mean),
        median: Math.round(stats.median),
        stddev: Math.round(stats.stddev),
      },
      isolated: true,
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

  console.log(
    `${engine.id.padEnd(8)} ${(engines.at(-1).perf.opsPerSec / 1e6).toFixed(1)}M ` +
      `[${(stats.min / 1e6).toFixed(1)}–${(stats.max / 1e6).toFixed(1)}M] ` +
      `(runs: ${runs.map((v) => (v / 1e6).toFixed(1)).join(' / ')})`,
  );
}

const result = {
  project: 'calculator',
  protocol: 4,
  method:
    `process-per-build: ${BENCH.warmupMs} ms warmup, ${BENCH.rounds} rounds x ${BENCH.durationMs} ms, ` +
    `${REPEATS} fresh Node processes, ${REPEATS * BENCH.rounds} samples; ` +
    'min/mean/median/max/stddev reported, median as headline' +
    (affinity ? `; process pinned to cores 0x${affinity} to avoid E-core migration` : ''),
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    affinity,
    tokenizer: tokens.tokenizer,
  },
  engines,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');

console.log('\n| Реализация | .wasm | gzip | brotli | тесты | мин | среднее | медиана | макс | σ | токены |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const e of engines) {
  const s = e.perf.stats;
  const m = (v) => (v / 1e6).toFixed(1);
  console.log(
    `| ${e.name} | ${e.bytes} Б | ${e.gzip} Б | ${e.brotli} Б | ${e.tests.passed}/${e.tests.total} | ` +
      `${m(s.min)}M | ${m(s.mean)}M | **${m(s.median)}M** | ${m(s.max)}M | ${(s.stddev / 1e6).toFixed(1)}M | ` +
      `${e.tokens ? e.tokens.artifact : '—'} |`,
  );
}
console.log(`\nзаписано: ${path.relative(root, outFile)}`);
