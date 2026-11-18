// Пересобирает обе C++-реализации одним и тем же clang.
// Базовая — оптимизация по размеру (-Oz), как в статье.
// Отдельный артефакт — оптимизация по скорости (-O3).
//
// Путь к clang можно переопределить: CLANG=/path/to/clang node builds/build-cpp.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = 'builds/cpp/calc.cpp';

const exports = [
  'clear', 'ce', 'digit', 'dot', 'back', 'neg', 'op', 'equals',
  'display', 'acc', 'cur', 'opCode', 'error', 'fresh', 'lastOp',
  'operand', 'leftOperand',
];

const defaultClang = path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe',
);

const clang = process.env.CLANG || defaultClang;
if (!fs.existsSync(clang)) {
  console.error(`clang не найден: ${clang}`);
  console.error('Укажите путь: CLANG=/path/to/clang node builds/build-cpp.mjs');
  process.exit(1);
}

const variants = [
  { out: 'projects/calculator/calc-cpp.wasm', flags: ['-Oz'] },
  { out: 'projects/calculator/calc-cpp-opt.wasm', flags: ['-O3'] },
];

const common = [
  '--target=wasm32',
  '-nostdlib',
  '-Wl,--no-entry',
  '-Wl,--strip-all',
  '--driver-mode=g++',
  '-fno-exceptions',
  '-fno-rtti',
  ...exports.map((name) => `-Wl,--export=${name}`),
];

for (const { out, flags } of variants) {
  const args = [...common, ...flags, '-o', out, src];
  const result = spawnSync(clang, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`${out}: ${fs.statSync(path.join(root, out)).size} B (${flags.join(' ')})`);
}
