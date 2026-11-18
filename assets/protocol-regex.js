// Протокол regex-движка: общий API, тесты и нагрузка для Node и браузера.
// Компиляция отделена от поиска: сначала re_compile, затем сколько угодно
// re_match по одному и тому же байткоду. Паттерн и текст лежат в памяти модуля.
//
// API:
//   re_pattern_ptr() -> i32    буфер паттерна (4 КиБ)
//   re_text_ptr() -> i32       буфер текста (8 КиБ)
//   re_compile(len) -> i32     0 — успех, иначе код ошибки
//   re_match(len) -> i32       1 — совпадение, 0 — нет, -1 — ошибка
//   re_error() -> i32          код последней ошибки
//   re_error_pos() -> i32      байтовое смещение ошибки
//   re_steps() -> i32          шагов VM в последнем re_match
//
// Поддерживается: литералы, `.`, классы `[...]`/`[^...]` с диапазонами и
// \d \w \s, якоря ^ $, группы без захватов, альтернатива |, жадные
// квантификаторы * + ?. Флагов, захватов, {m,n} и ленивых квантификаторов нет.
// Поиск неякорный: движок пробует каждую стартовую позицию.

import { benchmarkWorkload, describeStats } from './bench-core.js';

export const REQUIRED_EXPORTS = [
  're_pattern_ptr', 're_text_ptr', 're_compile', 're_match',
  're_error', 're_error_pos', 're_steps',
];

export const ERR = {
  none: 0,
  char: 1,
  unmatchedOpen: 2,
  unmatchedClose: 3,
  class: 4,
  escape: 5,
  program: 6,
  quant: 7,
  steps: 8,
  patternLen: 9,
  textLen: 10,
  notCompiled: 11,
  stack: 12,
};

const encoder = new TextEncoder();

// Корректные пары «паттерн → текст»: 1 — есть совпадение, 0 — нет.
export const CASES = [
  { pattern: '^[a-z][a-z0-9_]*$', text: 'identifier_42', match: 1 },
  { pattern: '^[a-z][a-z0-9_]*$', text: '42identifier', match: 0 },
  { pattern: '\\d+\\.\\d+', text: 'pi is 3.14 exactly', match: 1 },
  { pattern: '^\\d+\\.\\d+$', text: '3.14', match: 1 },
  { pattern: '^\\d+\\.\\d+$', text: '3.', match: 0 },
  { pattern: '^(cat|dog|fox)$', text: 'dog', match: 1 },
  { pattern: '^(cat|dog|fox)$', text: 'cow', match: 0 },
  { pattern: 'a.*z', text: 'xxabcxyz', match: 1 },
  { pattern: 'a.*z', text: 'abc', match: 0 },
  { pattern: '^[^a]+b', text: 'xxb', match: 1 },
  { pattern: '^[^a]+b', text: 'axb', match: 0 },
  { pattern: '\\w+@\\w+\\.\\w+', text: 'mail: user_1@host9.org', match: 1 },
  { pattern: '\\w+@\\w+\\.\\w+', text: 'no email here', match: 0 },
  { pattern: '^\\s*$', text: ' \t\r\n ', match: 1 },
  { pattern: '^\\s*$', text: ' x ', match: 0 },
  { pattern: '(ab)+c', text: 'zzababc', match: 1 },
  { pattern: '(ab)+c', text: 'abac', match: 0 },
  { pattern: 'colou?r', text: 'the colour red', match: 1 },
  { pattern: 'colou?r', text: 'the color red', match: 1 },
  { pattern: 'colou?r', text: 'the coral red', match: 0 },
  { pattern: 'a+b', text: 'b', match: 0 },
  { pattern: '^$', text: '', match: 1 },
  { pattern: '^$', text: 'x', match: 0 },
  { pattern: '^', text: 'abc', match: 1 },
  { pattern: '$', text: 'abc', match: 1 },
  { pattern: '\\[\\d+\\]', text: 'see [42] here', match: 1 },
  { pattern: 'a\\.b', text: 'a.b', match: 1 },
  { pattern: 'a\\.b', text: 'axb', match: 0 },
  { pattern: 'x|y|z', text: 'qy', match: 1 },
  { pattern: '[a-c]+x', text: 'bcax', match: 1 },
  { pattern: '[a-c]+x', text: 'bcadx', match: 0 },
  { pattern: 'a*c', text: 'c', match: 1 },
  { pattern: 'a*c', text: 'aaab', match: 0 },
  { pattern: '\\n', text: 'a\nb', match: 1 },
  { pattern: '\\t', text: 'a\tb', match: 1 },
  { pattern: '[\\d]+', text: 'x42', match: 1 },
  { pattern: '()', text: 'anything', match: 1 },
  { pattern: 'a|', text: '', match: 1 },
  { pattern: '|b', text: 'b', match: 1 },
].map((item) => ({ ...item, patternBytes: encoder.encode(item.pattern), textBytes: encoder.encode(item.text) }));

