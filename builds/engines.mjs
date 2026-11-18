// Реестр реализаций калькулятора: единственный источник метаданных для сборки,
// измерений и страниц. Новый проект добавляет свой такой же реестр.

export const BASE = 'projects/calculator';

export const ENGINES = [
  {
    id: 'manual',
    name: 'Ручной байткод',
    short: 'manual',
    file: 'calc.wasm',
    method: 'байткод без компилятора',
    toolchain: 'WAT → wasm вручную',
    source: 'projects/calculator/calc.wat',
    authoring: 'projects/calculator/calc.wat',
    tone: '#3b82f6',
  },
  {
    id: 'rust',
    name: 'Rust',
    short: 'rust',
    file: 'calc-rust.wasm',
    method: 'rustc → wasm32-unknown-unknown → wasm-opt',
    toolchain: 'rustc + wasm-opt -Oz',
    source: 'builds/rust/src/lib.rs',
    authoring: 'builds/rust/src/lib.rs',
    tone: '#f59e0b',
  },
  {
    id: 'as',
    name: 'AssemblyScript',
    short: 'as',
    file: 'calc-assemblyscript.wasm',
    method: 'asc → wasm → wasm-opt',
    toolchain: 'AssemblyScript 0.28 + wasm-opt -Oz',
    source: 'builds/assemblyscript/assembly/index.ts',
    authoring: 'builds/assemblyscript/assembly/index.ts',
    tone: '#10b981',
  },
  {
    id: 'c',
    name: 'C',
    short: 'c',
    file: 'calc-c.wasm',
    method: 'clang --target=wasm32-freestanding',
    toolchain: 'clang 24 + wasm-ld, -Oz -nostdlib',
    source: 'builds/c/calc.c',
    authoring: 'builds/c/calc.c',
    tone: '#8b5cf6',
  },
  {
    id: 'cpp',
    name: 'C++ -Oz',
    short: 'cpp',
    file: 'calc-cpp.wasm',
    method: 'clang++ --target=wasm32-freestanding',
    toolchain: 'clang++ 24, -Oz -fno-exceptions -fno-rtti',
    source: 'builds/cpp/calc.cpp',
    authoring: 'builds/cpp/calc.cpp',
    tone: '#ec4899',
  },
  {
    id: 'cpp-opt',
    name: 'C++ -O3',
    short: 'cpp-opt',
    file: 'calc-cpp-opt.wasm',
    method: 'clang++ --target=wasm32-freestanding, -O3',
    toolchain: 'clang++ 24, -O3 -fno-exceptions -fno-rtti',
    source: 'builds/cpp/calc.cpp',
    authoring: 'builds/cpp/calc.cpp',
    tone: '#e11d48',
  },
];

export function engineById(id) {
  return ENGINES.find((e) => e.id === id);
}
