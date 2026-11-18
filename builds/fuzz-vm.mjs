// Дифференциальный фаззер стековой VM: случайные программы исполняются
// эталонной моделью на JS и всеми шестью сборками. Сравниваются код возврата,
// ошибка, pc, шаги, глубина и вершина стека.
//
//   node builds/fuzz-vm.mjs           20 000 программ, seed 12345
//   node builds/fuzz-vm.mjs 100000 7  100 000 программ, seed 7
//
// Модель повторяет контракт builds/c/vm.c: проверка на загрузке, лимит шагов,
// кадры по 8 локалов, защита INT_MIN / −1 и те же коды ошибок.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, OP_NAMES, disassemble } from '../assets/vm-asm.js';
import { VM_ENGINES } from './vm-engines.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = Number(process.argv[2] ?? 20000);
const seed = Number(process.argv[3] ?? 12345);

const CODE_CAP = 4096;
const STACK_CAP = 1024;
const FRAME_CAP = 128;
const LOCALS = 8;
const STEP_CAP = 1000000;

function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seed);
const pick = (n) => Math.floor(random() * n);
const chance = (p) => random() < p;

const BINARY = [OPS.ADD, OPS.SUB, OPS.MUL, OPS.DIV, OPS.MOD, OPS.EQ, OPS.NE,
  OPS.LT, OPS.LE, OPS.GT, OPS.GE, OPS.AND, OPS.OR];
const JUMPS = [OPS.JMP, OPS.JZ, OPS.JNZ, OPS.CALL];

function encode(op, x = 0, y = 0, z = 0) {
  return [op, x, y, z];
}

function randomProgram() {
  const length = 3 + pick(38);
  const code = new Uint8Array(length * 4);

  for (let i = 0; i < length; i++) {
    let op;
    const r = random();
    if (r < 0.22) op = OPS.PUSH;
    else if (r < 0.52) op = BINARY[pick(BINARY.length)];
    else if (r < 0.62) {
      op = JUMPS[pick(JUMPS.length)];
    } else if (r < 0.72) op = chance(0.5) ? OPS.LOADL : OPS.STOREL;
    else if (r < 0.82) op = [OPS.POP, OPS.DUP, OPS.SWAP, OPS.NEG, OPS.NOT][pick(5)];
    else if (r < 0.92) op = OPS.HALT;
    else op = OPS.PUSH;

    const base = i * 4;
    code[base] = op;

    if (op === OPS.PUSH) {
      const bucket = pick(10);
      let value;
      if (bucket === 0) value = pick(2) ? 0x7fffff : -0x800000;
      else if (bucket < 3) value = pick(70000) - 35000;
      else value = pick(201) - 100;
      const bits = value & 0xffffff;
      code[base + 1] = (bits >> 16) & 0xff;
      code[base + 2] = (bits >> 8) & 0xff;
      code[base + 3] = bits & 0xff;
    } else if (JUMPS.includes(op)) {
      const target = pick(length);
      code[base + 1] = target & 0xff;
      code[base + 2] = (target >> 8) & 0xff;
    } else if (op === OPS.LOADL || op === OPS.STOREL) {
      code[base + 1] = pick(LOCALS);
    }
  }

  return code;
}

function randomBytes() {
  const length = 1 + pick(40);
  const code = new Uint8Array(length * 4);
  for (let i = 0; i < code.length; i++) code[i] = pick(256);
  // Половину байтов оставляем осмысленными, чтобы доходить до исполнения.
  if (chance(0.5)) {
    for (let i = 0; i < length; i++) code[i * 4] = OPS.PUSH;
  }
  return code;
}

