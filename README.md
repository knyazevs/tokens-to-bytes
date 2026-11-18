# From Tokens to Bytes

**Cost, Correctness, and Competitiveness of LLM-Synthesized WebAssembly**

Research artifact: can a language model write WebAssembly bytecode directly, without a
high-level language and a compiler? Four projects are measured, each with the same fixed API
implemented six ways — five languages, with C++ built twice.

## Calculator

17 exports. State machine: input, decimals, backspace, sign change, operation chains and
repeat `=`.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 1 418 B | 610 B | 574 B | 17/17 | 3 006 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 042 B | 914 B | 869 B | 17/17 | 1 548 |
| AssemblyScript | asc → wasm-opt | 1 164 B | 616 B | 588 B | 17/17 | 1 411 |
| C | clang --target=wasm32-freestanding | 1 935 B | 944 B | 883 B | 17/17 | 1 209 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 1 872 B | 911 B | 822 B | 17/17 | 1 225 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 2 437 B | 987 B | 900 B | 17/17 | 1 225 |

Speed lives in `data/calculator.json`: all six builds land within ~1.2× of each other. In
paired randomized blocks the optimized hand-written module is about 2 % faster than the
previous hand-written version and about 3 % slower than C++ `-O3`; the other pairs are
within noise. C++ `-O3` vs `-Oz` is about +7 % ops/sec for +30 % module bytes.

The hand-written module is the smallest after gzip/brotli (610/574 B), but not in raw
bytes: AssemblyScript is 1 164 B vs 1 418 B. It is authored as WAT and assembled with
`wasm-as`. The speed-oriented rewrite inlines hot helpers and uses `br_table` dispatch;
it was differentially fuzzed against the previous version (500 000 state comparisons).

## JSON parser

Byte-oriented parsing with recursion, UTF-8 decoding, `\u` escapes (including surrogate
pairs), floating-point numbers and exact error positions. No imports; the input buffer lives
at `0x10000` and the root-string buffer at `0x20000`.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 3 271 B | 1 385 B | 1 268 B | 27/27 | 9 556 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 4 699 B | 2 038 B | 1 843 B | 27/27 | 4 135 |
| AssemblyScript | asc → wasm-opt | 3 190 B | 1 378 B | 1 259 B | 27/27 | 3 828 |
| C | clang --target=wasm32-freestanding | 4 137 B | 1 866 B | 1 644 B | 27/27 | 3 303 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 4 676 B | 2 045 B | 1 803 B | 27/27 | 3 400 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 5 701 B | 2 280 B | 2 012 B | 27/27 | 3 400 |

The picture reverses: AssemblyScript is the smallest both raw and compressed, and the
hand-written module is second after gzip/brotli (+0.5 % / +0.7 %) — no longer the winner.
Its WAT costs 2.3–2.9× the tokens of the compiled sources. All six builds parse 13 valid and
14 invalid documents with identical error codes and positions. Speed in `data/json.json` is
2.63–2.93 M documents/s (1.11× spread); C++ `-O3` is fastest, the hand-written module is
slowest, and differences below 2–3 % were not resolved with paired blocks.

## Regex engine

A compile-once API: `re_compile` turns a subset of PCRE into bytecode (`CHAR`, `ANY`,
`CLASS`, `BOL`, `EOL`, `JMP`, `SPLIT`, `MATCH`), then each `re_match` runs a backtracking VM
with an explicit return stack. Literals, `.`, classes with ranges and `\d \w \s`, anchors,
non-capturing groups, alternation and greedy `* + ?`; no flags or captures. Pattern and text
buffers live at `0x10000` and `0x20000`; no imports. A 1 000 000-step cap turns catastrophic
backtracking into error `8` instead of a hang.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 3 449 B | 1 589 B | 1 427 B | 61/61 | 10 727 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 4 005 B | 1 933 B | 1 812 B | 61/61 | 4 679 |
| AssemblyScript | asc → wasm-opt | 3 132 B | 1 491 B | 1 386 B | 61/61 | 4 650 |
| C | clang --target=wasm32-freestanding | 3 761 B | 1 880 B | 1 703 B | 61/61 | 4 182 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 3 761 B | 1 880 B | 1 703 B | 61/61 | 4 188 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 5 703 B | 2 406 B | 2 104 B | 61/61 | 4 188 |

