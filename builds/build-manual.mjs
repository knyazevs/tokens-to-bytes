// Пересобирает ручной модуль из WAT тем же wasm-as, которым он собран в статье.
//
// Путь к wasm-as можно переопределить: WASM_AS=/path/to/wasm-as node builds/build-manual.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = 'projects/calculator/calc.wat';
const out = 'projects/calculator/calc.wasm';

const local = [
  path.join(root, '.tools/node_modules/.bin/wasm-as.cmd'),
  path.join(root, '.tools/node_modules/.bin/wasm-as'),
].find((p) => fs.existsSync(p));
const bin = process.env.WASM_AS || local || 'wasm-as';

const args = [src, '-o', out];
const result = process.platform === 'win32' && /\.cmd$/i.test(bin)
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', bin, ...args], { cwd: root, stdio: 'inherit' })
  : spawnSync(bin, args, { cwd: root, stdio: 'inherit' });

if (result.error) {
  console.error(`wasm-as не запустился: ${result.error.message}`);
  console.error('Установите binaryen или укажите путь: WASM_AS=/path/to/wasm-as node builds/build-manual.mjs');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`${out}: ${fs.statSync(path.join(root, out)).size} B`);
