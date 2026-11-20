#!/usr/bin/env node
/**
 * Harness Telemetry Reporter
 * Aggregates all test runs from harness/telemetry/ and prints a comparative benchmark table.
 */

import fs from 'fs';
import path from 'path';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const TELE_DIR = path.resolve('harness/telemetry');
if (!fs.existsSync(TELE_DIR)) {
  console.log('No telemetry directory found.');
  process.exit(0);
}

const files = fs.readdirSync(TELE_DIR).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.log('No telemetry runs found.');
  process.exit(0);
}

console.log(`\n${ANSI.bold}${ANSI.cyan}=== LLM Low-Level Optimization Benchmark Leaderboard ===${ANSI.reset}\n`);

const rows = [];

for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(TELE_DIR, file), 'utf8'));
    const lastIter = data.iterations[data.iterations.length - 1] || {};
    rows.push({
      file,
      task: data.task,
      model: data.model,
      converged: data.converged,
      iters: data.iterations.length,
      tests: `${lastIter.testsPassed || 0}/${lastIter.testsTotal || 0}`,
      size: lastIter.binarySizeBytes || 0,
      rps: lastIter.rps || 0,
      p99: lastIter.p99LatencyUs || 0
    });
  } catch {}
}

console.log('| Model / Run | Task | Status | Iters | RFC Tests | Binary Size | Throughput (RPS) | p99 Latency |');
console.log('| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
for (const r of rows) {
  const status = r.converged ? `${ANSI.green}PARITY (WIN)${ANSI.reset}` : `${ANSI.red}FAILED${ANSI.reset}`;
  console.log(`| ${r.model} | ${r.task} | ${status} | ${r.iters} | ${r.tests} | ${r.size} B | ${r.rps.toLocaleString()} req/s | ${r.p99} µs |`);
}
console.log('\n');