AssemblyScript wins raw and compressed; the hand-written module is second (+10.1 % raw,
+6.6 % gzip, +3.0 % brotli). Its WAT costs 2.3–2.6× the tokens of the compiled sources.
All six pass 39 matching pairs, 18 invalid patterns with exact error positions, and four
contract checks (match before compile, both buffer limits, step cap on `(a+)+b`).
Speed in `data/regex.json` is 1.07–1.31 M searches/s (1.22× spread): C++ `-O3`, C and C++ `-Oz`
are within 2 %, Rust is ~6 % behind, the hand-written module is ~14 % behind and
AssemblyScript ~18 %. C++ `-O3` buys under 2 % speed for +52 % bytes.

## Stack VM

A small bytecode interpreter: 4-byte instructions `[op, x, y, z]`, 27 opcodes, i32 only.
Eight locals per frame, 128 frames, a shared 1 024-value stack and 4 096 instructions; no
data memory and no imports. `vm_load(n)` validates the whole program (unknown opcode, jump
target, local index, length), then `vm_run(limit)` executes until `HALT`, a fault or the step
limit. Runtime faults leave `pc` on the offending instruction; a zero limit means 1 000 000
steps.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 2 513 B | 878 B | 782 B | 52/52 | 7 948 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 255 B | 1 138 B | 1 054 B | 52/52 | 2 820 |
| AssemblyScript | asc → wasm-opt | 1 693 B | 953 B | 874 B | 52/52 | 2 713 |
| C | clang --target=wasm32-freestanding | 1 897 B | 1 072 B | 977 B | 52/52 | 2 228 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 1 897 B | 1 072 B | 977 B | 52/52 | 2 239 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 1 917 B | 1 064 B | 960 B | 52/52 | 2 239 |

AssemblyScript is the smallest raw module (1 693 B) and the hand-written one the largest
(+48.4 %), but compression reverses the order for the first time: the hand-written module wins
both gzip (878 B) and brotli (782 B), ahead of AssemblyScript by 8.5 % / 11.8 %. Its WAT costs
2.8–3.6× the tokens of the compiled sources.

All six pass 52/52: eight contract checks, 31 programs with expected results and 13 invalid
programs with exact error codes and `pc`. A differential fuzzer compared 60 000 random
programs against a reference model in JavaScript and found one real divergence — operand pop
order on `DIV`/`MOD` faults in the hand-written build — fixed before the published run.
Speed in `data/vm.json` is 14.9k–38.7k runs/s (2.60× spread), but the spread is entirely
AssemblyScript: the other five builds land within 1.21×, and the hand-written module is
statistically tied with C and C++ (38.7k vs 38.4k/38.3k).

The article lives at the repository root: [`index.html`](index.html).
Live version: <https://knyazevs.github.io/tokens-to-bytes/>.

## What is measured

- **Artifact tokens** — tokens of the natural authoring form (source code, or WAT for the
  hand-written module), counted with `o200k_base`. This is a **lower bound** on generation
  cost, not the model's actual output-token usage.
- **Correctness** — 17 calculator scenarios (16 input/arithmetic plus one formula check after
  `=`), 27 JSON tests (13 valid documents, 14 invalid with expected error codes and positions),
  61 regex tests (39 matching pairs, 18 invalid patterns with positions, four contract checks)
  and 52 VM tests (31 programs, 13 invalid programs with exact fault `pc`, eight contract
  checks), run identically in Node and in the browser. The VM is additionally fuzzed
  differentially on 60 000 random programs.
