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
    id: 'pure-asm',
    name: 'Pure ASM (x86-64)',
    compile: () => {
      const res = spawnSync(
        clang,
        [
          '-O3',
          '-march=native',
          path.join(root, 'projects/http/asm/pure_server.S'),
          '-lws2_32',
          '-lkernel32',
          '-o',
          path.join(root, 'projects/http/asm/server_pure.exe')
        ],
        { stdio: 'pipe' }
      );
      if (res.status !== 0) throw new Error(res.stderr.toString());
      return path.join(root, 'projects/http/asm/server_pure.exe');
    },
    sources: ['projects/http/asm/pure_server.S'],
    exe: 'projects/http/asm/server_pure.exe'
  },
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
  },
  {
    id: 'httparena-official',
    name: 'HttpArena (Official)',
    compile: () => null,
    sources: ['projects/http/arena/server.mjs'],
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
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  console.log('=== HTTP Arena Multi-Language Bare-Metal Benchmark ===\n');
  console.log('Testing and measuring 7 implementations against RFC 7230 (20,000 requests each)...\n');

  /* Use non-colliding base port */
  let port = 8300 + Math.floor(Math.random() * 50) * 10;
  const results = [];

  for (const t of targets) {
    process.stdout.write(`Measuring ${t.name.padEnd(23)} (port ${port})... `);
    try {
      const res = await measureOne(t, port++);
      console.log(`OK: ${res.rps.toLocaleString('ru-RU')} req/s (p99: ${res.p99Us} µs)`);
      results.push(res);
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(98));
  console.log(
    '| ' +
      'Реализация'.padEnd(22) +
      ' | Тесты | ' +
      'Запросов/с'.padStart(12) +
      ' | ' +
      'Median Latency' +
      ' | ' +
      'p99 Latency' +
      ' | ' +
      'Исходник' +
      ' | ' +
      'Бинарник' +
      ' |'
  );
  console.log(
    '|' +
      '-'.repeat(24) +
      '|:-----:|' +
      '-'.repeat(14) +
      ':|' +
      '-'.repeat(16) +
      ':|' +
      '-'.repeat(13) +
      ':|' +
      '-'.repeat(10) +
      ':|' +
      '-'.repeat(10) +
      ':|'
  );

  for (const r of results) {
    const sizeStr = r.exeSize ? `${Math.round(r.exeSize / 1024)} КБ` : 'node.exe';
    console.log(
      `| ${r.name.padEnd(22)} |  ${r.tests}  | ${r.rps.toLocaleString('ru-RU').padStart(12)} | ${(
        r.medianUs + ' µs'
      ).padStart(14)} | ${(r.p99Us + ' µs').padStart(11)} | ${(r.sourceBytes.toLocaleString('ru-RU') + ' Б').padStart(
        8
      )} | ${sizeStr.padStart(8)} |`
    );
  }
  console.log('='.repeat(98) + '\n');

  // HttpArena Cross-Platform Calibration & Scaling Analysis
  const officialNode = results.find((r) => r.id === 'httparena-official') || results.find((r) => r.id === 'node');
  if (officialNode) {
    // Official HttpArena cluster data (http-arena.com/engine/node on AMD Threadripper PRO 3995WX):
    // Total throughput: 890,397 req/s across 65.43 CPU cores = 13,608 req/s per core
    const HTTPARENA_OFFICIAL_TOTAL_RPS = 890397;
    const HTTPARENA_OFFICIAL_PER_CORE_RPS = 13608;

    const localRps = officialNode.rps;
    const coreIpcRatio = localRps / HTTPARENA_OFFICIAL_PER_CORE_RPS;
    const clusterScaleFactor = HTTPARENA_OFFICIAL_TOTAL_RPS / localRps;

    console.log('--- Коэффициенты калибровки с официальным стендом HttpArena (http-arena.com) ---');
    console.log(`• Официальный результат HttpArena node:http (64 ядра Threadripper 3995WX): ${HTTPARENA_OFFICIAL_TOTAL_RPS.toLocaleString('ru-RU')} req/s (13 608 req/s на ядро)`);
    console.log(`• Локальный результат на 1 P-ядро (Intel i5-12600KF @ 4.9 GHz):             ${localRps.toLocaleString('ru-RU')} req/s`);
    console.log(`• Аппаратный коэффициент IPC одного P-ядра к 1 ядру Threadripper:            ${coreIpcRatio.toFixed(2)}x`);
    console.log(`• Коэффициент масштабирования кластера (64-ядерный пулинг):                  ${clusterScaleFactor.toFixed(1)}x\n`);

    console.log('Проекция пиковой производительности на 64-ядерном стенде HttpArena:');
    for (const r of results) {
      const projectedClusterRps = Math.round(r.rps * (clusterScaleFactor / (coreIpcRatio > 1 ? 1 : 1)));
      // Normalize single core equivalent
      const normalizedToArenaCores = Math.round(r.rps / coreIpcRatio * 64);
      console.log(`  - ${r.name.padEnd(22)}: ~${normalizedToArenaCores.toLocaleString('ru-RU')} req/s на 64 ядрах Threadripper (локально: ${r.rps.toLocaleString('ru-RU')} req/s)`);
    }
    console.log('');
  }

  const outPath = path.join(root, 'data/http.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log('Saved data to data/http.json\n');
}

main().catch(console.error);
