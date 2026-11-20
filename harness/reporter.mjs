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
  magenta: '\x1b[35m',
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
    const macroRef = lastIter.macroCyclesPerOp || 1.56;
    const candCycles = lastIter.cyclesPerOp || 0;
    const deltaMacro = candCycles ? `${(candCycles - macroRef) >= 0 ? '+' : ''}${(candCycles - macroRef).toFixed(2)} c` : 'N/A';

    rows.push({
      file,
      task: data.task,
      model: data.model,
      converged: data.converged,
      iters: data.iterations.length,
      verified: lastIter.verified ? '100% OK' : 'FAILED',
      cycles: candCycles ? `${candCycles} c` : 'N/A',
      speedupCpp: lastIter.speedupPercent ? `+${lastIter.speedupPercent}%` : 'N/A',
      deltaMacro: deltaMacro,
      costRub: data.totalTokens?.cost_rub ? `${data.totalTokens.cost_rub.toFixed(2)} ₽` : '0 ₽'
    });
  } catch {}
}

console.log('| Model / Run | Task | Status | Iters | Correctness | Cycles / Op | vs C++ (-O3) | vs Macro-ASM Ref (1.56 c) | Cost (₽) |');
console.log('| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
for (const r of rows) {
  const status = r.converged ? `${ANSI.green}PARITY (WIN)${ANSI.reset}` : `${ANSI.red}FAILED${ANSI.reset}`;
  console.log(`| ${r.model} | ${r.task} | ${status} | ${r.iters} | ${r.verified} | ${r.cycles} | ${r.speedupCpp} | ${r.deltaMacro} | ${r.costRub} |`);
}
console.log('\n');