- **Size** — raw wasm bytes, gzip -9, brotli q11.
- **Performance** — calls per second on a deterministic calculator workload (76 calls per
  pass), documents per second for the JSON parser (13 documents per pass), searches per second
  for the regex engine (12 pattern/text pairs per pass), or VM runs per second (10 programs per
  pass, each run is `vm_load` plus `vm_run` to `HALT`).
  Every build is measured in its own Node process: 750 ms warmup, 10 rounds × 150 ms, six
  processes — 60 samples per build. The headline is the median; min, mean, max and standard
  deviation are published alongside it to show the noise. In the browser each build gets its
  own Worker.

## Why one process per build

The first version measured all builds back to back in a single process, and C++ looked
twice as slow as everything else. It was a measurement artifact:

- **Tier-up starvation.** V8 budgets wasm optimization across modules; with several hot
  modules in one JS context, the build measured last never reaches optimized code. Reversing
  the order moved the slowdown to a different build.
- **E-core migration.** On hybrid CPUs Windows may move the process to E-cores (~2.2× slower
  here) mid-run. Pinning the process avoids it.

The fix is isolation, not different flags: `builds/bench-one.mjs` spawns one process per
build, and `assets/bench-client.js` + `assets/bench-worker.js` do the same with one Worker
per build in the browser. The committed numbers were produced pinned to P-cores
(`AFFINITY=FFF`); affinity and method are recorded in `data/calculator.json`.

## Local

```bash
python -m http.server 8000
# http://localhost:8000/
```

A server is required because the demo and benchmark load `.wasm` with `fetch`. The
hand-written build of each project still has an inline base64 fallback and works from
`file://`; the other five builds need the server.

## Recompute

```bash
npm install
npm run tokens              # data/tokens.json
npm run measure             # data/calculator.json (sizes, tests, ops/sec)
npm run tokens -- json      # data/tokens-json.json
npm run measure -- json     # data/json.json (sizes, tests, docs/sec)
npm run tokens -- regex     # data/tokens-regex.json
npm run measure -- regex    # data/regex.json (sizes, tests, searches/sec)
npm run tokens -- vm        # data/tokens-vm.json
npm run measure -- vm       # data/vm.json (sizes, tests, runs/sec)
npm run build:manual        # rebuild the hand-written calculator wasm (needs wasm-as)
npm run build:json          # rebuild all six JSON builds (needs Rust, asc, clang, wasm-opt)
npm run build:regex         # rebuild all six regex builds
npm run build:vm            # rebuild all six VM builds
```

On a hybrid CPU, pin the measurement to P-cores so Windows does not schedule it onto
E-cores:

```powershell
$env:AFFINITY='FFF'; cmd /c start /affinity FFF /wait /b node builds/measure.mjs
```

## Structure

```
index.html                 the article
assets/                    styles, scripts, shared protocols, isolated browser bench
data/
  projects.json            project registry
  calculator.json          calculator measurements
  json.json                JSON parser measurements
  regex.json               regex engine measurements
  vm.json                  stack VM measurements
  tokens.json              calculator artifact token counts
  tokens-json.json         JSON parser artifact token counts
  tokens-regex.json        regex engine artifact token counts
  tokens-vm.json           stack VM artifact token counts
projects/calculator/       demo, six wasm modules, bench page, WAT
projects/json/             demo, six wasm modules, bench page, WAT
projects/regex/            demo, six wasm modules, bench page, WAT
projects/vm/               demo, six wasm modules, bench page, WAT
builds/                    sources, toolchain configs, measurement scripts
```

Rebuilding the wasm modules requires Rust (`wasm32-unknown-unknown`), AssemblyScript,
clang with `wasm-ld`, and `wasm-opt`; the hand-written modules need `wasm-as` from
Binaryen. Ready binaries are committed, so measurements can be reproduced without the
toolchains. `npm run build:json`, `npm run build:regex` and `npm run build:vm` rebuild the
JSON, regex and VM projects; `npm run build:manual` reproduces the calculator's `calc.wasm`
from `calc.wat`.

## License

MIT © Sergey Knyazev