// Некорректные паттерны: код ошибки и позиция.
export const INVALID = [
  { pattern: '(', code: 2, pos: 0 },
  { pattern: 'a(', code: 2, pos: 1 },
  { pattern: '((a)', code: 2, pos: 0 },
  { pattern: ')', code: 3, pos: 0 },
  { pattern: 'a)b', code: 3, pos: 1 },
  { pattern: '(a))', code: 3, pos: 3 },
  { pattern: '[abc', code: 4, pos: 0 },
  { pattern: '[]', code: 4, pos: 0 },
  { pattern: '[^]', code: 4, pos: 0 },
  { pattern: '[z-a]', code: 4, pos: 3 },
  { pattern: 'a\\', code: 5, pos: 1 },
  { pattern: '\\', code: 5, pos: 0 },
  { pattern: '[a\\', code: 5, pos: 3 },
  { pattern: '*a', code: 7, pos: 0 },
  { pattern: 'a**', code: 7, pos: 2 },
  { pattern: 'a|+', code: 7, pos: 2 },
  { pattern: '^*', code: 7, pos: 1 },
  { pattern: '$?', code: 7, pos: 1 },
].map((item) => ({ ...item, patternBytes: encoder.encode(item.pattern) }));

// Нагрузка: реалистичные пары с текстами в сотни байт.
export const WORKLOAD_CASES = [
  { pattern: '^[a-z][a-z0-9_]*$', text: 'user_profile_2026' },
  { pattern: '\\d+\\.\\d+', text: 'values: ' + '123.45 '.repeat(40) },
  { pattern: '^\\d+\\.\\d+$', text: '3.1415926535' },
  { pattern: '^(cat|dog|fox)$', text: 'fox' },
  { pattern: 'a.*z', text: 'x'.repeat(200) + 'a' + 'y'.repeat(200) + 'z' },
  { pattern: '^[^a]+b', text: 'q'.repeat(300) + 'b' },
  { pattern: '\\w+@\\w+\\.\\w+', text: 'contact: ' + 'nobody '.repeat(30) + 'user_1@host9.org' },
  { pattern: '^\\s*$', text: ' \t\r\n'.repeat(50) },
  { pattern: '(ab)+c', text: 'z'.repeat(100) + 'ab'.repeat(50) + 'c' },
  { pattern: 'colou?r', text: 'the colour of the color '.repeat(20) },
  { pattern: '\\[\\d+\\]', text: 'log '.repeat(100) + '[42]' },
  { pattern: '[a-c]+x', text: 'q'.repeat(100) + 'abcabcx' },
].map((item) => ({ ...item, patternBytes: encoder.encode(item.pattern), textBytes: encoder.encode(item.text) }));

export function missingExports(w) {
  const missing = REQUIRED_EXPORTS.filter((name) => typeof w[name] !== 'function');
  if (!(w.memory instanceof WebAssembly.Memory)) missing.push('memory');
  return missing;
}

function view(w) {
  return new Uint8Array(w.memory.buffer);
}

function write(w, ptr, bytes) {
  const mem = view(w);
  if (ptr < 0 || ptr + bytes.length > mem.length) throw new Error('buffer does not fit');
  mem.set(bytes, ptr);
}

function compile(w, patternBytes) {
  write(w, w.re_pattern_ptr(), patternBytes);
  return w.re_compile(patternBytes.length);
}

