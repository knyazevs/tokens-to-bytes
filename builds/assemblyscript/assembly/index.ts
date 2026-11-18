let gAcc: f64 = 0.0;
let gCur: f64 = 0.0;
let gScale: f64 = 1.0;
let gLastDigit: f64 = 0.0;
let gOperand: f64 = 0.0;
let gLeftOperand: f64 = 0.0;

let gOp: i32 = 0;
let gLastOp: i32 = 0;
let gStartNew: i32 = 1;
let gFrac: i32 = 0;
let gDigitsAfterDot: i32 = 0;
let gErr: i32 = 0;

function resetEntry(): void {
  gCur = 0.0;
  gScale = 1.0;
  gLastDigit = 0.0;
  gStartNew = 1;
  gFrac = 0;
  gDigitsAfterDot = 0;
}

function clearAll(): void {
  resetEntry();
  gAcc = 0.0;
  gOp = 0;
  gLastOp = 0;
  gErr = 0;
  gOperand = 0.0;
  gLeftOperand = 0.0;
}

function recomputeLast(): void {
  let t = Math.trunc(Math.abs(gCur / gScale) + 1e-9);
  let d = t - Math.trunc(t / 10.0) * 10.0;
  if (gCur < 0.0) d = -d;
  gLastDigit = d;
}

function applyOp(): void {
  if (gOp == 1) {
    gAcc += gCur;
  } else if (gOp == 2) {
    gAcc -= gCur;
  } else if (gOp == 3) {
    gAcc *= gCur;
  } else if (gOp == 4) {
    if (gCur == 0.0) {
      gErr = 1;
      gAcc = 0.0;
    } else {
      gAcc /= gCur;
    }
  } else {
    gAcc = gCur;
  }
}

export function clear(): void {
  clearAll();
}

export function ce(): void {
  resetEntry();
  gErr = 0;
}

export function digit(value: i32): void {
  if (gErr != 0) clearAll();
  if (gStartNew != 0) {
    resetEntry();
    gStartNew = 0;
  }
  let d = <f64>value;
  let sign: f64 = gCur < 0.0 ? -1.0 : 1.0;
  if (gFrac != 0) {
    gScale /= 10.0;
    gCur += d * gScale * sign;
    gDigitsAfterDot += 1;
  } else {
    gCur = gCur * 10.0 + d * sign;
    gScale = 1.0;
  }
  gLastDigit = d;
}

export function dot(): void {
  if (gErr != 0) clearAll();
  if (gStartNew != 0) {
    resetEntry();
    gStartNew = 0;
  }
  if (gFrac == 0) gFrac = 1;
}

export function back(): void {
  if (gErr != 0) {
    clearAll();
    return;
  }
  if (gStartNew != 0) return;
  if (gFrac != 0 && gDigitsAfterDot == 0) {
    gFrac = 0;
    return;
  }
  if (gFrac != 0) {
    gCur -= gLastDigit * gScale;
    gScale *= 10.0;
    gDigitsAfterDot -= 1;
    if (gDigitsAfterDot > 0) {
      recomputeLast();
    } else {
      gFrac = 0;
      gScale = 1.0;
      recomputeLast();
    }
  } else {
    gCur = Math.trunc((gCur - gLastDigit) / 10.0);
    recomputeLast();
    if (gCur == 0.0) gStartNew = 1;
  }
}

export function neg(): void {
  if (gErr != 0) {
    clearAll();
    return;
  }
  if (gStartNew != 0 && gOp != 0) {
    gAcc = -gAcc;
  } else {
    gCur = -gCur;
    recomputeLast();
  }
}

export function op(code: i32): void {
  if (gErr != 0) clearAll();
  if (gOp != 0) {
    if (gStartNew == 0) {
      applyOp();
      gCur = gAcc;
    }
  } else {
    gAcc = gCur;
  }
  gLastOp = code;
  gOp = code;
  gStartNew = 1;
  gFrac = 0;
  gDigitsAfterDot = 0;
  gScale = 1.0;
  gLastDigit = 0.0;
  gErr = 0;
}

export function equals(): void {
  if (gErr != 0) return;
  if (gOp == 0 && gLastOp != 0 && gStartNew != 0) {
    gOp = gLastOp;
    gCur = gOperand;
  }
  if (gOp != 0) {
    gLeftOperand = gAcc;
    gOperand = gCur;
    applyOp();
    gCur = gAcc;
    gLastOp = gOp;
    gOp = 0;
    gStartNew = 1;
    gFrac = 0;
    gDigitsAfterDot = 0;
    gScale = 1.0;
    gLastDigit = 0.0;
  } else {
    gStartNew = 1;
  }
}

export function display(): f64 {
  return gOp != 0 && gStartNew != 0 ? gAcc : gCur;
}

export function acc(): f64 { return gAcc; }
export function cur(): f64 { return gCur; }
export function opCode(): i32 { return gOp; }
export function error(): i32 { return gErr; }
export function fresh(): i32 { return gStartNew; }
export function lastOp(): i32 { return gLastOp; }
export function operand(): f64 { return gOperand; }
export function leftOperand(): f64 { return gLeftOperand; }
