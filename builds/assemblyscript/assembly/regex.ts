// Regex-движок на AssemblyScript: тот же байткод и та же VM, что у C-референса.
// Буферы лежат по фиксированным адресам, без аллокатора и без импортов.

const PATTERN_CAP: i32 = 4096;
const TEXT_CAP: i32 = 8192;
const PROG_CAP: i32 = 2048;
const CLASS_CAP: i32 = 64;
const STACK_CAP: i32 = 8192;
const STEP_CAP: i32 = 1000000;

const PATTERN_PTR: i32 = 0x10000;
const TEXT_PTR: i32 = 0x20000;
const PROG_PTR: i32 = 0x30000;
const CLASSES_PTR: i32 = 0x40000;
const BT_PC_PTR: i32 = 0x50000;
const BT_POS_PTR: i32 = 0x60000;

const OP_CHAR: i32 = 1;
const OP_ANY: i32 = 2;
const OP_CLASS: i32 = 3;
const OP_BOL: i32 = 4;
const OP_EOL: i32 = 5;
const OP_JMP: i32 = 6;
const OP_SPLIT: i32 = 7;
const OP_MATCH: i32 = 8;

const ERR_CHAR: i32 = 1;
const ERR_UNMATCHED_OPEN: i32 = 2;
const ERR_UNMATCHED_CLOSE: i32 = 3;
const ERR_CLASS: i32 = 4;
const ERR_ESCAPE: i32 = 5;
const ERR_PROGRAM: i32 = 6;
const ERR_QUANT: i32 = 7;
const ERR_STEPS: i32 = 8;
const ERR_PATTERN_LEN: i32 = 9;
const ERR_TEXT_LEN: i32 = 10;
const ERR_NOT_COMPILED: i32 = 11;
const ERR_STACK: i32 = 12;

function ensureMemory(): void {
  if (memory.size() < 8) memory.grow(8 - memory.size());
}

ensureMemory();

let patLen: i32 = 0;
let patPos: i32 = 0;
let pc: i32 = 0;
let classCount: i32 = 0;
let textLen: i32 = 0;
let compiled: i32 = 0;
let err: i32 = 0;
let errPos: i32 = 0;
let steps: i32 = 0;

function fail(code: i32, pos: i32): void {
  if (err == 0) {
    err = code;
    errPos = pos;
  }
}

function patAt(i: i32): i32 {
  return i >= 0 && i < patLen ? <i32>load<u8>(PATTERN_PTR + i) : -1;
}

function peek(): i32 {
  return patAt(patPos);
}

function take(): i32 {
  if (patPos >= patLen) return -1;
  let c = <i32>load<u8>(PATTERN_PTR + patPos);
  patPos += 1;
  return c;
}

function takeIf(c: i32): bool {
  if (peek() == c) {
    patPos += 1;
    return true;
  }
  return false;
}

function progGet(at: i32, field: i32): i32 {
  return load<i32>(PROG_PTR + at * 16 + field * 4);
}

function progSet(at: i32, field: i32, value: i32): void {
  store<i32>(PROG_PTR + at * 16 + field * 4, value);
}

function classAdd(cls: i32, lo: i32, hi: i32): void {
  let a = lo < 0 ? 0 : lo;
  let b = hi > 255 ? 255 : hi;
  for (let c = a; c <= b; c++) {
    let at = cls * 32 + (c >> 3);
    let shift = <u8>(c & 7);
    let bit: u8 = 1;
    bit = bit << shift;
    store<u8>(CLASSES_PTR + at, <u8>(load<u8>(CLASSES_PTR + at) | bit));
  }
}

function classNew(): i32 {
  if (classCount >= CLASS_CAP) {
    fail(ERR_PROGRAM, patPos);
    return -1;
  }
  let cls = classCount++;
  for (let i = 0; i < 32; i++) store<u8>(CLASSES_PTR + cls * 32 + i, 0);
  return cls;
}