function match(w, textBytes) {
  write(w, w.re_text_ptr(), textBytes);
  return w.re_match(textBytes.length);
}

export function runTests(w) {
  const failures = [];
  let passed = 0;

  // 1. re_match до успешной компиляции: ошибка 11.
  try {
    compile(w, encoder.encode('('));
    const result = match(w, encoder.encode('a'));
    if (result !== -1 || w.re_error() !== ERR.notCompiled) {
      failures.push(`not-compiled: match ${result}, error ${w.re_error()} (expected -1/11)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`not-compiled: ${err.message}`);
  }

  // 2. Паттерн длиннее буфера: ошибка 9 без чтения байтов.
  try {
    const code = w.re_compile(4097);
    if (code !== ERR.patternLen || w.re_error() !== ERR.patternLen || w.re_error_pos() !== 0) {
      failures.push(`pattern-too-long: ${code}/${w.re_error()}/${w.re_error_pos()} (expected 9/9/0)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`pattern-too-long: ${err.message}`);
  }

  // 3. Корректные пары.
  for (let i = 0; i < CASES.length; i++) {
    const { pattern, patternBytes, text, textBytes, match: expected } = CASES[i];
    let problem = '';
    try {
      const code = compile(w, patternBytes);
      if (code !== 0) problem = `compile returned ${code} (${w.re_error_pos()})`;
      else {
        const result = match(w, textBytes);
        if (result !== expected) problem = `match ${result} != ${expected}`;
        else if (w.re_error() !== 0) problem = `error ${w.re_error()}`;
      }
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`case #${i + 1} (${pattern} / ${JSON.stringify(text.slice(0, 24))}…): ${problem}`);
    else passed++;
  }

  // 4. Некорректные паттерны.
  for (let i = 0; i < INVALID.length; i++) {
    const { pattern, patternBytes, code: expected, pos } = INVALID[i];
    let problem = '';
    try {
      const code = compile(w, patternBytes);
      if (code !== expected) problem = `compile ${code} != ${expected}`;
      else if (w.re_error() !== expected) problem = `error ${w.re_error()} != ${expected}`;
      else if (w.re_error_pos() !== pos) problem = `pos ${w.re_error_pos()} != ${pos}`;
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`invalid #${i + 1} (${JSON.stringify(pattern)}): ${problem}`);
    else passed++;
  }

  // 5. Текст длиннее буфера: ошибка 10 после успешной компиляции.
  try {
    const code = compile(w, encoder.encode('a'));
    const result = code === 0 ? w.re_match(8193) : code;
    if (result !== -1 || w.re_error() !== ERR.textLen) {
      failures.push(`text-too-long: match ${result}, error ${w.re_error()} (expected -1/10)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`text-too-long: ${err.message}`);
  }

  // 6. Катастрофический бэктрекинг упирается в лимит шагов или стека, а не зависает.
  try {
    const code = compile(w, encoder.encode('(a+)+b'));
    const result = code === 0 ? match(w, encoder.encode('a'.repeat(40))) : code;
    const error = w.re_error();
    if (result !== -1 || (error !== ERR.steps && error !== ERR.stack)) {
      failures.push(`step-cap: match ${result}, error ${error} (expected -1/8 or -1/12)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`step-cap: ${err.message}`);
  }

  return { passed, total: 4 + CASES.length + INVALID.length, failures };
}

export const WORKLOAD = WORKLOAD_CASES;
export const WORKLOAD_OPS = WORKLOAD.length;

let sink = 0;

export function runWorkload(w) {
  for (const { patternBytes, textBytes } of WORKLOAD) {
    write(w, w.re_pattern_ptr(), patternBytes);
    const compiled = w.re_compile(patternBytes.length);
    write(w, w.re_text_ptr(), textBytes);
    const matched = compiled === 0 ? w.re_match(textBytes.length) : -1;
    sink ^= matched + w.re_steps() + w.re_error();
  }
}

export function benchmark(w, config) {
  return benchmarkWorkload(() => runWorkload(w), { ...config, opsPerPass: WORKLOAD_OPS });
}

export { describeStats };
