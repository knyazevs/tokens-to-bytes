#!/usr/bin/env node
/**
 * Autonomous LLM Optimization Harness (Runner)
 * Executes closed-loop evolutionary benchmarking for low-level systems code.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

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

const CONFIG_PATH = path.resolve('harness/config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
let taskId = 'http-engine-linux';
let modelName = 'baseline-ref';
let maxIters = 5;
let mode = 'replay'; // 'replay' | 'api' | 'manual'
let inputFile = null;

for (const arg of args) {
  if (arg.startsWith('--task=')) taskId = arg.split('=')[1];
  else if (arg.startsWith('--model=')) modelName = arg.split('=')[1];
  else if (arg.startsWith('--max-iters=')) maxIters = parseInt(arg.split('=')[1], 10);
  else if (arg.startsWith('--mode=')) mode = arg.split('=')[1];
  else if (arg.startsWith('--input=')) inputFile = arg.split('=')[1];
}

const task = config.tasks[taskId];
if (!task) {
  console.error(`${ANSI.red}Unknown task ID: ${taskId}${ANSI.reset}`);
  console.log(`Available tasks: ${Object.keys(config.tasks).join(', ')}`);
  process.exit(1);
}

console.log(`\n${ANSI.bold}${ANSI.cyan}======================================================${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.cyan}  Autonomous LLM Low-Level Optimization Harness       ${ANSI.reset}`);
console.log(`${ANSI.bold}${ANSI.cyan}======================================================${ANSI.reset}`);
console.log(`Task:        ${ANSI.bold}${task.name}${ANSI.reset} (${task.id})`);
console.log(`Model:       ${ANSI.bold}${modelName}${ANSI.reset}`);
console.log(`Mode:        ${ANSI.bold}${mode}${ANSI.reset}`);
console.log(`Max Iters:   ${maxIters}`);
console.log(`Target RPS:  ${task.target.min_rps || 'N/A'}`);
console.log(`Target Size: ${task.target.max_binary_size_bytes || 'N/A'} bytes\n`);

const telemetry = {
  task: task.id,
  model: modelName,
  startTime: new Date().toISOString(),
  iterations: [],
  converged: false,
  totalTokens: { input: 0, output: 0 },
  finalMetrics: null
};

function runCommandSync(cmd, cwd = process.cwd(), timeoutMs = 25000) {
  try {
    const stdout = execSync(cmd, { cwd, timeout: timeoutMs, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: stdout, code: 0 };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || '') + '\n' + (err.stderr || err.message),
      code: err.status || 1
    };
  }
}

async function getCandidateCode(iter, previousFeedback) {
  if (mode === 'replay') {
    const sourceFile = inputFile || 'projects/http/asm/linux_server.S';
    console.log(`${ANSI.gray}[Iteration ${iter}] Replaying code from: ${sourceFile}${ANSI.reset}`);
    return fs.readFileSync(sourceFile, 'utf8');
  }

  if (mode === 'api') {
    throw new Error('API mode requires configured model endpoint.');
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

async function evaluateCandidate(code, iter) {
  console.log(`\n${ANSI.bold}--- Iteration ${iter}: Evaluation Gate ---${ANSI.reset}`);
  
  // Cleanup any lingering server on port
  runCommandSync(`wsl fuser -k ${task.port}/tcp 2>/dev/null || true`);

  // Write candidate code to sandbox
  const outPath = path.resolve(task.output_file);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code, 'utf8');

  const record = {
    iteration: iter,
    timestamp: new Date().toISOString(),
    linterPassed: false,
    buildPassed: false,
    testsPassed: 0,
    testsTotal: task.target.tests_passed,
    binarySizeBytes: 0,
    rps: 0,
    p99LatencyUs: 0,
    errors: [],
    feedback: ''
  };

  // GATE 1: Static Linter
  console.log(`  [Gate 1] Running Macro-ASM Static Linter...`);
  const lintRes = runCommandSync(`node builds/lint-asm.mjs`);
  if (!lintRes.success) {
    console.log(`  ${ANSI.red}✗ Gate 1 Failed: Linter violations detected${ANSI.reset}`);
    record.errors.push('LINTER_FAILED: ' + lintRes.output.trim());
    record.feedback = `[Linter Feedback]\n${lintRes.output.trim()}`;
    return record;
  }
  record.linterPassed = true;
  console.log(`  ${ANSI.green}✓ Gate 1 Passed (Zero CRT, no heavy divisions, packed ABI layout)${ANSI.reset}`);

  // GATE 2: Build
  console.log(`  [Gate 2] Compiling bare-metal binary...`);
  const buildRes = runCommandSync(task.build_command);
  if (!buildRes.success) {
    console.log(`  ${ANSI.red}✗ Gate 2 Failed: Compilation error${ANSI.reset}`);
    record.errors.push('BUILD_FAILED: ' + buildRes.output.trim());
    record.feedback = `[Compilation Error]\n${buildRes.output.trim()}`;
    return record;
  }
  record.buildPassed = true;
  console.log(`  ${ANSI.green}✓ Gate 2 Passed (Clean binary build)${ANSI.reset}`);

  // Measure binary size
  const binPath = path.resolve(task.binary_file);
  if (fs.existsSync(binPath)) {
    record.binarySizeBytes = fs.statSync(binPath).size;
    console.log(`  Binary size on disk: ${ANSI.bold}${record.binarySizeBytes} bytes${ANSI.reset}`);
  }

  // GATE 3: Correctness (Run server & test suite)
  console.log(`  [Gate 3] Starting server on port ${task.port} and running RFC test suite...`);
  const binWsl = task.wsl_binary || `/mnt/d/projects/wasm/${task.binary_file.replace(/\\/g, '/')}`;
  const serverProc = spawn('wsl', [binWsl, String(task.port)], {
    detached: true,
    stdio: 'ignore'
  });

  // Wait 600ms for workers to bind SO_REUSEPORT
  await new Promise(r => setTimeout(r, 600));

  let testRes = runCommandSync(task.test_command);
  try {
    process.kill(-serverProc.pid, 'SIGKILL');
  } catch {}
  runCommandSync(`wsl fuser -k ${task.port}/tcp 2>/dev/null || true`);

  try {
    const testJson = JSON.parse(testRes.output);
    record.testsPassed = testJson.passed;
    record.testsTotal = testJson.total;
    console.log(`  ${record.testsPassed === record.testsTotal ? ANSI.green : ANSI.red}RFC Tests Passed: ${record.testsPassed} / ${record.testsTotal}${ANSI.reset}`);
  } catch {
    console.log(`  ${ANSI.red}✗ Gate 3 Failed: Server crashed or failed tests${ANSI.reset}`);
    record.errors.push('TEST_FAILED: ' + testRes.output.trim());
    record.feedback = `[Test Suite Failure]\nServer did not respond or crashed:\n${testRes.output.trim()}`;
    return record;
  }

  if (record.testsPassed < task.target.tests_passed) {
    record.feedback = `[Test Failures]\nOnly ${record.testsPassed}/${record.testsTotal} passed. Verify Keep-Alive, Pipelining, and route parsing.`;
    return record;
  }

  // GATE 4: Performance Benchmark
  console.log(`  [Gate 4] Executing multi-core performance benchmark...`);
  const benchServerProc = spawn('wsl', [binWsl, String(task.port)], {
    detached: true,
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 600));

  const benchRes = runCommandSync(task.bench_command, process.cwd(), 35000);
  try {
    process.kill(-benchServerProc.pid, 'SIGKILL');
  } catch {}
  runCommandSync(`wsl fuser -k ${task.port}/tcp 2>/dev/null || true`);

  try {
    const benchJson = JSON.parse(benchRes.output);
    record.rps = benchJson.rps || 0;
    record.p99LatencyUs = benchJson.latencyUs?.p99 || 0;
  } catch {
    const rpsMatch = benchRes.output.match(/Throughput:\s*([0-9,]+)\s*req\/s/i) || benchRes.output.match(/([0-9,]+)\s*req\/s/);
    if (rpsMatch) record.rps = parseInt(rpsMatch[1].replace(/,/g, ''), 10);
    const p99Match = benchRes.output.match(/p99:\s*([0-9,]+)\s*µs/i);
    if (p99Match) record.p99LatencyUs = parseInt(p99Match[1].replace(/,/g, ''), 10);
  }

  console.log(`  Throughput:  ${ANSI.bold}${record.rps} req/s${ANSI.reset} (Target: >= ${task.target.min_rps})`);
  console.log(`  p99 Latency: ${record.p99LatencyUs} µs`);

  // Check Parity
  const meetsSize = record.binarySizeBytes <= task.target.max_binary_size_bytes;
  const meetsRps = record.rps >= task.target.min_rps;

  if (record.testsPassed === task.target.tests_passed && meetsSize && meetsRps) {
    record.converged = true;
    console.log(`\n${ANSI.green}${ANSI.bold}🎉 HARDWARE PARITY ACHIEVED! Candidate met all constraints!${ANSI.reset}`);
  } else {
    record.converged = false;
    record.feedback = `[Performance Gap Feedback]\nTests: ${record.testsPassed}/${record.testsTotal} OK.\n` +
      `Current RPS: ${record.rps} (Target: ${task.target.min_rps}, Gap: ${task.target.min_rps - record.rps} req/s).\n` +
      `Current Size: ${record.binarySizeBytes} B (Target: <= ${task.target.max_binary_size_bytes} B).\n` +
      `Optimize AVX2 buffer pipeline copies, register caching, and eliminate any remaining memory accesses.`;
  }

  return record;
}

async function runHarness() {
  let previousFeedback = null;

  for (let iter = 1; iter <= maxIters; iter++) {
    const code = await getCandidateCode(iter, previousFeedback);
    const evalResult = await evaluateCandidate(code, iter);
    telemetry.iterations.push(evalResult);

    if (evalResult.converged) {
      telemetry.converged = true;
      telemetry.finalMetrics = evalResult;
      break;
    }

    previousFeedback = evalResult.feedback;
    if (iter === maxIters) {
      console.log(`\n${ANSI.red}${ANSI.bold}Reached maximum iterations (${maxIters}) without achieving parity.${ANSI.reset}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const teleFile = path.resolve(`harness/telemetry/run_${taskId}_${modelName}_${timestamp}.json`);
  fs.writeFileSync(teleFile, JSON.stringify(telemetry, null, 2), 'utf8');
  console.log(`\nTelemetry saved to: ${ANSI.cyan}${teleFile}${ANSI.reset}`);
}

runHarness().catch(err => {
  console.error(`${ANSI.red}Harness fatal error:${ANSI.reset}`, err);
  process.exit(1);
});
