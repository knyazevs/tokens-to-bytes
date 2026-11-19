import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clang = path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe'
);

const targets = {
  sort4: {
    name: 'Duel 1: AlphaDev-style Branchless Sort4 (Issue #2)',
    sources: ['native/harness.cpp', 'native/sort4_cpp.cpp', 'native/sort4_asm.s'],
    exe: 'native/bench_sort4.exe',
  },
  types: {
    name: 'Duel 2: Packed Custom Types vs Memory Wall (Issue #3)',
    sources: ['native/types_harness.cpp', 'native/types_cpp.cpp', 'native/types_asm.s'],
    exe: 'native/bench_types.exe',
  },
};

const filter = process.argv[2];
const selected = filter && targets[filter] ? { [filter]: targets[filter] } : targets;

for (const [key, t] of Object.entries(selected)) {
  console.log(`\n======================================================================`);
  console.log(`>>> ${t.name}`);
  console.log(`======================================================================`);
  const exeOut = path.join(root, t.exe);
  const srcFiles = t.sources.map((s) => path.join(root, s));

  console.log(`[1/2] Compiling with clang -O3 -march=native...`);
  const build = spawnSync(
    clang,
    ['-O3', '-march=native', ...srcFiles, '-o', exeOut],
    { stdio: 'inherit' }
  );

  if (build.status !== 0) {
    console.error(`Build failed for ${key}!`);
    process.exit(1);
  }

  console.log(`[2/2] Running benchmark...\n`);
  const run = spawnSync(exeOut, [], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`Execution failed for ${key}!`);
    process.exit(run.status ?? 1);
  }
}
