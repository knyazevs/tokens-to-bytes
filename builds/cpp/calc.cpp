struct Calc {
  double acc = 0.0;
  double cur = 0.0;
  double scale = 1.0;
  double lastDigit = 0.0;
  double operand = 0.0;
  double leftOperand = 0.0;

  int op = 0;
  int lastOp = 0;
  int startNew = 1;
  int frac = 0;
  int digitsAfterDot = 0;
  int err = 0;

  inline void resetEntry() {
    cur = 0.0;
    scale = 1.0;
    lastDigit = 0.0;
    startNew = 1;
    frac = 0;
    digitsAfterDot = 0;
  }

  inline void clearAll() {
    resetEntry();
    acc = 0.0;
    op = 0;
    lastOp = 0;
    err = 0;
    operand = 0.0;
    leftOperand = 0.0;
  }

  inline void recomputeLast() {
    double t = __builtin_trunc(__builtin_fabs(cur / scale) + 1e-9);
    double d = t - __builtin_trunc(t / 10.0) * 10.0;
    if (cur < 0.0) d = -d;
    lastDigit = d;
  }

  inline void applyOp() {
    switch (op) {
      case 1: acc += cur; break;
      case 2: acc -= cur; break;
      case 3: acc *= cur; break;
      case 4:
        if (cur == 0.0) {
          err = 1;
          acc = 0.0;
        } else {
          acc /= cur;
        }
        break;
      default: acc = cur; break;
    }
  }

  void digit(int value) {
    if (err) clearAll();
    if (startNew) {
      resetEntry();
      startNew = 0;
    }
    double d = static_cast<double>(value);
    double sign = cur < 0.0 ? -1.0 : 1.0;
    if (frac) {
      scale *= 0.1;
      cur += d * scale * sign;
      ++digitsAfterDot;
    } else {
      cur = cur * 10.0 + d * sign;
      scale = 1.0;
    }
    lastDigit = d;
  }

  void dot() {
    if (err) clearAll();
    if (startNew) {
      resetEntry();
      startNew = 0;
    }
    if (!frac) frac = 1;
  }

  void back() {
    if (err) {
      clearAll();
      return;
    }
    if (startNew) return;
    if (frac && digitsAfterDot == 0) {
      frac = 0;
      return;
    }
    if (frac) {
      cur -= lastDigit * scale;
      scale *= 10.0;
      --digitsAfterDot;
      if (digitsAfterDot > 0) {
        recomputeLast();
      } else {
        frac = 0;
        scale = 1.0;
        recomputeLast();
      }
    } else {
      cur = __builtin_trunc((cur - lastDigit) / 10.0);
      recomputeLast();
      if (cur == 0.0) startNew = 1;
    }
  }

  void neg() {
    if (err) {
      clearAll();
      return;
    }
    if (startNew && op) {
      acc = -acc;
    } else {
      cur = -cur;
      recomputeLast();
    }
  }

  void setOp(int code) {
    if (err) clearAll();
    if (op) {
      if (!startNew) {
        applyOp();
        cur = acc;
      }
    } else {
      acc = cur;
    }
    lastOp = code;
    op = code;
    startNew = 1;
    frac = 0;
    digitsAfterDot = 0;
    scale = 1.0;
    lastDigit = 0.0;
    err = 0;
  }

  void equals() {
    if (err) return;
    if (!op && lastOp && startNew) {
      op = lastOp;
      cur = operand;
    }
    if (op) {
      leftOperand = acc;
      operand = cur;
      applyOp();
      cur = acc;
      lastOp = op;
      op = 0;
      startNew = 1;
      frac = 0;
      digitsAfterDot = 0;
      scale = 1.0;
      lastDigit = 0.0;
    } else {
      startNew = 1;
    }
  }
};

static Calc calc;

extern "C" {

void clear() { calc.clearAll(); }
void ce() {
  calc.resetEntry();
  calc.err = 0;
}
void digit(int value) { calc.digit(value); }
void dot() { calc.dot(); }
void back() { calc.back(); }
void neg() { calc.neg(); }
void op(int code) { calc.setOp(code); }
void equals() { calc.equals(); }

double display() { return (calc.op && calc.startNew) ? calc.acc : calc.cur; }
double acc() { return calc.acc; }
double cur() { return calc.cur; }
int opCode() { return calc.op; }
int error() { return calc.err; }
int fresh() { return calc.startNew; }
int lastOp() { return calc.lastOp; }
double operand() { return calc.operand; }
double leftOperand() { return calc.leftOperand; }

}
