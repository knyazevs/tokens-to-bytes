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

const optOut = 'projects/calculator/calc-opt.wasm';
const optLocal = [
  path.join(root, '.tools/node_modules/.bin/wasm-opt.cmd'),
  path.join(root, '.tools/node_modules/.bin/wasm-opt'),
].find((p) => fs.existsSync(p));
const optBin = process.env.WASM_OPT || optLocal || 'wasm-opt';
const optArgs = [out, '-Oz', '--enable-bulk-memory-opt', '-o', optOut];
const optResult = process.platform === 'win32' && /\.cmd$/i.test(optBin)
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', optBin, ...optArgs], { cwd: root, stdio: 'inherit' })
  : spawnSync(optBin, optArgs, { cwd: root, stdio: 'inherit' });
if (optResult.status === 0) {
  console.log(`${optOut}: ${fs.statSync(path.join(root, optOut)).size} B`);
}

const v2Src = 'projects/calculator/calc-v2.wat';
const v2Out = 'projects/calculator/calc-v2.wasm';
if (fs.existsSync(path.join(root, v2Src))) {
  const v2Args = [v2Src, '-o', v2Out];
  const r = process.platform === 'win32' && /\.cmd$/i.test(bin)
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', bin, ...v2Args], { cwd: root, stdio: 'inherit' })
    : spawnSync(bin, v2Args, { cwd: root, stdio: 'inherit' });
  if (r.status === 0) {
    console.log(`${v2Out}: ${fs.statSync(path.join(root, v2Out)).size} B`);
    const v2OptOut = 'projects/calculator/calc-v2-opt.wasm';
    const optR = process.platform === 'win32' && /\.cmd$/i.test(optBin)
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', optBin, v2Out, '-Oz', '--enable-bulk-memory-opt', '-o', v2OptOut], { cwd: root, stdio: 'inherit' })
      : spawnSync(optBin, [v2Out, '-Oz', '--enable-bulk-memory-opt', '-o', v2OptOut], { cwd: root, stdio: 'inherit' });
    if (optR.status === 0) {
      console.log(`${v2OptOut}: ${fs.statSync(path.join(root, v2OptOut)).size} B`);
    }
  }
}
