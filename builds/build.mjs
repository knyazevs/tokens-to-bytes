// Собирает выбранные реализации проекта одной командой.
//
//   node builds/build.mjs json            все шесть сборок
//   node builds/build.mjs json c cpp      только C и C++
//   node builds/build.mjs calculator manual
//
// Пути к инструментам можно переопределить: CLANG, WASM_AS, WASM_OPT, ASC.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectBySlug } from './projects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2] ?? 'calculator';
const project = projectBySlug(slug);
const requested = process.argv.slice(3);
const only = requested.length ? new Set(requested) : null;

const localBin = (name) => [
  path.join(root, '.tools/node_modules/.bin', `${name}.cmd`),
  path.join(root, '.tools/node_modules/.bin', name),
].find((p) => fs.existsSync(p));

const clang = process.env.CLANG || path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe',
);

function run(bin, args, opts = {}) {
  if (!bin || !fs.existsSync(bin) && !/^(cargo|asc|wasm-opt|wasm-as)$/.test(bin)) {
    throw new Error(`инструмент не найден: ${bin}`);
  }
  const result = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', bin, ...args], { cwd: root, stdio: 'inherit', ...opts })
    : spawnSync(bin, args, { cwd: root, stdio: 'inherit', ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(bin)} завершился с кодом ${result.status}`);
}

function want(id) {
  return !only || only.has(id);
}

function report(rel) {
  const size = fs.statSync(path.join(root, rel)).size;
  console.log(`${rel}: ${size} B`);
}

async function validate(rel) {
  const { REQUIRED_EXPORTS } = await import(project.protocol.href);
  const bytes = fs.readFileSync(path.join(root, rel));
  if (!WebAssembly.validate(bytes)) throw new Error(`${rel}: invalid wasm`);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const missing = REQUIRED_EXPORTS.filter((name) => typeof instance.exports[name] !== 'function');
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) missing.push('memory');
  if (missing.length) throw new Error(`${rel}: нет экспортов: ${missing.join(', ')}`);
}

const wasmAs = process.env.WASM_AS || localBin('wasm-as') || 'wasm-as';
const wasmOpt = process.env.WASM_OPT || localBin('wasm-opt') || 'wasm-opt';
const asc = process.env.ASC || localBin('asc') || 'asc';

async function buildManual() {
  if (!want('manual')) return;
  const { src, out } = project.manual;
  run(wasmAs, [src, '-o', out]);
  report(out);
  await validate(out);
}

async function buildC() {
  if (!want('c')) return;
  const { REQUIRED_EXPORTS } = await import(project.protocol.href);
  const { src, out } = project.c;
  const args = [
    '--target=wasm32', '-nostdlib', '-Wl,--no-entry', '-Wl,--strip-all', '-Wl,--export-memory', '-Oz',
    ...REQUIRED_EXPORTS.map((name) => `-Wl,--export=${name}`),
    '-o', out, src,
  ];
  run(clang, args);
  report(out);
  await validate(out);
}

async function buildCpp() {
  if (!want('cpp')) return;
  const { REQUIRED_EXPORTS } = await import(project.protocol.href);
  const { src, variants } = project.cpp;
  const common = [
    '--target=wasm32', '-nostdlib', '-Wl,--no-entry', '-Wl,--strip-all', '-Wl,--export-memory',
    '--driver-mode=g++', '-fno-exceptions', '-fno-rtti',
    ...REQUIRED_EXPORTS.map((name) => `-Wl,--export=${name}`),
  ];
  for (const { out, flags } of variants) {
    run(clang, [...common, ...flags, '-o', out, src]);
    report(out);
    await validate(out);
  }
}

function crateName(crateDir) {
  const toml = fs.readFileSync(path.join(root, crateDir, 'Cargo.toml'), 'utf8');
  const match = toml.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${crateDir}: не найдено имя пакета в Cargo.toml`);
  return match[1];
}

async function buildRust() {
  if (!want('rust')) return;
  const { REQUIRED_EXPORTS } = await import(project.protocol.href);
  const { crate, out } = project.rust;
  const name = crateName(crate);
  const flags = [
    '-C', 'link-arg=--no-entry',
    '-C', 'link-arg=-s',
    '-C', 'link-arg=--export-memory',
    ...REQUIRED_EXPORTS.flatMap((n) => ['-C', `link-arg=--export=${n}`]),
  ].join(' ');
  run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
    cwd: path.join(root, crate),
    env: { ...process.env, RUSTFLAGS: flags },
  });
  const built = path.join(root, crate, 'target/wasm32-unknown-unknown/release', `${name}.wasm`);
  if (!fs.existsSync(built)) throw new Error(`Rust: не найден ${built}`);
  run(wasmOpt, [built, '-Oz', '--enable-bulk-memory-opt', '-o', path.join(root, out)]);
  report(out);
  await validate(out);
}

async function buildAs() {
  if (!want('as')) return;
  const { src, out } = project.as;
  run(asc, [
    src, '--outFile', out,
    '--optimizeLevel', '3', '--shrinkLevel', '2',
    '--runtime', 'stub', '--noAssert',
  ]);
  run(wasmOpt, [out, '-Oz', '--enable-bulk-memory-opt', '-o', out]);
  report(out);
  await validate(out);
}

try {
  await buildManual();
  await buildC();
  await buildCpp();
  await buildRust();
  await buildAs();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
