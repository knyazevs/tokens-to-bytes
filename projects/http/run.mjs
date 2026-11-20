import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runHttpTests } from '../../builds/test-http.mjs';
import { benchHttp } from '../../builds/bench-http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clang = path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe'
);

const targets = [
  {
    id: 'macro-asm',
    name: 'Macro-ASM (x86-64)',
    compile: () => {
      const res = spawnSync(
        clang,
        [
          '-O3',
          '-march=native',
          path.join(root, 'projects/http/asm/main.c'),
          path.join(root, 'projects/http/asm/http_macro.S'),
          '-lws2_32',
          '-o',
          path.join(root, 'projects/http/asm/server_asm.exe')
        ],
        { stdio: 'pipe' }
      );
      if (res.status !== 0) throw new Error(res.stderr.toString());
      return path.join(root, 'projects/http/asm/server_asm.exe');
    },
    sources: ['projects/http/asm/main.c', 'projects/http/asm/http_macro.S'],
    exe: 'projects/http/asm/server_asm.exe'
  },
  {
    id: 'c',
    name: 'C (Zero-Alloc)',
    compile: () => {
      const res = spawnSync(
        clang,
        [
          '-O3',
          '-march=native',
          path.join(root, 'projects/http/c/server.c'),
          '-lws2_32',
          '-o',
          path.join(root, 'projects/http/c/server.exe')
        ],
        { stdio: 'pipe' }
      );
      if (res.status !== 0) throw new Error(res.stderr.toString());
      return path.join(root, 'projects/http/c/server.exe');
    },
    sources: ['projects/http/c/server.c'],
    exe: 'projects/http/c/server.exe'
  },
  {
    id: 'cpp',
    name: 'C++20 (Zero-Alloc)',
    compile: () => {
      const res = spawnSync(
        clang,
        [
          '-std=c++20',
          '-O3',
          '-march=native',
          path.join(root, 'projects/http/cpp/server.cpp'),
          '-lws2_32',
          '-o',
          path.join(root, 'projects/http/cpp/server_cpp.exe')
        ],
        { stdio: 'pipe' }
      );
      if (res.status !== 0) throw new Error(res.stderr.toString());
      return path.join(root, 'projects/http/cpp/server_cpp.exe');
    },
    sources: ['projects/http/cpp/server.cpp'],
    exe: 'projects/http/cpp/server_cpp.exe'
  },
  {
    id: 'rust',
    name: 'Rust (std)',
    compile: () => {
      const res = spawnSync(
        'rustc',
        ['-O', path.join(root, 'projects/http/rust/src/main.rs'), '-o', path.join(root, 'projects/http/rust/server_rust.exe')],
        { stdio: 'pipe' }
      );
      if (res.status !== 0) throw new Error(res.stderr.toString());
      return path.join(root, 'projects/http/rust/server_rust.exe');
    },
    sources: ['projects/http/rust/src/main.rs'],
    exe: 'projects/http/rust/server_rust.exe'
  },
  {
    id: 'node',
    name: 'Node.js (baseline)',
    compile: () => null,
    sources: ['projects/http/node/server.mjs'],
    exe: null
  }
];

async function measureOne(t, port) {
  let child;
  if (t.exe) {
    t.compile();
    child = spawn(path.join(root, t.exe), [String(port)], { stdio: 'ignore' });
  } else {
    child = spawn('node', [path.join(root, t.sources[0])], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore'
    });
  }

  // Wait for server to bind
  await new Promise((r) => setTimeout(r, 400));

  try {
    const testRes = await runHttpTests(port);
    const benchRes = await benchHttp({ port, totalRequests: 20000, concurrency: 30 });

    let exeSize = 0;
    if (t.exe) {
      exeSize = fs.statSync(path.join(root, t.exe)).size;
    }

    let sourceBytes = 0;
    for (const s of t.sources) {
      sourceBytes += fs.statSync(path.join(root, s)).size;
    }

    return {
      id: t.id,
      name: t.name,
      tests: `${testRes.passed}/${testRes.total}`,
      rps: benchRes.rps,
      medianUs: benchRes.latencyUs.median,
      p99Us: benchRes.latencyUs.p99,
      sourceBytes,
      exeSize
    };
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  console.log('=== HTTP Arena Multi-Language Bare-Metal Benchmark ===\n');
  console.log('Testing and measuring 5 implementations against RFC 7230 (20,000 requests each)...\n');

  let port = 8100;
  const results = [];

  for (const t of targets) {
    process.stdout.write(`Measuring ${t.name.padEnd(22)} (port ${port})... `);
    try {
      const res = await measureOne(t, port++);
      console.log(`OK: ${res.rps.toLocaleString('ru-RU')} req/s (p99: ${res.p99Us} µs)`);
      results.push(res);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log('\n================================================================================================');
  console.log('| Реализация            | Тесты | Запросов/с  | Median Latency | p99 Latency | Исходник | Бинарник |');
  console.log('|-----------------------|:-----:|------------:|---------------:|------------:|---------:|---------:|');
  for (const r of results) {
    const rpsStr = r.rps.toLocaleString('ru-RU').padStart(11);
    const medStr = `${r.medianUs} µs`.padStart(14);
    const p99Str = `${r.p99Us} µs`.padStart(11);
    const srcStr = `${r.sourceBytes.toLocaleString('ru-RU')} Б`.padStart(8);
    const exeStr = r.exeSize ? `${Math.round(r.exeSize / 1024)} КБ`.padStart(8) : 'node.exe'.padStart(8);
    console.log(`| ${r.name.padEnd(21)} |  ${r.tests}  | ${rpsStr} | ${medStr} | ${p99Str} | ${srcStr} | ${exeStr} |`);
  }
  console.log('================================================================================================\n');

  fs.writeFileSync(path.join(root, 'data/http.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved data to data/http.json\n');
}

main().catch(console.error);
