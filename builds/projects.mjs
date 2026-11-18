// Реестр проектов серии: единственный источник путей, протоколов и сборок.
// Калькулятор сохраняет свой исторический реестр в engines.mjs; остальные
// проекты добавляют рядом такой же список.

import { ENGINES as CALCULATOR_ENGINES } from './engines.mjs';
import { JSON_ENGINES } from './json-engines.mjs';

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
};

export function projectBySlug(slug = 'calculator') {
  const project = PROJECTS[slug];
  if (!project) throw new Error(`unknown project: ${slug}`);
  return project;
}
