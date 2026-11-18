// Реестр проектов серии: единственный источник путей, протоколов и сборок.
// Калькулятор сохраняет свой исторический реестр в engines.mjs; остальные
// проекты добавляют рядом такой же список.

import { ENGINES as CALCULATOR_ENGINES } from './engines.mjs';
import { JSON_ENGINES } from './json-engines.mjs';
import { REGEX_ENGINES } from './regex-engines.mjs';
import { VM_ENGINES } from './vm-engines.mjs';

const protocol = (name) => new URL(`../assets/${name}`, import.meta.url);

export const PROJECTS = {
  calculator: {
    slug: 'calculator',
    name: 'Калькулятор',
    dir: 'projects/calculator',
    out: 'data/calculator.json',
    tokens: 'data/tokens.json',
    protocol: protocol('protocol.js'),
    protocolUrl: 'assets/protocol.js',
    engines: CALCULATOR_ENGINES,
    bench: { warmupMs: 750, rounds: 10, durationMs: 150 },
    manual: { src: 'projects/calculator/calc.wat', out: 'projects/calculator/calc.wasm' },
    c: { src: 'builds/c/calc.c', out: 'projects/calculator/calc-c.wasm' },
    cpp: {
      src: 'builds/cpp/calc.cpp',
      variants: [
        { out: 'projects/calculator/calc-cpp.wasm', flags: ['-Oz'] },
        { out: 'projects/calculator/calc-cpp-opt.wasm', flags: ['-O3'] },
      ],
    },
    rust: { crate: 'builds/rust', out: 'projects/calculator/calc-rust.wasm' },
    as: { src: 'builds/assemblyscript/assembly/index.ts', out: 'projects/calculator/calc-assemblyscript.wasm' },
  },
  json: {
    slug: 'json',
    name: 'JSON-парсер',
    dir: 'projects/json',
    out: 'data/json.json',
    tokens: 'data/tokens-json.json',
    protocol: protocol('protocol-json.js'),
    protocolUrl: 'assets/protocol-json.js',
    engines: JSON_ENGINES,
    bench: { warmupMs: 750, rounds: 10, durationMs: 150 },
    manual: { src: 'projects/json/json.wat', out: 'projects/json/json.wasm' },
    c: { src: 'builds/c/json.c', out: 'projects/json/json-c.wasm' },
    cpp: {
      src: 'builds/cpp/json.cpp',
      variants: [
        { out: 'projects/json/json-cpp.wasm', flags: ['-Oz'] },
        { out: 'projects/json/json-cpp-opt.wasm', flags: ['-O3'] },
      ],
    },
    rust: { crate: 'builds/rust-json', out: 'projects/json/json-rust.wasm' },
    as: { src: 'builds/assemblyscript/assembly/json.ts', out: 'projects/json/json-assemblyscript.wasm' },
  },
  regex: {
    slug: 'regex',
    name: 'Regex-движок',
    dir: 'projects/regex',
    out: 'data/regex.json',
    tokens: 'data/tokens-regex.json',
    protocol: protocol('protocol-regex.js'),
    protocolUrl: 'assets/protocol-regex.js',
    engines: REGEX_ENGINES,
    bench: { warmupMs: 750, rounds: 10, durationMs: 150 },
    manual: { src: 'projects/regex/re.wat', out: 'projects/regex/re.wasm' },
    c: { src: 'builds/c/regex.c', out: 'projects/regex/re-c.wasm' },
    cpp: {
      src: 'builds/cpp/regex.cpp',
      variants: [
        { out: 'projects/regex/re-cpp.wasm', flags: ['-Oz'] },
        { out: 'projects/regex/re-cpp-opt.wasm', flags: ['-O3'] },
      ],
    },
    rust: { crate: 'builds/rust-regex', out: 'projects/regex/re-rust.wasm' },
    as: { src: 'builds/assemblyscript/assembly/regex.ts', out: 'projects/regex/re-assemblyscript.wasm' },
  },
  vm: {
    slug: 'vm',
    name: 'Стековая VM',
    dir: 'projects/vm',
    out: 'data/vm.json',
    tokens: 'data/tokens-vm.json',
    protocol: protocol('protocol-vm.js'),
    protocolUrl: 'assets/protocol-vm.js',
    engines: VM_ENGINES,
    bench: { warmupMs: 750, rounds: 10, durationMs: 150 },
    manual: { src: 'projects/vm/vm.wat', out: 'projects/vm/vm.wasm' },
    c: { src: 'builds/c/vm.c', out: 'projects/vm/vm-c.wasm' },
    cpp: {
      src: 'builds/cpp/vm.cpp',
      variants: [
        { out: 'projects/vm/vm-cpp.wasm', flags: ['-Oz'] },
        { out: 'projects/vm/vm-cpp-opt.wasm', flags: ['-O3'] },
      ],
    },
    rust: { crate: 'builds/rust-vm', out: 'projects/vm/vm-rust.wasm' },
    as: { src: 'builds/assemblyscript/assembly/vm.ts', out: 'projects/vm/vm-assemblyscript.wasm' },
  },
};

export function projectBySlug(slug = 'calculator') {
  const project = PROJECTS[slug];
  if (!project) throw new Error(`unknown project: ${slug}`);
  return project;
}
