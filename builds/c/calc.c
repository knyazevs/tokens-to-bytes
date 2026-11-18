static double g_acc, g_cur, g_scale, g_last_digit, g_operand, g_left_operand;
static int g_op, g_last_op, g_start_new, g_frac, g_digits_after_dot, g_err;

static void reset_entry(void) {
  g_cur = 0.0;
  g_scale = 1.0;
  g_last_digit = 0.0;
  g_start_new = 1;
  g_frac = 0;
  g_digits_after_dot = 0;
}

static void clear_all(void) {
  reset_entry();
  g_acc = 0.0;
  g_op = 0;
  g_last_op = 0;
  g_err = 0;
  g_operand = 0.0;
  g_left_operand = 0.0;
}

static void recompute_last(void) {
  double t = __builtin_trunc(__builtin_fabs(g_cur / g_scale) + 1e-9);
  double d = t - __builtin_trunc(t / 10.0) * 10.0;
  if (g_cur < 0.0) d = -d;
  g_last_digit = d;
}

static void apply_op(void) {
  switch (g_op) {
    case 1: g_acc += g_cur; break;
    case 2: g_acc -= g_cur; break;
    case 3: g_acc *= g_cur; break;
    case 4:
      if (g_cur == 0.0) {
        g_err = 1;
        g_acc = 0.0;
      } else {
        g_acc /= g_cur;
      }
      break;
    default: g_acc = g_cur; break;
  }
}

void clear(void) { clear_all(); }

void ce(void) {
  reset_entry();
  g_err = 0;
}

void digit(int value) {
  if (g_err) clear_all();
  if (g_start_new) {
    reset_entry();
    g_start_new = 0;
  }
  double d = (double)value;
  double sign = g_cur < 0.0 ? -1.0 : 1.0;
  if (g_frac) {
    g_scale /= 10.0;
    g_cur += d * g_scale * sign;
    g_digits_after_dot += 1;
  } else {
    g_cur = g_cur * 10.0 + d * sign;
    g_scale = 1.0;
  }
  g_last_digit = d;
}

void dot(void) {
  if (g_err) clear_all();
  if (g_start_new) {
    reset_entry();
    g_start_new = 0;
  }
  if (!g_frac) g_frac = 1;
}

void back(void) {
  if (g_err) {
    clear_all();
    return;
  }
  if (g_start_new) return;
  if (g_frac && g_digits_after_dot == 0) {
    g_frac = 0;
    return;
  }
  if (g_frac) {
    g_cur -= g_last_digit * g_scale;
    g_scale *= 10.0;
    g_digits_after_dot -= 1;
    if (g_digits_after_dot > 0) {
      recompute_last();
    } else {
      g_frac = 0;
      g_scale = 1.0;
      recompute_last();
    }
  } else {
    g_cur = __builtin_trunc((g_cur - g_last_digit) / 10.0);
    recompute_last();
    if (g_cur == 0.0) g_start_new = 1;
  }
}

void neg(void) {
  if (g_err) {
    clear_all();
    return;
  }
  if (g_start_new && g_op) {
    g_acc = -g_acc;
  } else {
    g_cur = -g_cur;
    recompute_last();
  }
}

void op(int code) {
  if (g_err) clear_all();
  if (g_op) {
    if (!g_start_new) {
      apply_op();
      g_cur = g_acc;
    }
  } else {
    g_acc = g_cur;
  }
  g_last_op = code;
  g_op = code;
  g_start_new = 1;
  g_frac = 0;
  g_digits_after_dot = 0;
  g_scale = 1.0;
  g_last_digit = 0.0;
  g_err = 0;
}

void equals(void) {
  if (g_err) return;
  if (!g_op && g_last_op && g_start_new) {
    g_op = g_last_op;
    g_cur = g_operand;
  }
  if (g_op) {
    g_left_operand = g_acc;
    g_operand = g_cur;
    apply_op();
    g_cur = g_acc;
    g_last_op = g_op;
    g_op = 0;
    g_start_new = 1;
    g_frac = 0;
    g_digits_after_dot = 0;
    g_scale = 1.0;
    g_last_digit = 0.0;
  } else {
    g_start_new = 1;
  }
}

double display(void) { return (g_op && g_start_new) ? g_acc : g_cur; }
double acc(void) { return g_acc; }
double cur(void) { return g_cur; }
int opCode(void) { return g_op; }
int error(void) { return g_err; }
int fresh(void) { return g_start_new; }
int lastOp(void) { return g_last_op; }
double operand(void) { return g_operand; }
double leftOperand(void) { return g_left_operand; }
