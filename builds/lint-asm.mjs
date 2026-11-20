#!/usr/bin/env node
/**
 * Low-Level & Macro-ASM Static Linter / Validator
 * Scans assembly (.S) and low-level systems C files for microarchitectural
 * antipatterns, ABI traps, and LLM cognitive biases.
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

const RULES = [
  {
    id: 'ASM-001',
    name: 'Hardware Division Latency Trap',
    severity: 'error',
    description: 'Hardware division (idiv/div) causes 35-40 cycle CPU stalls. Use multiplicative inverse (e.g. Lemire/Granlund imul).',
    files: [/\.S$/, /\.asm$/],
    check: (line, lineNum) => {
      const match = line.match(/\b(idiv|div)\b\s+([a-z0-9]+)/i);
      if (match && !line.includes('// ignore-lint') && !line.includes('/* ignore-lint */')) {
        return `Instruction '${match[0]}' has 35-40 cycle latency. Replace with Lemire/Granlund multiplicative reduction (e.g. imul reg, 0xcccccccd).`;
      }
      return null;
    }
  },
  {
    id: 'ASM-002',
    name: 'Heavy Libc/CRT In Fast Path',
    severity: 'error',
    description: 'Calling heavy libc functions (memmove/memcpy/sprintf/malloc) in high-throughput paths degrades latency.',
    files: [/\.S$/, /\.c$/],
    check: (line, lineNum) => {
      // In C or ASM, check for memmove/memcpy calls in fast-path contexts unless shielded
      if (/\bcall\s+(memmove|memcpy|sprintf|strlen|malloc)\b/i.test(line) && !line.includes('// allow-crt')) {
        return `Direct call to CRT function in assembly. Replace with AVX2 vector instructions (vmovups) or stack allocation.`;
      }
      return null;
    }
  },
  {
    id: 'ASM-003',
    name: 'Linux struct epoll_event Layout Trap',
    severity: 'error',
    description: 'Linux x86-64 struct epoll_event is __packed__ (12 bytes, data at offset +4). Assuming 16 bytes or offset +8 causes fatal segfaults.',
    files: [/linux.*\.S$/i],
    check: (line, lineNum) => {
      // Check for accessing epoll_event data at offset +8
      if (/\b(mov|lea)\b.*\[.*(\+\s*8|\b8\b)\].*epoll/i.test(line) ||
          (/epoll_wait/i.test(line) && /\[.*\+\s*8\]/.test(line))) {
        return `Detected potential offset +8 for struct epoll_event. Linux x86-64 struct epoll_event is __packed__ (size 12, data at offset +4).`;
      }
      // Check for 16-byte stride indexing (e.g. shl reg, 4)
      if (/shl\s+[a-z0-9]+,\s*4/i.test(line) && /event/i.test(line)) {
        return `Detected 16-byte stride (shl 4) on epoll_event array. Size is 12 bytes; step with lea rax, [reg + reg*2]; shl rax, 2.`;
      }
      return null;
    }
  },
  {
    id: 'ASM-004',
    name: 'Cross-TU Stack Spill Anti-Pattern',
    severity: 'warning',
    description: 'Passing output pointers to stack memory (&var) across translation unit function calls causes memory clobber spills.',
    files: [/\.c$/],
    check: (line, lineNum, prevLines) => {
      if (/asm_handle_request\s*\(.*,\s*&[a-z0-9_]+\s*\)/i.test(line)) {
        return `Passing output parameter via pointer (&var) to ASM kernel. Return new length/offset directly in register EAX to prevent stack spill.`;
      }
      return null;
    }
  },
  {
    id: 'ASM-005',
    name: 'Missing Edge-Trigger Zero-Latency Accept Path',
    severity: 'warning',
    description: 'Edge-triggered epoll (EPOLLET) can stall if initial client HTTP packet arrived during handshake. Immediate read on accept is required.',
    files: [/linux_server\.S$/],
    checkFile: (content) => {
      if (content.includes('EPOLLET') && !content.includes('accept_fast_read') && !content.includes('sys_read') && !content.includes('read_request')) {
        return `Server uses EPOLLET but lacks an immediate zero-latency read after accept. Data arriving during TCP handshake may cause 2000ms timeouts.`;
      }
      return null;
    }
  }
];

const TARGET_FILES = [
  'projects/http/asm/linux_server.S',
  'projects/http/asm/http_macro.S',
  'projects/http/asm/server_mt.c',
  'projects/http/arena/frameworks/asm/linux_server.S',
  'native/vm_macro.S'
];

function lintFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { filePath, missing: true, issues: [] };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  for (const rule of RULES) {
    // Check whole-file rule
    if (rule.checkFile) {
      const matchFile = rule.files ? rule.files.some(re => re.test(filePath)) : true;
      if (matchFile) {
        const msg = rule.checkFile(content);
        if (msg) {
          issues.push({
            ruleId: rule.id,
            name: rule.name,
            severity: rule.severity,
            lineNum: 0,
            lineText: '',
            message: msg
          });
        }
      }
    }

    // Check line-by-line rules
    if (rule.check) {
      const matchFile = rule.files.some(re => re.test(filePath));
      if (!matchFile) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prevLines = lines.slice(Math.max(0, i - 3), i);
        const msg = rule.check(line, i + 1, prevLines);
        if (msg) {
          issues.push({
            ruleId: rule.id,
            name: rule.name,
            severity: rule.severity,
            lineNum: i + 1,
            lineText: line.trim(),
            message: msg
          });
        }
      }
    }
  }

  return { filePath, missing: false, issues };
}

function run() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}=== Macro-ASM & Low-Level Code Validator ===${ANSI.reset}\n`);

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesChecked = 0;

  for (const file of TARGET_FILES) {
    const result = lintFile(file);
    if (result.missing) {
      console.log(`  ${ANSI.gray}Skipped (not found): ${file}${ANSI.reset}`);
      continue;
    }

    filesChecked++;
    const errors = result.issues.filter(i => i.severity === 'error');
    const warnings = result.issues.filter(i => i.severity === 'warning');

    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (result.issues.length === 0) {
      console.log(`  ${ANSI.green}✓ PASS${ANSI.reset}  ${file}`);
    } else {
      console.log(`  ${errors.length > 0 ? ANSI.red + '✗ FAIL' : ANSI.yellow + '⚠ WARN'}${ANSI.reset}  ${file}`);
      for (const issue of result.issues) {
        const color = issue.severity === 'error' ? ANSI.red : ANSI.yellow;
        const tag = issue.severity.toUpperCase();
        console.log(`    ${color}[${tag}] ${issue.ruleId} ${issue.name}${ANSI.reset}`);
        if (issue.lineNum > 0) {
          console.log(`    Line ${issue.lineNum}: ${ANSI.gray}${issue.lineText}${ANSI.reset}`);
        }
        console.log(`    ${ANSI.bold}Detail:${ANSI.reset} ${issue.message}\n`);
      }
    }
  }

  console.log(`\n${ANSI.bold}Summary:${ANSI.reset} Checked ${filesChecked} files. ${totalErrors === 0 ? ANSI.green : ANSI.red}${totalErrors} errors${ANSI.reset}, ${totalWarnings === 0 ? ANSI.green : ANSI.yellow}${totalWarnings} warnings${ANSI.reset}.\n`);

  if (totalErrors > 0) {
    console.log(`${ANSI.red}${ANSI.bold}Lint check failed! Address the architectural errors above.${ANSI.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${ANSI.green}${ANSI.bold}All low-level invariants verified successfully!${ANSI.reset}\n`);
    process.exit(0);
  }
}

run();
