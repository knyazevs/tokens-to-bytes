// Regex-движок: компиляция в байткод и бэктрекинг-VM.
//
// Поддерживается: литералы, `.`, классы `[...]`/`[^...]` с диапазонами и
// \d \w \s, якоря ^ $, группы (без захватов), альтернатива |, квантификаторы
// * + ?. Флагов и захватов нет. Одна операция — один re_match.
//
// Память: статические массивы в bss; наружу отдаются re_pattern_ptr() и
// re_text_ptr(), чтобы протокол мог копировать байты.

extern "C" {

typedef unsigned char u8;
typedef int i32;

#define PATTERN_CAP 4096
#define TEXT_CAP 8192
#define PROG_CAP 2048
#define CLASS_CAP 64
#define STACK_CAP 8192
#define STEP_CAP 1000000

enum {
  OP_CHAR = 1, OP_ANY = 2, OP_CLASS = 3, OP_BOL = 4, OP_EOL = 5,
  OP_JMP = 6, OP_SPLIT = 7, OP_MATCH = 8,
};

enum {
  ERR_NONE = 0, ERR_CHAR = 1, ERR_UNMATCHED_OPEN = 2, ERR_UNMATCHED_CLOSE = 3,
  ERR_CLASS = 4, ERR_ESCAPE = 5, ERR_PROGRAM = 6, ERR_QUANT = 7,
  ERR_STEPS = 8, ERR_PATTERN_LEN = 9, ERR_TEXT_LEN = 10, ERR_NOT_COMPILED = 11,
  ERR_STACK = 12,
};

static u8 pattern[PATTERN_CAP];
static u8 text[TEXT_CAP];
static i32 prog[PROG_CAP * 4];
static u8 classes[CLASS_CAP * 32];
static i32 bt_pc[STACK_CAP];
static i32 bt_pos[STACK_CAP];

static i32 pat_len;
static i32 pat_pos;
static i32 pc;
static i32 class_count;
static i32 text_len;
static i32 compiled;
static i32 err;
static i32 err_pos;
static i32 steps;

static void fail(i32 code, i32 pos) {
  if (!err) {
    err = code;
    err_pos = pos;
  }
}

static i32 pat_at(i32 i) {
  return i >= 0 && i < pat_len ? pattern[i] : -1;
}

static i32 peek(void) {
  return pat_at(pat_pos);
}

static i32 take(void) {
  if (pat_pos >= pat_len) return -1;
  return pattern[pat_pos++];
}

static i32 take_if(i32 c) {
  if (peek() == c) {
    pat_pos++;
    return 1;
  }
  return 0;
}

static void class_add(i32 cls, i32 lo, i32 hi) {
  i32 c;
  if (lo < 0) lo = 0;
  if (hi > 255) hi = 255;
  for (c = lo; c <= hi; c++) {
    classes[cls * 32 + (c >> 3)] |= (u8)(1u << (c & 7));
  }
}

static i32 class_new(void) {
  i32 cls, i;
  if (class_count >= CLASS_CAP) {
    fail(ERR_PROGRAM, pat_pos);
    return -1;
  }
  cls = class_count++;
  for (i = 0; i < 32; i++) classes[cls * 32 + i] = 0;
  return cls;
}

static void class_add_escape(i32 cls, i32 e, i32 *single, i32 *value) {
  if (e == 'd') {
    class_add(cls, '0', '9');
    *single = 0;
  } else if (e == 'w') {
    class_add(cls, '0', '9');
    class_add(cls, 'A', 'Z');
    class_add(cls, '_', '_');
    class_add(cls, 'a', 'z');
    *single = 0;
  } else if (e == 's') {
    class_add(cls, 9, 13);
    class_add(cls, ' ', ' ');
    *single = 0;
  } else {
    i32 c = e;
    if (e == 'n') c = 10;
    else if (e == 't') c = 9;
    else if (e == 'r') c = 13;
    else if (e == 'f') c = 12;
    else if (e == 'v') c = 11;
    *single = 1;
    *value = c;
  }
}

static i32 scan_class_end(i32 start) {
  i32 i = start + 1;
  while (i < pat_len) {
    i32 c = pattern[i];
    if (c == '\\') {
      i += 2;
      continue;
    }
    if (c == ']') return i + 1;
    i++;
  }
  return -1;
}

// Возвращает позицию сразу за атомом: литералом, классом или группой.
static i32 scan_atom_end(i32 start) {
  i32 i, depth, c;
  if (start >= pat_len) return -1;
  c = pattern[start];
  if (c == '[') return scan_class_end(start);
  if (c == '\\') return start + 2 <= pat_len ? start + 2 : -1;
  if (c == '(') {
    depth = 0;
    i = start;
    while (i < pat_len) {
      c = pattern[i];
      if (c == '\\') {
        i += 2;
        continue;
      }
      if (c == '[') {
        i = scan_class_end(i);
        if (i < 0) return -1;
        continue;
      }
      if (c == '(') depth++;
      else if (c == ')') {
        depth--;
        if (depth == 0) return i + 1;
      }
      i++;
    }
    return -1;
  }
  return start + 1;
}

static i32 parse_class(void) {
  i32 start = pat_pos;
  i32 neg, cls, items = 0;
  pat_pos++;
  neg = take_if('^');
  cls = class_new();
  if (cls < 0) return -1;
  for (;;) {
    i32 c = peek();
    i32 lo = 0, hi = 0, single = 0, escaped = 0;
    if (c < 0) {
      fail(ERR_CLASS, start);
      return -1;
    }
    if (c == ']') {
      pat_pos++;
      break;
    }
    if (c == '\\') {
      i32 e;
      pat_pos++;
      e = take();
      if (e < 0) {
        fail(ERR_ESCAPE, pat_pos);
        return -1;
      }
      escaped = 1;
      class_add_escape(cls, e, &single, &lo);
      hi = lo;
    } else {
      pat_pos++;
      lo = c;
      hi = c;
      single = 1;
    }
    if (single && !escaped) {
      if (peek() == '-' && pat_at(pat_pos + 1) != ']' && pat_at(pat_pos + 1) >= 0) {
        i32 e;
        pat_pos++;
        e = take();
        if (e < 0) {
          fail(ERR_ESCAPE, pat_pos);
          return -1;
        }
        if (e == '\\') {
          e = take();
          if (e < 0) {
            fail(ERR_ESCAPE, pat_pos);
            return -1;
          }
        }
        hi = e;
        if (hi < lo) {
          fail(ERR_CLASS, pat_pos - 1);
          return -1;
        }
      }
    }
    if (single) class_add(cls, lo, hi);
    items++;
  }
  if (!items) {
    fail(ERR_CLASS, start);
    return -1;
  }
  if (neg) {
    i32 i;
    for (i = 0; i < 32; i++) classes[cls * 32 + i] = (u8)~classes[cls * 32 + i];
  }
  return cls;
}

static i32 emit(i32 op, i32 a, i32 b) {
  i32 at;
  if (pc >= PROG_CAP) {
    fail(ERR_PROGRAM, pat_pos);
    return -1;
  }
  at = pc++;
  prog[at * 4] = op;
  prog[at * 4 + 1] = a;
  prog[at * 4 + 2] = b;
  prog[at * 4 + 3] = 0;
  return at;
}

static void patch(i32 at, i32 field, i32 value) {
  prog[at * 4 + field] = value;
}

static i32 compile_alt(void);

static i32 compile_atom(void) {
  i32 c = peek();
  if (c < 0) {
    fail(ERR_CHAR, pat_pos);
    return -1;
  }
  if (c == '(') {
    i32 start = pat_pos;
    pat_pos++;
    if (compile_alt() < 0) return -1;
    if (!take_if(')')) {
      fail(ERR_UNMATCHED_OPEN, start);
      return -1;
    }
    return 1;
  }
  if (c == '[') {
    i32 cls = parse_class();
    if (cls < 0) return -1;
    return emit(OP_CLASS, cls, 0) < 0 ? -1 : 1;
  }
  if (c == '.') {
    pat_pos++;
    return emit(OP_ANY, 0, 0) < 0 ? -1 : 1;
  }
  if (c == '^') {
    pat_pos++;
    return emit(OP_BOL, 0, 0) < 0 ? -1 : 1;
  }
  if (c == '$') {
    pat_pos++;
    return emit(OP_EOL, 0, 0) < 0 ? -1 : 1;
  }
  if (c == '\\') {
    i32 start = pat_pos;
    i32 e;
    pat_pos++;
    e = take();
    if (e < 0) {
      fail(ERR_ESCAPE, start);
      return -1;
    }
    if (e == 'd' || e == 'w' || e == 's') {
      i32 cls = class_new();
      if (cls < 0) return -1;
      if (e == 'd') class_add(cls, '0', '9');
      else if (e == 'w') {
        class_add(cls, '0', '9');
        class_add(cls, 'A', 'Z');
        class_add(cls, '_', '_');
        class_add(cls, 'a', 'z');
      } else {
        class_add(cls, 9, 13);
        class_add(cls, ' ', ' ');
      }
      return emit(OP_CLASS, cls, 0) < 0 ? -1 : 1;
    }
    if (e == 'n') e = 10;
    else if (e == 't') e = 9;
    else if (e == 'r') e = 13;
    else if (e == 'f') e = 12;
    else if (e == 'v') e = 11;
    return emit(OP_CHAR, e, 0) < 0 ? -1 : 1;
  }
  if (c == '*' || c == '+' || c == '?') {
    fail(ERR_QUANT, pat_pos);
    return -1;
  }
  pat_pos++;
  return emit(OP_CHAR, c, 0) < 0 ? -1 : 1;
}

static i32 is_quant(i32 c) {
  return c == '*' || c == '+' || c == '?';
}

// Есть ли на текущем уровне вложенности альтернатива `|`.
static i32 has_alt(i32 from) {
  i32 i = from, depth = 0, c;
  while (i < pat_len) {
    c = pattern[i];
    if (c == '\\') {
      i += 2;
      continue;
    }
    if (c == '[') {
      i = scan_class_end(i);
      if (i < 0) return 0;
      continue;
    }
    if (c == '(') {
      depth++;
      i++;
      continue;
    }
    if (c == ')') {
      if (depth == 0) return 0;
      depth--;
      i++;
      continue;
    }
    if (c == '|' && depth == 0) return 1;
    i++;
  }
  return 0;
}

static i32 compile_seq(void) {
  for (;;) {
    i32 c = peek();
    i32 start, end, q, child, split;
    if (c < 0 || c == '|' || c == ')') return 1;
    start = pat_pos;
    end = scan_atom_end(start);
    q = end > 0 ? pat_at(end) : -1;
    if (!is_quant(q)) q = 0;
    // Якоря не квантифицируются: `^*` иначе зацикливается на пустом совпадении.
    if (q && (c == '^' || c == '$')) {
      fail(ERR_QUANT, end);
      return -1;
    }

    split = -1;
    if (q == '*' || q == '?') {
      split = emit(OP_SPLIT, pc + 1, 0);
      if (split < 0) return -1;
    }
    child = pc;
    if (compile_atom() < 0) return -1;
    if (q == '*') {
      if (emit(OP_JMP, split, 0) < 0) return -1;
      patch(split, 2, pc);
    } else if (q == '?') {
      patch(split, 2, pc);
    } else if (q == '+') {
      split = emit(OP_SPLIT, child, 0);
      if (split < 0) return -1;
      patch(split, 2, pc);
    }
    if (q) {
      pat_pos++;
      if (is_quant(peek())) {
        fail(ERR_QUANT, pat_pos);
        return -1;
      }
    }
  }
}

static i32 compile_alt(void) {
  i32 split, jmp;
  if (!has_alt(pat_pos)) return compile_seq();
  split = emit(OP_SPLIT, pc + 1, 0);
  if (split < 0) return -1;
  if (compile_seq() < 0) return -1;
  if (peek() == '|') {
    pat_pos++;
    jmp = emit(OP_JMP, 0, 0);
    if (jmp < 0) return -1;
    patch(split, 2, pc);
    if (compile_alt() < 0) return -1;
    patch(jmp, 1, pc);
  } else {
    patch(split, 2, pc);
  }
  return 1;
}

static i32 class_has(i32 cls, i32 c) {
  return (classes[cls * 32 + (c >> 3)] >> (c & 7)) & 1;
}

__attribute__((visibility("default"))) u8 *re_pattern_ptr(void) {
  return pattern;
}

__attribute__((visibility("default"))) u8 *re_text_ptr(void) {
  return text;
}

__attribute__((visibility("default"))) i32 re_compile(i32 len) {
  i32 root;
  err = 0;
  err_pos = 0;
  compiled = 0;
  pat_pos = 0;
  pc = 0;
  class_count = 0;
  if (len < 0 || len > PATTERN_CAP) {
    pat_len = 0;
    fail(ERR_PATTERN_LEN, 0);
    return err;
  }
  pat_len = len;
  root = compile_alt();
  if (root < 0) return err;
  if (pat_pos < pat_len) {
    if (pattern[pat_pos] == ')') fail(ERR_UNMATCHED_CLOSE, pat_pos);
    else fail(ERR_CHAR, pat_pos);
    return err;
  }
  if (emit(OP_MATCH, 0, 0) < 0) return err;
  compiled = 1;
  return 0;
}

__attribute__((visibility("default"))) i32 re_match(i32 len) {
  i32 start;
  err = 0;
  err_pos = 0;
  steps = 0;
  if (!compiled) {
    fail(ERR_NOT_COMPILED, 0);
    return -1;
  }
  if (len < 0 || len > TEXT_CAP) {
    fail(ERR_TEXT_LEN, 0);
    return -1;
  }
  text_len = len;
  for (start = 0; start <= len; start++) {
    i32 ip = 0;
    i32 pos = start;
    i32 bt = 0;
    for (;;) {
      i32 op, a, b;
      steps++;
      if (steps > STEP_CAP) {
        fail(ERR_STEPS, pos);
        return -1;
      }
      op = prog[ip * 4];
      a = prog[ip * 4 + 1];
      b = prog[ip * 4 + 2];
      if (op == OP_CHAR) {
        if (pos < len && text[pos] == a) {
          pos++;
          ip++;
          continue;
        }
      } else if (op == OP_ANY) {
        if (pos < len && text[pos] != '\n') {
          pos++;
          ip++;
          continue;
        }
      } else if (op == OP_CLASS) {
        if (pos < len && class_has(a, text[pos])) {
          pos++;
          ip++;
          continue;
        }
      } else if (op == OP_BOL) {
        if (pos == 0) {
          ip++;
          continue;
        }
      } else if (op == OP_EOL) {
        if (pos == len) {
          ip++;
          continue;
        }
      } else if (op == OP_JMP) {
        ip = a;
        continue;
      } else if (op == OP_SPLIT) {
        if (bt >= STACK_CAP) {
          fail(ERR_STACK, pos);
          return -1;
        }
        bt_pc[bt] = b;
        bt_pos[bt] = pos;
        bt++;
        ip = a;
        continue;
      } else if (op == OP_MATCH) {
        return 1;
      }
      if (bt == 0) break;
      bt--;
      ip = bt_pc[bt];
      pos = bt_pos[bt];
    }
  }
  return 0;
}

__attribute__((visibility("default"))) i32 re_error(void) {
  return err;
}

__attribute__((visibility("default"))) i32 re_error_pos(void) {
  return err_pos;
}

__attribute__((visibility("default"))) i32 re_steps(void) {
  return steps;
}

}