// Добавляет escape в класс. Возвращает 1 для одиночного символа, 0 для набора.
function classAddEscape(cls: i32, e: i32, value: i32): i32 {
  if (e == 100) {
    classAdd(cls, 48, 57);
    return 0;
  }
  if (e == 119) {
    classAdd(cls, 48, 57);
    classAdd(cls, 65, 90);
    classAdd(cls, 95, 95);
    classAdd(cls, 97, 122);
    return 0;
  }
  if (e == 115) {
    classAdd(cls, 9, 13);
    classAdd(cls, 32, 32);
    return 0;
  }
  let c = e;
  if (e == 110) c = 10;
  else if (e == 116) c = 9;
  else if (e == 114) c = 13;
  else if (e == 102) c = 12;
  else if (e == 118) c = 11;
  return c;
}

function scanClassEnd(start: i32): i32 {
  let i = start + 1;
  while (i < patLen) {
    let c = <i32>load<u8>(PATTERN_PTR + i);
    if (c == 92) {
      i += 2;
      continue;
    }
    if (c == 93) return i + 1;
    i += 1;
  }
  return -1;
}

function scanAtomEnd(start: i32): i32 {
  if (start >= patLen) return -1;
  let c = <i32>load<u8>(PATTERN_PTR + start);
  if (c == 91) return scanClassEnd(start);
  if (c == 92) return start + 2 <= patLen ? start + 2 : -1;
  if (c == 40) {
    let depth = 0;
    let i = start;
    while (i < patLen) {
      let d = <i32>load<u8>(PATTERN_PTR + i);
      if (d == 92) {
        i += 2;
        continue;
      }
      if (d == 91) {
        i = scanClassEnd(i);
        if (i < 0) return -1;
        continue;
      }
      if (d == 40) depth += 1;
      else if (d == 41) {
        depth -= 1;
        if (depth == 0) return i + 1;
      }
      i += 1;
    }
    return -1;
  }
  return start + 1;
}

function parseClass(): i32 {
  let start = patPos;
  patPos += 1;
  let neg = takeIf(94);
  let cls = classNew();
  if (cls < 0) return -1;
  let items = 0;
  while (true) {
    let c = peek();
    if (c < 0) {
      fail(ERR_CLASS, start);
      return -1;
    }
    if (c == 93) {
      patPos += 1;
      break;
    }
    let single = 0;
    let escaped = 0;
    let lo = 0;
    let hi = 0;
    if (c == 92) {
      patPos += 1;
      let e = take();
      if (e < 0) {
        fail(ERR_ESCAPE, patPos);
        return -1;
      }
      escaped = 1;
      let v = classAddEscape(cls, e, 0);
      if (v >= 0) {
        // classAddEscape вернул символ для одиночного escape; наборы уже добавлены.
        if (e != 100 && e != 119 && e != 115) single = 1;
        lo = v;
        hi = v;
      }
    } else {
      patPos += 1;
      lo = c;
      hi = c;
      single = 1;
    }
    if (single != 0 && escaped == 0) {
      if (peek() == 45 && patAt(patPos + 1) != 93 && patAt(patPos + 1) >= 0) {
        patPos += 1;
        let e = take();
        if (e < 0) {
          fail(ERR_ESCAPE, patPos);
          return -1;
        }
        if (e == 92) {
          e = take();
          if (e < 0) {
            fail(ERR_ESCAPE, patPos);
            return -1;
          }
        }
        hi = e;
        if (hi < lo) {
          fail(ERR_CLASS, patPos - 1);
          return -1;
        }
      }
    }
    if (single != 0) classAdd(cls, lo, hi);
    items += 1;
  }
  if (items == 0) {
    fail(ERR_CLASS, start);
    return -1;
  }
  if (neg) {
    for (let i = 0; i < 32; i++) {
      let at = cls * 32 + i;
      store<u8>(CLASSES_PTR + at, <u8>~load<u8>(CLASSES_PTR + at));
    }
  }
  return cls;
}

function emit(op: i32, a: i32, b: i32): i32 {
  if (pc >= PROG_CAP) {
    fail(ERR_PROGRAM, patPos);
    return -1;
  }
  let at = pc++;
  progSet(at, 0, op);
  progSet(at, 1, a);
  progSet(at, 2, b);
  progSet(at, 3, 0);
  return at;
}

function patch(at: i32, field: i32, value: i32): void {
  progSet(at, field, value);
}

