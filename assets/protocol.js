// Общий протокол для Node и браузера: один и тот же API, тесты и нагрузка.
// Никакого DOM — модуль импортируется и в статье, и в бенчмарке.

export const OP = { '+': 1, '−': 2, '×': 3, '÷': 4 };

export const REQUIRED_EXPORTS = [
  'clear', 'ce', 'digit', 'dot', 'back', 'neg', 'op', 'equals',
  'display', 'acc', 'cur', 'opCode', 'error', 'fresh', 'lastOp',
  'operand', 'leftOperand',
];

// 16 сценариев ввода/арифметики.
export const CASES = [
  [[1, 2, '+', 3, '='], 15],
  [[7, '×', 8, '='], 56],
  [[9, '−', 1, 2, '='], -3],
  [[8, '÷', 2, '='], 4],
  [[1, '.', 5, '+', 2, '.', 2, 5, '='], 3.75],
  [[1, 2, '+', 3, '×', 4, '='], 60],
  [[2, '+', 3, '=', '='], 8],
  [[1, 0, '÷', 4, '÷', 2, '='], 1.25],
  [[1, 2, 3, 'back'], 12],
  [[1, 2, '.', 3, 4, 'back', 'back'], 12],
  [[1, 2, 'neg'], -12],
  [[1, 2, 'neg', 3], -123],
  [[1, 2, 'neg', 'back'], -1],
  [[5, '÷', 0, '='], null],
  [[5, '÷', 0, '=', 9], 9],
  [[2, '×', 3, '=', '×', 4, '='], 24],
];

export function apply(w, token) {
  if (typeof token === 'number') {
    if (Number.isInteger(token) && token >= 0 && token <= 9) w.digit(token);
    else w.op(token);
    return;
  }
  if (token === '.') w.dot();
  else if (token === '=') w.equals();
  else if (token === 'back') w.back();
  else if (token === 'neg') w.neg();
  else if (token === 'ce') w.ce();
  else if (token in OP) w.op(OP[token]);
  else throw new Error(`unknown token ${token}`);
}

export function feed(w, seq) {
  w.clear();
  for (const token of seq) apply(w, token);
}

function close(a, b) {
  return Math.abs(a - b) < 1e-9;
}

// 16 сценариев + проверка operand()/leftOperand() после «=».
export function runTests(w) {
  const failures = [];

  for (let i = 0; i < CASES.length; i++) {
    const [seq, expected] = CASES[i];
    feed(w, seq);
    const ok = expected === null
      ? w.error() === 1
      : w.error() === 0 && close(w.display(), expected);
    if (!ok) failures.push(`case #${i + 1}: expected ${expected === null ? 'error' : expected}, got ${w.error() ? 'error' : w.display()}`);
  }

  w.clear();
  w.digit(8);
  w.op(3);
  w.digit(8);
  w.equals();
  const first = [w.display(), w.leftOperand(), w.operand()];
  w.equals();
  const second = [w.display(), w.leftOperand(), w.operand()];

  const formulaOk =
    close(first[0], 64) && close(first[1], 8) && close(first[2], 8) &&
    close(second[0], 512) && close(second[1], 64) && close(second[2], 8);
  if (!formulaOk) failures.push('formula: 8 × 8 = 64, then 64 × 8 = 512');

  w.clear();
  return {
    passed: CASES.length + 1 - failures.length,
    total: CASES.length + 1,
    failures,
  };
}

export function missingExports(w) {
  return REQUIRED_EXPORTS.filter((name) => typeof w[name] !== 'function');
}

// Детерминированная нагрузка: одинаковые последовательности для всех сборок.
export const WORKLOAD = [
  [7, '+', 8, '='],
  [1, 2, '×', 3, '='],
  [9, '−', 4, '='],
  [8, '÷', 2, '='],
  [1, '.', 5, '+', 2, '.', 2, 5, '='],
  [2, '×', 3, '=', '='],
  [1, 2, 3, 'back'],
  [4, 5, 'neg', '+', 5, '='],
  [3, '.', 1, 4, '×', 2, '='],
  [9, 9, '−', 1, 0, '='],
  [6, '÷', 4, '='],
  [1, 2, '.', 5, 'neg', 'back'],
];

export const WORKLOAD_OPS = WORKLOAD.reduce((sum, seq) => sum + seq.length + 1, 0);

function runWorkload(w) {
  for (const seq of WORKLOAD) {
    w.clear();
    for (const token of seq) apply(w, token);
  }
}

// ops/sec: вызовы API (включая clear) в секунду. Медиана из `rounds` замеров.
// Протокол статьи (Node): прогрев 750 мс, затем 10 окон по 150 мс, шесть процессов.
// Меряется одна сборка на процесс (Node) или на Worker (браузер) — см. builds/bench-one.mjs
// и assets/bench-client.js: несколько горячих модулей в одном контексте искажают результат.
export function benchmark(w, { rounds = 10, durationMs = 150, warmupMs = 750 } = {}) {
  warmUp(w, warmupMs);
  const samples = [];
  for (let r = 0; r < rounds; r++) samples.push(measureRound(w, durationMs));
  return { opsPerSec: medianSample(samples), samples };
}

// Разброс по всем замерам: минимум, среднее, медиана, максимум, стандартное отклонение.
// Медиана — заголовочное число: она устойчива к одиночным выбросам, в отличие от среднего.
export function describeStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: sorted[Math.floor(n / 2)],
    stddev: Math.sqrt(variance),
  };
}

function warmUp(w, warmupMs) {
  const start = performance.now();
  while (performance.now() - start < warmupMs) runWorkload(w);
}

function measureRound(w, durationMs) {
  let ops = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < durationMs) {
    runWorkload(w);
    ops += WORKLOAD_OPS;
    elapsed = performance.now() - start;
  }
  return ops / (elapsed / 1000);
}

function medianSample(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
