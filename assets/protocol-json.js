// Протокол JSON-парсера: общий API, тесты и нагрузка для Node и браузера.
// Вход и выход живут в памяти модуля; JS только копирует байты и читает счётчики.
//
// API (все имена с префиксом json_):
//   json_input_ptr() -> i32          указатель на входной буфер (64 КиБ)
//   json_parse(len) -> i32           0 — успех, иначе код ошибки
//   json_error_pos() -> i32          байтовое смещение ошибки
//   json_error_code() -> i32         0 — успех, иначе код ошибки
//   json_root_type() -> i32          0 null, 1 false, 2 true, 3 number,
//                                    4 string, 5 array, 6 object
//   json_root_number() -> f64        значение корневого числа
//   json_root_len() -> i32           длина строки / элементов / членов объекта
//   json_root_ptr() -> i32           декодированные байты корневой строки
//   json_nodes() -> i32              значений, включая контейнеры
//   json_depth() -> i32              максимальная глубина
//   json_numbers() -> i32            чисел
//   json_strings() -> i32            строк, включая ключи объектов
//   json_string_bytes() -> i32       байт в декодированных строках

import { benchmarkWorkload, describeStats } from './bench-core.js';

export const REQUIRED_EXPORTS = [
  'json_input_ptr', 'json_parse', 'json_error_pos', 'json_error_code',
  'json_root_type', 'json_root_number', 'json_root_len', 'json_root_ptr',
  'json_nodes', 'json_depth', 'json_numbers', 'json_strings', 'json_string_bytes',
];

