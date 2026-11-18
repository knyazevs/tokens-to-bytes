// Измеряет все реализации проекта и пишет его data-файл:
// размер, gzip/brotli, тесты, производительность, токены.
//
//   node builds/measure.mjs            калькулятор (по умолчанию)
//   node builds/measure.mjs json       JSON-парсер
//
// Производительность меряется в изолированных процессах (builds/bench-one.mjs):
// один Node-процесс — одна сборка. Если держать несколько горячих wasm-модулей
// в одном процессе, V8 не успевает поднять оптимизацию для всех, и последняя
// измеряемая сборка проседает в 2–3 раза. Это артефакт замера, а не кода.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { projectBySlug, PROJECTS } from './projects.mjs';
import { describeStats } from '../assets/bench-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = PROJECTS[process.argv[2]] ? process.argv[2] : 'calculator';
const project = projectBySlug(slug);
const benchOne = path.join(root, 'builds', 'bench-one.mjs');
const outFile = path.join(root, project.out);
const tokensFile = path.join(root, project.tokens);

const REPEATS = Number(process.env.REPEATS ?? 6);
const affinity = process.env.AFFINITY ?? null;
const BENCH = project.bench;

const tokens = fs.existsSync(tokensFile)
  ? JSON.parse(fs.readFileSync(tokensFile, 'utf8'))
  : { tokenizer: null, engines: {} };

const brotliOpts = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };

function measureIsolated(engine) {
  const samples = [];
  const runs = [];
  let tests = null;

  for (let i = 0; i < REPEATS; i++) {
    const result = spawnSync(process.execPath, [benchOne, slug, engine.id], {
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

for (const engine of project.engines) {
  const filePath = path.join(root, project.dir, engine.file);
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

  const scale = Math.max(stats.median, stats.min, stats.max) >= 1e6
    ? (v) => `${(v / 1e6).toFixed(1)}M`
    : (v) => `${(v / 1e3).toFixed(0)}k`;
  console.log(
    `${engine.id.padEnd(8)} ${scale(engines.at(-1).perf.opsPerSec)} ` +
      `[${scale(stats.min)}–${scale(stats.max)}] ` +
      `(runs: ${runs.map(scale).join(' / ')})`,
  );
}

const result = {
  project: project.slug,
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
  const scale = Math.max(s.median, s.min, s.max) >= 1e6 ? 1e6 : 1e3;
  const unit = scale === 1e6 ? 'M' : 'k';
  const m = (v) => (v / scale).toFixed(1);
  console.log(
    `| ${e.name} | ${e.bytes} Б | ${e.gzip} Б | ${e.brotli} Б | ${e.tests.passed}/${e.tests.total} | ` +
      `${m(s.min)}${unit} | ${m(s.mean)}${unit} | **${m(s.median)}${unit}** | ${m(s.max)}${unit} | ${(s.stddev / scale).toFixed(1)}${unit} | ` +
      `${e.tokens ? e.tokens.artifact : '—'} |`,
  );
}
console.log(`\nзаписано: ${path.relative(root, outFile)}`);
