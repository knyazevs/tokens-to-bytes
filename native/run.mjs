import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clang = path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe'
);

const harnessSrc = path.join(root, 'native/harness.cpp');
const cppSrc = path.join(root, 'native/sort4_cpp.cpp');
const asmSrc = path.join(root, 'native/sort4_asm.s');
const exeOut = path.join(root, 'native/bench_sort4.exe');

console.log('[1/2] Compiling with clang -O3 -march=native...');
const build = spawnSync(
  clang,
  ['-O3', '-march=native', harnessSrc, cppSrc, asmSrc, '-o', exeOut],
  { stdio: 'inherit' }
);

if (build.status !== 0) {
  console.error('Build failed!');
  process.exit(1);
}

console.log('[2/2] Running benchmark harness...\n');
const run = spawnSync(exeOut, [], { stdio: 'inherit' });
if (run.status !== 0) {
  console.error('Execution failed!');
  process.exit(run.status ?? 1);
}