function compileAtom(): i32 {
  let c = peek();
  if (c < 0) {
    fail(ERR_CHAR, patPos);
    return -1;
  }
  if (c == 40) {
    let start = patPos;
    patPos += 1;
    if (compileAlt() < 0) return -1;
    if (!takeIf(41)) {
      fail(ERR_UNMATCHED_OPEN, start);
      return -1;
    }
    return 1;
  }
  if (c == 91) {
    let cls = parseClass();
    if (cls < 0) return -1;
    return emit(OP_CLASS, cls, 0) < 0 ? -1 : 1;
  }
  if (c == 46) {
    patPos += 1;
    return emit(OP_ANY, 0, 0) < 0 ? -1 : 1;
  }
  if (c == 94) {
    patPos += 1;
    return emit(OP_BOL, 0, 0) < 0 ? -1 : 1;
  }
  if (c == 36) {
    patPos += 1;
    return emit(OP_EOL, 0, 0) < 0 ? -1 : 1;
  }
  if (c == 92) {
    let start = patPos;
    patPos += 1;
    let e = take();
    if (e < 0) {
      fail(ERR_ESCAPE, start);
      return -1;
    }
    if (e == 100 || e == 119 || e == 115) {
      let cls = classNew();
      if (cls < 0) return -1;
      if (e == 100) classAdd(cls, 48, 57);
      else if (e == 119) {
        classAdd(cls, 48, 57);
        classAdd(cls, 65, 90);
        classAdd(cls, 95, 95);
        classAdd(cls, 97, 122);
      } else {
        classAdd(cls, 9, 13);
        classAdd(cls, 32, 32);
      }
      return emit(OP_CLASS, cls, 0) < 0 ? -1 : 1;
    }
    if (e == 110) e = 10;
    else if (e == 116) e = 9;
    else if (e == 114) e = 13;
    else if (e == 102) e = 12;
    else if (e == 118) e = 11;
    return emit(OP_CHAR, e, 0) < 0 ? -1 : 1;
  }
  if (c == 42 || c == 43 || c == 63) {
    fail(ERR_QUANT, patPos);
    return -1;
  }
  patPos += 1;
  return emit(OP_CHAR, c, 0) < 0 ? -1 : 1;
}

function isQuant(c: i32): bool {
  return c == 42 || c == 43 || c == 63;
}

function hasAlt(from: i32): bool {
  let i = from;
  let depth = 0;
  while (i < patLen) {
    let c = <i32>load<u8>(PATTERN_PTR + i);
    if (c == 92) {
      i += 2;
      continue;
    }
    if (c == 91) {
      i = scanClassEnd(i);
      if (i < 0) return false;
      continue;
    }
    if (c == 40) {
      depth += 1;
      i += 1;
      continue;
    }
    if (c == 41) {
      if (depth == 0) return false;
      depth -= 1;
      i += 1;
      continue;
    }
    if (c == 124 && depth == 0) return true;
    i += 1;
  }
  return false;
}

function compileSeq(): i32 {
  while (true) {
    let c = peek();
    if (c < 0 || c == 124 || c == 41) return 1;
    let start = patPos;
    let end = scanAtomEnd(start);
    let q = end > 0 ? patAt(end) : -1;
    if (!isQuant(q)) q = 0;
    if (q != 0 && (c == 94 || c == 36)) {
      fail(ERR_QUANT, end);
      return -1;
    }

    let split = -1;
    if (q == 42 || q == 63) {
      split = emit(OP_SPLIT, pc + 1, 0);
      if (split < 0) return -1;
    }
    let child = pc;
    if (compileAtom() < 0) return -1;
    if (q == 42) {
      if (emit(OP_JMP, split, 0) < 0) return -1;
      patch(split, 2, pc);
    } else if (q == 63) {
      patch(split, 2, pc);
    } else if (q == 43) {
      split = emit(OP_SPLIT, child, 0);
      if (split < 0) return -1;
      patch(split, 2, pc);
    }
    if (q != 0) {
      patPos += 1;
      if (isQuant(peek())) {
        fail(ERR_QUANT, patPos);
        return -1;
      }
    }
  }
}

