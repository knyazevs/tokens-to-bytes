// Стековая VM на AssemblyScript: тот же байткод и тот же контракт, что у
// C-референса. Буферы лежат по фиксированным адресам, без аллокатора и
// без импортов: код, стек значений и кадры вызовов.

const CODE_CAP: i32 = 4096;
const STACK_CAP: i32 = 1024;
const FRAME_CAP: i32 = 128;
const LOCALS: i32 = 8;

const CODE_PTR: i32 = 0x10000;
const VALUES_PTR: i32 = 0x14000;
const FRAMES_PTR: i32 = 0x15000;

const OP_PUSH: i32 = 1;
const OP_POP: i32 = 2;
const OP_DUP: i32 = 3;
const OP_SWAP: i32 = 4;
const OP_ADD: i32 = 5;
const OP_SUB: i32 = 6;
const OP_MUL: i32 = 7;
const OP_DIV: i32 = 8;
const OP_MOD: i32 = 9;
const OP_NEG: i32 = 10;
const OP_EQ: i32 = 11;
const OP_NE: i32 = 12;
const OP_LT: i32 = 13;
const OP_LE: i32 = 14;
const OP_GT: i32 = 15;
const OP_GE: i32 = 16;
const OP_AND: i32 = 17;
const OP_OR: i32 = 18;
const OP_NOT: i32 = 19;
const OP_JMP: i32 = 20;
const OP_JZ: i32 = 21;
const OP_JNZ: i32 = 22;
const OP_LOADL: i32 = 23;
const OP_STOREL: i32 = 24;
const OP_CALL: i32 = 25;
const OP_RET: i32 = 26;
const OP_HALT: i32 = 27;

const ERR_NONE: i32 = 0;
const ERR_OPCODE: i32 = 1;
const ERR_UNDERFLOW: i32 = 2;
const ERR_OVERFLOW: i32 = 3;
const ERR_CALLS: i32 = 4;
const ERR_ZERO: i32 = 5;
const ERR_TARGET: i32 = 6;
const ERR_STEPS: i32 = 7;
const ERR_CODE_LEN: i32 = 8;
const ERR_NOT_LOADED: i32 = 9;
const ERR_LOCAL: i32 = 10;
const ERR_RET: i32 = 11;
const ERR_EMPTY: i32 = 12;

function ensureMemory(): void {
  if (memory.size() < 2) memory.grow(2 - memory.size());
}

ensureMemory();

let codeLen: i32 = 0;
let loaded: i32 = 0;
let sp: i32 = 0;
let fp: i32 = 0;
let pc: i32 = 0;
let err: i32 = 0;
let steps: i32 = 0;
let result: i32 = 0;
let depth: i32 = 0;

function byteAt(i: i32): i32 {
  return <i32>load<u8>(CODE_PTR + i);
}

function codeByte(i: i32): i32 {
  return <i32>load<u8>(CODE_PTR + i * 4);
}

function packedTarget(i: i32): i32 {
  return byteAt(i * 4 + 1) | (byteAt(i * 4 + 2) << 8);
}

function stop(): i32 {
  depth = sp;
  result = sp > 0 ? load<i32>(VALUES_PTR + (sp - 1) * 4) : 0;
  return err == ERR_NONE ? 0 : -1;
}

function die(code: i32): i32 {
  err = code;
  pc -= 1;
  return stop();
}

function push(value: i32): void {
  store<i32>(VALUES_PTR + sp * 4, value);
  sp += 1;
}

function pop(): i32 {
  sp -= 1;
  return load<i32>(VALUES_PTR + sp * 4);
}

function localPtr(index: i32): i32 {
  return FRAMES_PTR + (fp * (LOCALS + 1) + index) * 4;
}

export function vm_code_ptr(): i32 {
  return CODE_PTR;
}

export function vm_load(count: i32): i32 {
  loaded = 0;
  err = ERR_NONE;
  pc = 0;
  codeLen = 0;

  if (count > CODE_CAP) {
    err = ERR_CODE_LEN;
    return ERR_CODE_LEN;
  }
  if (count <= 0) {
    err = ERR_EMPTY;
    return ERR_EMPTY;
  }

  for (let i = 0; i < count; i++) {
    const op = codeByte(i);
    if (op < OP_PUSH || op > OP_HALT) {
      err = ERR_OPCODE;
      pc = i;
      return ERR_OPCODE;
    }
    if (op == OP_JMP || op == OP_JZ || op == OP_JNZ || op == OP_CALL) {
      const target = packedTarget(i);
      if (target < 0 || target >= count) {
        err = ERR_TARGET;
        pc = i;
        return ERR_TARGET;
      }
    } else if (op == OP_LOADL || op == OP_STOREL) {
      if (byteAt(i * 4 + 1) >= LOCALS) {
        err = ERR_LOCAL;
        pc = i;
        return ERR_LOCAL;
      }
    }
  }

  codeLen = count;
  loaded = 1;
  return 0;
}

