// Парные блоки: в каждом блоке все сборки измеряются по одному разу
// в случайном порядке, каждая — в своём процессе. Порядок внутри блока
// рандомизирован, поэтому дрейф машины во времени попадает в блок, а не
// в конкретную реализацию. Отношение считается внутри блока.
//
//   node builds/paired.mjs                 калькулятор, 12 блоков
//   node builds/paired.mjs vm 12 20261119  проект, блоки, seed
//
// Пишет data/paired-<slug>.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectBySlug, PROJECTS } from './projects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = PROJECTS[process.argv[2]] ? process.argv[2] : 'calculator';
const project = projectBySlug(slug);
const blocks = Number(process.argv[3] ?? 12);
const seed = Number(process.argv[4] ?? 20261119);
const benchOne = path.join(root, 'builds', 'bench-one.mjs');
const outFile = path.join(root, 'data', `paired-${slug}.json`);
const REFERENCE = 'cpp-opt';

if (!Number.isInteger(blocks) || blocks < 4) throw new Error('blocks must be an integer >= 4');

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seed);
const engineIds = project.engines.map((e) => e.id);

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function runOne(id) {
  const result = spawnSync(process.execPath, [benchOne, slug, id], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCH_WARMUP_MS: String(project.bench.warmupMs),
      BENCH_ROUNDS: String(project.bench.rounds),
      BENCH_DURATION_MS: String(project.bench.durationMs),
    },
  });
  if (result.status !== 0) {
    throw new Error(`${id}: ${result.stderr || result.stdout || 'bench failed'}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (parsed.perf.samples.length !== project.bench.rounds) {
    throw new Error(`${id}: expected ${project.bench.rounds} rounds, got ${parsed.perf.samples.length}`);
  }
  return {
    median: parsed.perf.stats.median,
    samples: parsed.perf.samples,
    tests: parsed.tests,
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function bootstrapMedianCI(values, iterations = 10000) {
  const medians = [];
  for (let i = 0; i < iterations; i++) {
    const sample = [];
    for (let j = 0; j < values.length; j++) {
      sample.push(values[Math.floor(random() * values.length)]);
    }
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  return [
    medians[Math.floor(iterations * 0.025)],
    medians[Math.floor(iterations * 0.975)],
  ];
}

const runs = [];
for (let b = 0; b < blocks; b++) {
  const order = shuffle(engineIds);
  const block = {};
  process.stdout.write(`блок ${b + 1}/${blocks}: `);
  for (const id of order) {
    const result = runOne(id);
    block[id] = result.median;
    process.stdout.write(`${id} ${Math.round(result.median).toLocaleString('ru-RU')}  `);
  }
  process.stdout.write('\n');
  runs.push({ index: b, order, medians: block });
}

const refBlocks = runs.map((r) => r.medians[REFERENCE]);
if (refBlocks.some((v) => !v)) throw new Error(`reference ${REFERENCE} missing`);

const summary = project.engines.map((engine) => {
  const values = runs.map((r) => r.medians[engine.id]);
  const paired = values.map((v, i) => v / runs[i].medians[REFERENCE]);
  const ci = bootstrapMedianCI(paired);
  return {
    id: engine.id,
    name: engine.name,
    blocks: values,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    ratio: {
      median: median(paired),
      lo: ci[0],
      hi: ci[1],
      wins: paired.filter((v) => v > 1).length,
      total: paired.length,
    },
  };
});

const result = {
  project: project.slug,
  generatedAt: new Date().toISOString(),
  seed,
  blocks,
  reference: REFERENCE,
  method:
    `paired randomized blocks: ${blocks} blocks, each block measures every build once in a randomized order; ` +
    `one fresh Node process per build (${project.bench.warmupMs} ms warmup, ` +
    `${project.bench.rounds} rounds x ${project.bench.durationMs} ms); ` +
    `ratio = build ops/sec / ${REFERENCE} ops/sec within the same block; ` +
    'median ratio with 10 000-resample bootstrap 95% interval; wins = blocks where build is faster than reference',
  environment: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  },
  runs,
  engines: summary,
};

fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');

const pctFmt = (ratio) => `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)} %`;
console.log('\n| Реализация | медиана/с | к C++ -O3 | 95 % ДИ | быстрее |');
console.log('|---|---:|---:|---:|---:|');
for (const e of summary) {
  const r = e.ratio;
  console.log(
    `| ${e.name} | ${Math.round(e.median).toLocaleString('ru-RU')} | ${pctFmt(r.median)} | ` +
      `${pctFmt(r.lo)} … ${pctFmt(r.hi)} | ${r.wins}/${r.total} |`,
  );
}
console.log(`\nзаписано: ${path.relative(root, outFile)}`);
