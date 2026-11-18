// Стековая VM: интерпретатор байткода с кадрами вызовов.
//
// Формат: 4 байта на инструкцию [op, x, y, z]. PUSH берёт знаковое 24-битное
// число из x,y,z; переходы — адрес в x | y<<8; локалы — индекс в x.
//
// Память: статические массивы в bss, наружу отдаётся vm_code_ptr(). Стек
// значений общий для кадров, локалы — по 8 на кадр. Одна операция нагрузки —
// vm_load + vm_run одной программы.

typedef unsigned char u8;
typedef int i32;

#define CODE_CAP 4096
#define STACK_CAP 1024
#define FRAME_CAP 128
#define LOCALS 8

enum {
  OP_PUSH = 1, OP_POP = 2, OP_DUP = 3, OP_SWAP = 4, OP_ADD = 5, OP_SUB = 6,
  OP_MUL = 7, OP_DIV = 8, OP_MOD = 9, OP_NEG = 10, OP_EQ = 11, OP_NE = 12,
  OP_LT = 13, OP_LE = 14, OP_GT = 15, OP_GE = 16, OP_AND = 17, OP_OR = 18,
  OP_NOT = 19, OP_JMP = 20, OP_JZ = 21, OP_JNZ = 22, OP_LOADL = 23,
  OP_STOREL = 24, OP_CALL = 25, OP_RET = 26, OP_HALT = 27,
};

enum {
  ERR_NONE = 0, ERR_OPCODE = 1, ERR_UNDERFLOW = 2, ERR_OVERFLOW = 3,
  ERR_CALLS = 4, ERR_ZERO = 5, ERR_TARGET = 6, ERR_STEPS = 7, ERR_CODE_LEN = 8,
  ERR_NOT_LOADED = 9, ERR_LOCAL = 10, ERR_RET = 11, ERR_EMPTY = 12,
};

static u8 code[CODE_CAP * 4];
static i32 values[STACK_CAP];
static i32 frames[FRAME_CAP][LOCALS + 1];

static i32 code_len;
static i32 loaded;
static i32 sp;
static i32 fp;
static i32 pc;
static i32 err;
static i32 steps;
static i32 result;
static i32 depth;

static i32 packed_target(i32 i) {
  return code[i * 4 + 1] | (code[i * 4 + 2] << 8);
}

i32 vm_code_ptr(void) {
  return (i32)code;
}

i32 vm_load(i32 count) {
  i32 i, op, target;

  loaded = 0;
  err = ERR_NONE;
  pc = 0;
  code_len = 0;

  if (count > CODE_CAP) {
    err = ERR_CODE_LEN;
    return ERR_CODE_LEN;
  }
  if (count <= 0) {
    err = ERR_EMPTY;
    return ERR_EMPTY;
  }

  for (i = 0; i < count; i++) {
    op = code[i * 4];
    if (op < OP_PUSH || op > OP_HALT) {
      err = ERR_OPCODE;
      pc = i;
      return ERR_OPCODE;
    }
    if (op == OP_JMP || op == OP_JZ || op == OP_JNZ || op == OP_CALL) {
      target = packed_target(i);
      if (target < 0 || target >= count) {
        err = ERR_TARGET;
        pc = i;
        return ERR_TARGET;
      }
    } else if (op == OP_LOADL || op == OP_STOREL) {
      if (code[i * 4 + 1] >= LOCALS) {
        err = ERR_LOCAL;
        pc = i;
        return ERR_LOCAL;
      }
    }
  }

  code_len = count;
  loaded = 1;
  return 0;
}