function reference(code, cap = STEP_CAP) {
  const n = code.length / 4;
  const limit = cap <= 0 ? STEP_CAP : cap;

  if (n === 0) return { load: 12, pc: 0 };
  if (n > CODE_CAP) return { load: 8, pc: 0 };

  // загрузка
  for (let i = 0; i < n; i++) {
    const op = code[i * 4];
    if (op < 1 || op > 27) return { load: 1, pc: i };
    if (JUMPS.includes(op)) {
      const target = code[i * 4 + 1] | (code[i * 4 + 2] << 8);
      if (target >= n) return { load: 6, pc: i };
    } else if (op === OPS.LOADL || op === OPS.STOREL) {
      if (code[i * 4 + 1] >= LOCALS) return { load: 10, pc: i };
    }
  }
  if (n === 0) return { load: 12, pc: 0 };
  if (n > CODE_CAP) return { load: 8, pc: 0 };

  const values = new Int32Array(STACK_CAP);
  const frames = new Int32Array(FRAME_CAP * (LOCALS + 1));
  let sp = 0;
  let fp = 0;
  let pc = 0;
  let err = 0;
  let steps = 0;
  let halted = false;

  const fail = (codeN) => {
    err = codeN;
    pc -= 1;
    return true;
  };

  for (let v = 0; v < LOCALS; v++) frames[v + 1] = 0;

  while (steps < limit) {
    if (pc >= n) {
      err = 6;
      break;
    }
    const base = pc * 4;
    const op = code[base];
    const x = code[base + 1];
    pc += 1;

    if (op === OPS.PUSH) {
      let value = (code[base + 1] << 16) | (code[base + 2] << 8) | code[base + 3];
      if (value & 0x800000) value -= 0x1000000;
      if (sp >= STACK_CAP) { if (fail(3)) break; }
      values[sp++] = value;
    } else if (op === OPS.POP) {
      if (sp < 1) { if (fail(2)) break; }
      sp -= 1;
    } else if (op === OPS.DUP) {
      if (sp < 1) { if (fail(2)) break; }
      if (sp >= STACK_CAP) { if (fail(3)) break; }
      values[sp] = values[sp - 1];
      sp += 1;
    } else if (op === OPS.SWAP) {
      if (sp < 2) { if (fail(2)) break; }
      const top = values[sp - 1];
      values[sp - 1] = values[sp - 2];
      values[sp - 2] = top;
    } else if (BINARY.includes(op)) {
      if (sp < 2) { if (fail(2)) break; }
      const b = values[--sp];
      const a = values[--sp];
      let value;
      if (op === OPS.ADD) value = (a + b) | 0;
      else if (op === OPS.SUB) value = (a - b) | 0;
      else if (op === OPS.MUL) value = Math.imul(a, b);
      else if (op === OPS.DIV) {
        if (b === 0) { if (fail(5)) break; }
        value = (a / b) | 0;
      } else if (op === OPS.MOD) {
        if (b === 0) { if (fail(5)) break; }
        value = (a % b) | 0;
      } else if (op === OPS.EQ) value = a === b ? 1 : 0;
      else if (op === OPS.NE) value = a !== b ? 1 : 0;
      else if (op === OPS.LT) value = a < b ? 1 : 0;
      else if (op === OPS.LE) value = a <= b ? 1 : 0;
      else if (op === OPS.GT) value = a > b ? 1 : 0;
      else if (op === OPS.GE) value = a >= b ? 1 : 0;
      else if (op === OPS.AND) value = a !== 0 && b !== 0 ? 1 : 0;
      else value = a !== 0 || b !== 0 ? 1 : 0;
      values[sp++] = value;
    } else if (op === OPS.NEG) {
      if (sp < 1) { if (fail(2)) break; }
      values[sp - 1] = (-values[sp - 1]) | 0;
    } else if (op === OPS.NOT) {
      if (sp < 1) { if (fail(2)) break; }
      values[sp - 1] = values[sp - 1] === 0 ? 1 : 0;
    } else if (op === OPS.JMP) {
      pc = code[base + 1] | (code[base + 2] << 8);
    } else if (op === OPS.JZ || op === OPS.JNZ) {
      if (sp < 1) { if (fail(2)) break; }
      const value = values[--sp];
      const take = op === OPS.JZ ? value === 0 : value !== 0;
      if (take) pc = code[base + 1] | (code[base + 2] << 8);
    } else if (op === OPS.LOADL) {
      if (sp >= STACK_CAP) { if (fail(3)) break; }
      values[sp++] = frames[fp * (LOCALS + 1) + x + 1];
    } else if (op === OPS.STOREL) {
      if (sp < 1) { if (fail(2)) break; }
      frames[fp * (LOCALS + 1) + x + 1] = values[--sp];
    } else if (op === OPS.CALL) {
      if (fp + 1 >= FRAME_CAP) { if (fail(4)) break; }
      fp += 1;
      frames[fp * (LOCALS + 1)] = pc;
      for (let i = 0; i < LOCALS; i++) frames[fp * (LOCALS + 1) + i + 1] = 0;
      pc = code[base + 1] | (code[base + 2] << 8);
    } else if (op === OPS.RET) {
      if (fp === 0) { if (fail(11)) break; }
      pc = frames[fp * (LOCALS + 1)];
      fp -= 1;
    } else if (op === OPS.HALT) {
      steps += 1;
      halted = true;
      break;
    }
    steps += 1;
  }

  if (!halted && err === 0 && steps >= limit) err = 7;

  return {
    load: 0,
    err,
    pc,
    steps,
    depth: sp,
    result: sp > 0 ? values[sp - 1] : 0,
  };
}