export const TYPE = { null: 0, false: 1, true: 2, number: 3, string: 4, array: 5, object: 6 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DOCUMENTS = [
  '{"id":1,"name":"alpha","active":true,"score":12.5,"tags":["a","b","c"],"meta":null}',
  `[${Array.from({ length: 100 }, (_, i) => i).join(',')}]`,
  `{"users":[${Array.from({ length: 24 }, (_, i) =>
    `{"id":${i + 1},"name":"user-${i + 1}","active":${i % 2 === 0},"score":${(i * 3.25).toFixed(2)}}`,
  ).join(',')}],"total":24,"ok":true}`,
  '{"escaped":"line\\nquote\\"slash\\\\tab\\tunicode\\u00e9","nested":{"a":[1,2,{"b":3}]}}',
  '[-0,1e10,1.5e-3,123456789,0.000001,42,6.022e23,-7.5E-2]',
  '{"deep":[[[[[[[1]]]]]]],"empty":{},"none":[],"flag":false}',
  '{"emoji":"\\ud83d\\ude00","latin":"caf\\u00e9","raw":"привет","mix":"a\\u0000b"}',
  '{"emptyArray":[],"emptyObject":{},"nested":{"objects":[{"x":1},{"y":[true,false,null]}]}}',
  `"${'long-string-'.repeat(24)}end"`,
  '  {  "spaced" : [ 1 , 2 , 3 ] , "ok" : true }  ',
  '-123.5e2',
  'null',
  'true',
].map((text) => encoder.encode(text));

function utf8Length(text) {
  return encoder.encode(text).length;
}

export function analyze(text) {
  let root = JSON.parse(text);
  let nodes = 0;
  let numbers = 0;
  let strings = 0;
  let stringBytes = 0;
  let depth = 0;
  let rootLen = 0;

  const visit = (value, level) => {
    nodes++;
    if (level > depth) depth = level;
    if (typeof value === 'number') numbers++;
    if (typeof value === 'string') {
      strings++;
      stringBytes += utf8Length(value);
      if (level === 1) rootLen = utf8Length(value);
    }
    if (Array.isArray(value)) {
      if (level === 1) rootLen = value.length;
      for (const item of value) visit(item, level + 1);
    } else if (value && typeof value === 'object') {
      if (level === 1) rootLen = Object.keys(value).length;
      for (const [key, item] of Object.entries(value)) {
        strings++;
        stringBytes += utf8Length(key);
        visit(item, level + 1);
      }
    }
  };

  visit(root, 1);

  const type = root === null ? TYPE.null
    : root === false ? TYPE.false
      : root === true ? TYPE.true
        : typeof root === 'number' ? TYPE.number
          : typeof root === 'string' ? TYPE.string
            : Array.isArray(root) ? TYPE.array : TYPE.object;

  return {
    type,
    rootLen,
    number: typeof root === 'number' ? root : 0,
    string: typeof root === 'string' ? root : '',
    nodes,
    depth,
    numbers,
    strings,
    stringBytes,
  };
}

const VALID = DOCUMENTS.map((bytes) => {
  const text = decoder.decode(bytes);
  return { bytes, expected: analyze(text), text };
});

const INVALID = [
  ['', 2, 0],
  ['{', 2, 1],
  ['{"a":}', 1, 5],
  ['[1,]', 1, 3],
  ['{"a" 1}', 1, 5],
  ['01', 5, 1],
  ['1.', 5, 2],
  ['"abc', 2, 4],
  ['"a\nb"', 6, 2],
  ['"\\x"', 6, 1],
  ['"\\u12g4"', 6, 1],
  ['true false', 3, 5],
  ['[1 2]', 1, 3],
  [`${'['.repeat(65)}0${']'.repeat(65)}`, 4, 64],
].map(([text, code, pos]) => ({ bytes: encoder.encode(text), code, pos, text }));

export function missingExports(w) {
  const missing = REQUIRED_EXPORTS.filter((name) => typeof w[name] !== 'function');
  if (!(w.memory instanceof WebAssembly.Memory)) missing.push('memory');
  return missing;
}

function view(w) {
  return new Uint8Array(w.memory.buffer);
}

function writeInput(w, bytes) {
  const ptr = w.json_input_ptr();
  const mem = view(w);
  if (ptr < 0 || ptr + bytes.length > mem.length) throw new Error('input does not fit');
  mem.set(bytes, ptr);
  return ptr;
}

function readRootString(w) {
  const ptr = w.json_root_ptr();
  const len = w.json_root_len();
  return decoder.decode(view(w).slice(ptr, ptr + len));
}

function close(a, b) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export function runTests(w) {
  const failures = [];
  let passed = 0;

  for (let i = 0; i < VALID.length; i++) {
    const { bytes, expected, text } = VALID[i];
    let problem = '';
    try {
      writeInput(w, bytes);
      const code = w.json_parse(bytes.length);
      if (code !== 0) problem = `parse returned ${code}`;
      else if (w.json_error_code() !== 0) problem = `error_code ${w.json_error_code()}`;
      else if (w.json_root_type() !== expected.type) problem = `type ${w.json_root_type()} != ${expected.type}`;
      else if (w.json_nodes() !== expected.nodes) problem = `nodes ${w.json_nodes()} != ${expected.nodes}`;
      else if (w.json_depth() !== expected.depth) problem = `depth ${w.json_depth()} != ${expected.depth}`;
      else if (w.json_numbers() !== expected.numbers) problem = `numbers ${w.json_numbers()} != ${expected.numbers}`;
      else if (w.json_strings() !== expected.strings) problem = `strings ${w.json_strings()} != ${expected.strings}`;
      else if (w.json_string_bytes() !== expected.stringBytes) problem = `string_bytes ${w.json_string_bytes()} != ${expected.stringBytes}`;
      else if (w.json_root_len() !== expected.rootLen) problem = `root_len ${w.json_root_len()} != ${expected.rootLen}`;
      else if (expected.type === TYPE.number && !close(w.json_root_number(), expected.number)) {
        problem = `number ${w.json_root_number()} != ${expected.number}`;
      } else if (expected.type === TYPE.string && readRootString(w) !== expected.string) {
        problem = `root string mismatch`;
      }
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`valid #${i + 1} (${text.slice(0, 32)}…): ${problem}`);
    else passed++;
  }

  for (let i = 0; i < INVALID.length; i++) {
    const { bytes, code, pos, text } = INVALID[i];
    let problem = '';
    try {
      writeInput(w, bytes);
      const got = w.json_parse(bytes.length);
      if (got !== code) problem = `parse ${got} != ${code}`;
      else if (w.json_error_code() !== code) problem = `error_code ${w.json_error_code()} != ${code}`;
      else if (w.json_error_pos() !== pos) problem = `error_pos ${w.json_error_pos()} != ${pos}`;
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`invalid #${i + 1} (${JSON.stringify(text.slice(0, 24))}…): ${problem}`);
    else passed++;
  }

  return { passed, total: VALID.length + INVALID.length, failures };
}

// Документы в детерминированном порядке; одна операция — разбор одного документа.
export const WORKLOAD = DOCUMENTS;
export const WORKLOAD_OPS = WORKLOAD.length;

let sink = 0;

export function runWorkload(w) {
  const mem = view(w);
  for (const bytes of WORKLOAD) {
    mem.set(bytes, w.json_input_ptr());
    w.json_parse(bytes.length);
    sink ^= w.json_nodes() + w.json_depth() + w.json_numbers() + w.json_strings() + w.json_string_bytes();
  }
}

export function benchmark(w, config) {
  return benchmarkWorkload(() => runWorkload(w), { ...config, opsPerPass: WORKLOAD_OPS });
}

export { describeStats };