i32 vm_run(i32 limit) {
  i32 op, x, a, b, v;

  if (!loaded) {
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
  for (v = 0; v < LOCALS; v++) frames[0][v + 1] = 0;

  while (steps < limit) {
    if (pc < 0 || pc >= code_len) {
      err = ERR_TARGET;
      goto stop;
    }

    op = code[pc * 4];
    x = code[pc * 4 + 1];
    pc++;

    switch (op) {
      case OP_PUSH:
        a = (code[(pc - 1) * 4 + 1] << 16) | (code[(pc - 1) * 4 + 2] << 8) | code[(pc - 1) * 4 + 3];
        if (a & 0x800000) a -= 0x1000000;
        if (sp >= STACK_CAP) { err = ERR_OVERFLOW; goto fail; }
        values[sp++] = a;
        break;

      case OP_POP:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        sp--;
        break;

      case OP_DUP:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        if (sp >= STACK_CAP) { err = ERR_OVERFLOW; goto fail; }
        values[sp] = values[sp - 1];
        sp++;
        break;

      case OP_SWAP:
        if (sp < 2) { err = ERR_UNDERFLOW; goto fail; }
        v = values[sp - 1];
        values[sp - 1] = values[sp - 2];
        values[sp - 2] = v;
        break;

      case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD:
      case OP_EQ: case OP_NE: case OP_LT: case OP_LE: case OP_GT: case OP_GE:
      case OP_AND: case OP_OR:
        if (sp < 2) { err = ERR_UNDERFLOW; goto fail; }
        b = values[--sp];
        a = values[--sp];
        if (op == OP_ADD) v = a + b;
        else if (op == OP_SUB) v = a - b;
        else if (op == OP_MUL) v = a * b;
        else if (op == OP_DIV) {
          if (b == 0) { err = ERR_ZERO; goto fail; }
          if (a == (i32)0x80000000 && b == -1) v = a;
          else v = a / b;
        } else if (op == OP_MOD) {
          if (b == 0) { err = ERR_ZERO; goto fail; }
          v = a % b;
        } else if (op == OP_EQ) v = a == b;
        else if (op == OP_NE) v = a != b;
        else if (op == OP_LT) v = a < b;
        else if (op == OP_LE) v = a <= b;
        else if (op == OP_GT) v = a > b;
        else if (op == OP_GE) v = a >= b;
        else if (op == OP_AND) v = (a != 0) && (b != 0);
        else v = (a != 0) || (b != 0);
        values[sp++] = v;
        break;

      case OP_NEG:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        values[sp - 1] = -values[sp - 1];
        break;

      case OP_NOT:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        values[sp - 1] = values[sp - 1] == 0;
        break;

      case OP_JMP:
        pc = packed_target(pc - 1);
        break;

      case OP_JZ:
      case OP_JNZ:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        v = values[--sp];
        if ((op == OP_JZ) == (v == 0)) pc = packed_target(pc - 1);
        break;

      case OP_LOADL:
        if (sp >= STACK_CAP) { err = ERR_OVERFLOW; goto fail; }
        values[sp++] = frames[fp][x + 1];
        break;

      case OP_STOREL:
        if (sp < 1) { err = ERR_UNDERFLOW; goto fail; }
        frames[fp][x + 1] = values[--sp];
        break;

      case OP_CALL:
        if (fp + 1 >= FRAME_CAP) { err = ERR_CALLS; goto fail; }
        fp++;
        frames[fp][0] = pc;
        for (v = 0; v < LOCALS; v++) frames[fp][v + 1] = 0;
        pc = packed_target(pc - 1);
        break;

      case OP_RET:
        if (fp == 0) { err = ERR_RET; goto fail; }
        pc = frames[fp][0];
        fp--;
        break;

      case OP_HALT:
        steps++;
        goto stop;

      default:
        err = ERR_OPCODE;
        goto fail;
    }

    steps++;
    continue;

  fail:
    pc--;
    goto stop;
  }

  err = ERR_STEPS;

stop:
  depth = sp;
  result = sp ? values[sp - 1] : 0;
  return err == ERR_NONE ? 0 : -1;
}

i32 vm_result(void) { return result; }
i32 vm_depth(void) { return depth; }
i32 vm_error(void) { return err; }
i32 vm_pc(void) { return pc; }
i32 vm_steps(void) { return steps; }
