#!/usr/bin/env node
/**
 * Autonomous LLM Optimization Harness (Runner)
 * Executes closed-loop evolutionary benchmarking for low-level systems code.
 * Supports direct API integration with polza.ai frontier models.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
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
let taskId = 'duel3-stack-vm';
let modelName = 'google/gemini-4-carbon';
let maxIters = 4;
let mode = 'api'; // 'api' | 'replay'
let inputFile = null;
let apiKey = process.env.POLZA_API_KEY || 'pza_o0s35kdIJ9wRuOd8t0tkjgsKSqQqV7HH';

for (const arg of args) {
  if (arg.startsWith('--task=')) taskId = arg.split('=')[1];
  else if (arg.startsWith('--model=')) modelName = arg.split('=')[1];
  else if (arg.startsWith('--max-iters=')) maxIters = parseInt(arg.split('=')[1], 10);
  else if (arg.startsWith('--mode=')) mode = arg.split('=')[1];
  else if (arg.startsWith('--input=')) inputFile = arg.split('=')[1];
  else if (arg.startsWith('--api-key=')) apiKey = arg.split('=')[1];
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
console.log(`Max Iters:   ${maxIters}\n`);

const telemetry = {
  task: task.id,
  model: modelName,
  startTime: new Date().toISOString(),
  iterations: [],
  converged: false,
  totalTokens: { input: 0, output: 0, cost_rub: 0 },
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

function extractCodeBlock(text) {
  let code = text;
  const match = text.match(/`{3,}(?:assembly|asm|s)?\s*\n?([\s\S]*?)`{3,}/i);
  if (match) {
    code = match[1];
  }
  code = code.replace(/^`+[a-zA-Z0-9_-]*\s*\n?/m, '').replace(/\n?`+$/m, '').trim();
  return code;
}

function callPolzaApi(model, messages, maxTokens = 65536) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    });

    const req = https.request({
      hostname: 'api.polza.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`API Error: ${JSON.stringify(json.error)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Conversation history for multi-turn optimization
const conversation = [];

async function getCandidateCode(iter, previousFeedback) {
  if (mode === 'replay') {
    const sourceFile = inputFile || 'harness/sandbox/candidate_vm.S';
    console.log(`${ANSI.gray}[Iteration ${iter}] Replaying code from: ${sourceFile}${ANSI.reset}`);
    return fs.readFileSync(sourceFile, 'utf8');
  }

  if (mode === 'api') {
    const specPrompt = fs.readFileSync(path.resolve(task.prompt), 'utf8');
    const skillContent = fs.readFileSync(path.resolve('skills/macro-asm-synthesis/SKILL.md'), 'utf8');

    if (iter === 1) {
      conversation.push({
        role: 'system',
        content: `You are an elite, world-class assembly and systems optimization engineer.\n\n${skillContent}`
      });
      conversation.push({
        role: 'user',
        content: specPrompt
      });
    } else {
      conversation.push({
        role: 'user',
        content: `Your previous implementation failed validation or did not meet the hardware performance target.\n\n${previousFeedback}\n\nPlease analyze the failure and provide the complete revised assembly code enclosed in \`\`\`assembly ... \`\`\`. Retain 100% control over physical registers, use direct threading, and ensure zero clobber spills.`
      });
    }

    console.log(`  ${ANSI.cyan}Calling polza.ai API (${modelName})...${ANSI.reset}`);
    const t0 = Date.now();
    const response = await callPolzaApi(modelName, conversation);
    const durationSec = ((Date.now() - t0) / 1000).toFixed(1);

    const usage = response.usage || {};
    telemetry.totalTokens.input += (usage.prompt_tokens || 0);
    telemetry.totalTokens.output += (usage.completion_tokens || 0);
    telemetry.totalTokens.cost_rub += (usage.cost_rub || 0);

    const costStr = usage.cost_rub ? `${usage.cost_rub.toFixed(2)} ₽` : 'N/A';
    console.log(`  ${ANSI.green}✓ Response received in ${durationSec}s${ANSI.reset} (Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out, Cost: ${costStr})`);

    const assistantMsg = (response.choices?.[0]?.message?.content && response.choices?.[0]?.message?.content.trim())
      ? response.choices[0].message.content
      : (response.choices?.[0]?.message?.reasoning || '');
    conversation.push({ role: 'assistant', content: assistantMsg });

    return extractCodeBlock(assistantMsg);
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

async function evaluateCandidate(code, iter) {
  console.log(`\n${ANSI.bold}--- Iteration ${iter}: Evaluation Gate ---${ANSI.reset}`);

  // Write candidate code to sandbox
  const outPath = path.resolve(task.output_file);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code, 'utf8');

  const record = {
    iteration: iter,
    timestamp: new Date().toISOString(),
    linterPassed: false,
    buildPassed: false,
    verified: false,
    cyclesPerOp: 0,
    macroCyclesPerOp: 0,
    cppCyclesPerOp: 0,
    speedupPercent: 0,
    parityAchieved: false,
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
  console.log(`  ${ANSI.green}✓ Gate 1 Passed (Invariants checked)${ANSI.reset}`);

  // GATE 2: Build
  console.log(`  [Gate 2] Compiling candidate with Clang -O3...`);
  const buildRes = runCommandSync(task.build_command);
  if (!buildRes.success) {
    console.log(`  ${ANSI.red}✗ Gate 2 Failed: Compilation error${ANSI.reset}`);
    record.errors.push('BUILD_FAILED: ' + buildRes.output.trim());
    record.feedback = `[Compilation Error]\n${buildRes.output.trim()}`;
    return record;
  }
  record.buildPassed = true;
  console.log(`  ${ANSI.green}✓ Gate 2 Passed (Clean binary build)${ANSI.reset}`);

  // GATE 3 & 4: Correctness and Cycles Benchmark
  console.log(`  [Gate 3 & 4] Running hardware verification & cycle benchmark...`);
  const evalRes = runCommandSync(task.eval_command);

  try {
    const resJson = JSON.parse(evalRes.output.trim());
    record.verified = resJson.verified;

    if (!resJson.verified) {
      console.log(`  ${ANSI.red}✗ Gate 3 Failed: State verification error (${resJson.stage}): ${resJson.error}${ANSI.reset}`);
      record.errors.push(`VERIFY_FAILED: ${resJson.error}`);
      record.feedback = `[Verification Failure in ${resJson.stage}]\n${resJson.error}\nState did not match C++ reference. Ensure correct stack push/pop order and opcode semantics.`;
      return record;
    }

    console.log(`  ${ANSI.green}✓ Gate 3 Passed: 100% state match with C++ and Macro-ASM on all programs!${ANSI.reset}`);

    record.cppCyclesPerOp = resJson.cpp_cycles;
    record.macroCyclesPerOp = resJson.macro_cycles;
    record.cyclesPerOp = resJson.candidate_cycles;
    record.speedupPercent = resJson.speedup_percent;
    record.parityAchieved = resJson.parity_achieved;

    console.log(`  [Gate 4 Results]`);
    console.log(`    C++ (-O3) Baseline:      ${record.cppCyclesPerOp} cycles / op`);
    console.log(`    Macro-ASM Reference:     ${ANSI.bold}${record.macroCyclesPerOp} cycles / op${ANSI.reset}`);
    console.log(`    Candidate Assembly:      ${ANSI.bold}${record.cyclesPerOp} cycles / op${ANSI.reset} (Min: ${resJson.min_cycles} c)`);
    console.log(`    Speedup vs C++:          ${ANSI.bold}+${record.speedupPercent}%${ANSI.reset}`);
    console.log(`    Delta vs Macro-ASM:      ${ANSI.bold}${(record.cyclesPerOp - record.macroCyclesPerOp) >= 0 ? '+' : ''}${(record.cyclesPerOp - record.macroCyclesPerOp).toFixed(2)} cycles / op${ANSI.reset}`);

    if (record.parityAchieved) {
      record.converged = true;
      console.log(`\n${ANSI.green}${ANSI.bold}🎉 HARDWARE PARITY ACHIEVED! Candidate beats C++ by ${record.speedupPercent}% and matches Macro-ASM reference (<= 1.80 c/op)!${ANSI.reset}`);
    } else {
      record.converged = false;
      record.feedback = `[Performance Gap Feedback]\nFunctional correctness is 100% OK.\n` +
        `Current Speed: ${record.cyclesPerOp} cycles/op (Target: <= ${task.target.max_cycles_per_op} cycles/op, Macro-ASM Baseline: ${record.macroCyclesPerOp} c/op).\n` +
        `Speedup vs C++: +${record.speedupPercent}% (Target: >= ${task.target.min_speedup_percent}%).\n` +
        `Gap: Candidate is slower than target by ${(record.cyclesPerOp - task.target.max_cycles_per_op).toFixed(2)} cycles/op.\n` +
        `Optimization guidance: Ensure operand stack pointer 'sp' and Top-of-Stack are cached in physical CPU registers, eliminate any memory round-trips in DISPATCH macro, and use direct-threaded jump table.`;
    }

  } catch (e) {
    console.log(`  ${ANSI.red}✗ Gate 3 & 4 Failed: Runner crashed: ${evalRes.output.trim()}${ANSI.reset}`);
    record.errors.push('RUNNER_CRASH: ' + evalRes.output.trim());
    record.feedback = `[Execution Crash]\n${evalRes.output.trim()}`;
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
  const safeModel = modelName.replace(/[\/:]/g, '_');
  const teleFile = path.resolve(`harness/telemetry/run_${taskId}_${safeModel}_${timestamp}.json`);
  fs.writeFileSync(teleFile, JSON.stringify(telemetry, null, 2), 'utf8');
  console.log(`\nTelemetry saved to: ${ANSI.cyan}${teleFile}${ANSI.reset}`);
  console.log(`Total Token Cost: ${ANSI.bold}${telemetry.totalTokens.cost_rub.toFixed(2)} ₽${ANSI.reset} (${telemetry.totalTokens.input} in / ${telemetry.totalTokens.output} out)\n`);

  process.exit(telemetry.converged ? 0 : 1);
}

runHarness().catch(err => {
  console.error(`${ANSI.red}Harness fatal error:${ANSI.reset}`, err);
  process.exit(1);
});