function compileAlt(): i32 {
  if (!hasAlt(patPos)) return compileSeq();
  let split = emit(OP_SPLIT, pc + 1, 0);
  if (split < 0) return -1;
  if (compileSeq() < 0) return -1;
  if (peek() == 124) {
    patPos += 1;
    let jmp = emit(OP_JMP, 0, 0);
    if (jmp < 0) return -1;
    patch(split, 2, pc);
    if (compileAlt() < 0) return -1;
    patch(jmp, 1, pc);
  } else {
    patch(split, 2, pc);
  }
  return 1;
}

function classHas(cls: i32, c: i32): bool {
  let byte = load<u8>(CLASSES_PTR + cls * 32 + (c >> 3));
  let shift = <u8>(c & 7);
  return ((byte >> shift) & <u8>1) != 0;
}

export function re_pattern_ptr(): i32 {
  return PATTERN_PTR;
}

export function re_text_ptr(): i32 {
  return TEXT_PTR;
}

export function re_compile(len: i32): i32 {
  err = 0;
  errPos = 0;
  compiled = 0;
  patPos = 0;
  pc = 0;
  classCount = 0;
  if (len < 0 || len > PATTERN_CAP) {
    patLen = 0;
    fail(ERR_PATTERN_LEN, 0);
    return err;
  }
  patLen = len;
  let root = compileAlt();
  if (root < 0) return err;
  if (patPos < patLen) {
    if (<i32>load<u8>(PATTERN_PTR + patPos) == 41) fail(ERR_UNMATCHED_CLOSE, patPos);
    else fail(ERR_CHAR, patPos);
    return err;
  }
  if (emit(OP_MATCH, 0, 0) < 0) return err;
  compiled = 1;
  return 0;
}

export function re_match(len: i32): i32 {
  err = 0;
  errPos = 0;
  steps = 0;
  if (compiled == 0) {
    fail(ERR_NOT_COMPILED, 0);
    return -1;
  }
  if (len < 0 || len > TEXT_CAP) {
    fail(ERR_TEXT_LEN, 0);
    return -1;
  }
  textLen = len;
  for (let start = 0; start <= len; start++) {
    let ip = 0;
    let pos = start;
    let bt = 0;
    while (true) {
      steps += 1;
      if (steps > STEP_CAP) {
        fail(ERR_STEPS, pos);
        return -1;
      }
      let op = progGet(ip, 0);
      let a = progGet(ip, 1);
      let b = progGet(ip, 2);
      let advanced = false;
      if (op == OP_CHAR) {
        if (pos < len && <i32>load<u8>(TEXT_PTR + pos) == a) {
          pos += 1;
          ip += 1;
          advanced = true;
        }
      } else if (op == OP_ANY) {
        if (pos < len && <i32>load<u8>(TEXT_PTR + pos) != 10) {
          pos += 1;
          ip += 1;
          advanced = true;
        }
      } else if (op == OP_CLASS) {
        if (pos < len && classHas(a, <i32>load<u8>(TEXT_PTR + pos))) {
          pos += 1;
          ip += 1;
          advanced = true;
        }
      } else if (op == OP_BOL) {
        if (pos == 0) {
          ip += 1;
          advanced = true;
        }
      } else if (op == OP_EOL) {
        if (pos == len) {
          ip += 1;
          advanced = true;
        }
      } else if (op == OP_JMP) {
        ip = a;
        advanced = true;
      } else if (op == OP_SPLIT) {
        if (bt >= STACK_CAP) {
          fail(ERR_STACK, pos);
          return -1;
        }
        store<i32>(BT_PC_PTR + bt * 4, b);
        store<i32>(BT_POS_PTR + bt * 4, pos);
        bt += 1;
        ip = a;
        advanced = true;
      } else if (op == OP_MATCH) {
        return 1;
      }
      if (advanced) continue;
      if (bt == 0) break;
      bt -= 1;
      ip = load<i32>(BT_PC_PTR + bt * 4);
      pos = load<i32>(BT_POS_PTR + bt * 4);
    }
  }
  return 0;
}

export function re_error(): i32 {
  return err;
}

export function re_error_pos(): i32 {
  return errPos;
}

export function re_steps(): i32 {
  return steps;
}