export function vm_run(limit: i32): i32 {
  if (loaded == 0) {
    err = ERR_NOT_LOADED;
    return -1;
  }
  if (limit <= 0) limit = 1000000;

  sp = 0;
  fp = 0;
  pc = 0;
  err = ERR_NONE;
  steps = 0;
  depth = 0;
  result = 0;
  for (let v = 0; v < LOCALS; v++) store<i32>(FRAMES_PTR + (v + 1) * 4, 0);

  while (steps < limit) {
    if (pc < 0 || pc >= codeLen) {
      err = ERR_TARGET;
      return stop();
    }

    const base = pc * 4;
    const op = codeByte(pc);
    const x = byteAt(base + 1);
    pc += 1;

    switch (op) {
      case OP_PUSH: {
        let value = (byteAt(base + 1) << 16) | (byteAt(base + 2) << 8) | byteAt(base + 3);
        if (value & 0x800000) value -= 0x1000000;
        if (sp >= STACK_CAP) return die(ERR_OVERFLOW);
        push(value);
        break;
      }

      case OP_POP: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        sp -= 1;
        break;
      }

      case OP_DUP: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        if (sp >= STACK_CAP) return die(ERR_OVERFLOW);
        push(load<i32>(VALUES_PTR + (sp - 1) * 4));
        break;
      }

      case OP_SWAP: {
        if (sp < 2) return die(ERR_UNDERFLOW);
        const top = load<i32>(VALUES_PTR + (sp - 1) * 4);
        store<i32>(VALUES_PTR + (sp - 1) * 4, load<i32>(VALUES_PTR + (sp - 2) * 4));
        store<i32>(VALUES_PTR + (sp - 2) * 4, top);
        break;
      }

      case OP_ADD:
      case OP_SUB:
      case OP_MUL:
      case OP_DIV:
      case OP_MOD:
      case OP_EQ:
      case OP_NE:
      case OP_LT:
      case OP_LE:
      case OP_GT:
      case OP_GE:
      case OP_AND:
      case OP_OR: {
        if (sp < 2) return die(ERR_UNDERFLOW);
        const b = pop();
        const a = pop();
        let value = 0;
        if (op == OP_ADD) value = a + b;
        else if (op == OP_SUB) value = a - b;
        else if (op == OP_MUL) value = a * b;
        else if (op == OP_DIV) {
          if (b == 0) return die(ERR_ZERO);
          value = a == -2147483648 && b == -1 ? a : a / b;
        } else if (op == OP_MOD) {
          if (b == 0) return die(ERR_ZERO);
          value = a % b;
        } else if (op == OP_EQ) value = a == b ? 1 : 0;
        else if (op == OP_NE) value = a != b ? 1 : 0;
        else if (op == OP_LT) value = a < b ? 1 : 0;
        else if (op == OP_LE) value = a <= b ? 1 : 0;
        else if (op == OP_GT) value = a > b ? 1 : 0;
        else if (op == OP_GE) value = a >= b ? 1 : 0;
        else if (op == OP_AND) value = a != 0 && b != 0 ? 1 : 0;
        else value = a != 0 || b != 0 ? 1 : 0;
        push(value);
        break;
      }

      case OP_NEG: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        const top = load<i32>(VALUES_PTR + (sp - 1) * 4);
        store<i32>(VALUES_PTR + (sp - 1) * 4, -top);
        break;
      }

      case OP_NOT: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        const top = load<i32>(VALUES_PTR + (sp - 1) * 4);
        store<i32>(VALUES_PTR + (sp - 1) * 4, top == 0 ? 1 : 0);
        break;
      }

      case OP_JMP: {
        pc = packedTarget(pc - 1);
        break;
      }

      case OP_JZ:
      case OP_JNZ: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        const value = pop();
        const take = op == OP_JZ ? value == 0 : value != 0;
        if (take) pc = packedTarget(pc - 1);
        break;
      }

      case OP_LOADL: {
        if (sp >= STACK_CAP) return die(ERR_OVERFLOW);
        push(load<i32>(localPtr(x + 1)));
        break;
      }

      case OP_STOREL: {
        if (sp < 1) return die(ERR_UNDERFLOW);
        store<i32>(localPtr(x + 1), pop());
        break;
      }

      case OP_CALL: {
        if (fp + 1 >= FRAME_CAP) return die(ERR_CALLS);
        fp += 1;
        store<i32>(FRAMES_PTR + fp * (LOCALS + 1) * 4, pc);
        for (let i = 0; i < LOCALS; i++) store<i32>(localPtr(i + 1), 0);
        pc = packedTarget(pc - 1);
        break;
      }

      case OP_RET: {
        if (fp == 0) return die(ERR_RET);
        pc = load<i32>(FRAMES_PTR + fp * (LOCALS + 1) * 4);
        fp -= 1;
        break;
      }

      case OP_HALT: {
        steps += 1;
        return stop();
      }

      default:
        return die(ERR_OPCODE);
    }

    steps += 1;
  }

  err = ERR_STEPS;
  return stop();
}

export function vm_result(): i32 {
  return result;
}

export function vm_depth(): i32 {
  return depth;
}

export function vm_error(): i32 {
  return err;
}

export function vm_pc(): i32 {
  return pc;
}

export function vm_steps(): i32 {
  return steps;
}