const engines = [];
for (const engine of VM_ENGINES) {
  const file = path.join(root, 'projects', 'vm', engine.file);
  const bytes = fs.readFileSync(file);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  engines.push({ engine, w: instance.exports });
}

function check(code) {
  const expected = reference(code);
  const n = code.length / 4;
  const mismatches = [];

  for (const { engine, w } of engines) {
    const mem = new Uint8Array(w.memory.buffer);
    mem.set(code, w.vm_code_ptr());
    const load = w.vm_load(n);
    if (expected.load) {
      if (load !== expected.load || w.vm_pc() !== expected.pc) {
        mismatches.push(`${engine.id}: load ${load}/${w.vm_pc()} != ${expected.load}/${expected.pc}`);
      }
      continue;
    }
    if (load !== 0) {
      mismatches.push(`${engine.id}: load ${load}, expected 0`);
      continue;
    }
    const run = w.vm_run(STEP_CAP);
    const got = {
      err: w.vm_error(), pc: w.vm_pc(), steps: w.vm_steps(),
      depth: w.vm_depth(), result: w.vm_result(),
    };
    const want = { err: expected.err, pc: expected.pc, steps: expected.steps, depth: expected.depth, result: expected.result };
    for (const key of Object.keys(want)) {
      if (got[key] !== want[key]) {
        mismatches.push(`${engine.id}: ${key} ${got[key]} != ${want[key]}`);
      }
    }
    if (run !== (expected.err === 0 ? 0 : -1)) {
      mismatches.push(`${engine.id}: return ${run}, expected ${expected.err === 0 ? 0 : -1}`);
    }
  }

  return mismatches;
}

let mismatched = 0;
let loadErrors = 0;
let runErrors = 0;
try {
  const perIteration = iterations;
  for (let i = 0; i < perIteration; i++) {
    const code = chance(0.2) ? randomBytes() : randomProgram();
    const expected = reference(code);
    if (expected.load) loadErrors++;
    else if (expected.err) runErrors++;

    const mismatches = check(code);
    if (mismatches.length) {
      mismatched += 1;
      console.error(`\nprogram #${i}, seed ${seed}: ${mismatches.join('; ')}`);
      console.error('expected:', JSON.stringify(expected));
      console.error(disassemble(code, code.length / 4).join('\n'));
      if (mismatched >= 5) break;
    }
  }
} finally {
  // ничего не остаётся открытым: модули живут в памяти процесса
}

if (mismatched) {
  console.error(`\nрасхождений: ${mismatched}`);
  process.exit(1);
}

console.log(`ok: ${iterations} программ, seed ${seed}`);
console.log(`ошибки загрузки: ${loadErrors}, ошибки исполнения: ${runErrors}, все шесть сборок совпали`);
