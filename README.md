# From Tokens to Bytes

**Cost, Correctness, and Competitiveness of LLM-Synthesized WebAssembly**

Research artifact: can a language model write WebAssembly bytecode directly, without a
high-level language and a compiler? Two projects are measured, each with the same fixed API
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

The article lives at the repository root: [`index.html`](index.html).
Live version: <https://knyazevs.github.io/tokens-to-bytes/>.

## What is measured

- **Artifact tokens** — tokens of the natural authoring form (source code, or WAT for the
  hand-written module), counted with `o200k_base`. This is a **lower bound** on generation
  cost, not the model's actual output-token usage.
- **Correctness** — 17 calculator scenarios (16 input/arithmetic plus one formula check after
  `=`) and 27 JSON tests (13 valid documents, 14 invalid with expected error codes and
  positions), run identically in Node and in the browser.
- **Size** — raw wasm bytes, gzip -9, brotli q11.
- **Performance** — calls per second on a deterministic calculator workload (76 calls per
  pass), or documents per second for the JSON parser (13 documents per pass).
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
npm run build:manual        # rebuild the hand-written calculator wasm (needs wasm-as)
npm run build:json          # rebuild all six JSON builds (needs Rust, asc, clang, wasm-opt)
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
  tokens.json              calculator artifact token counts
  tokens-json.json         JSON parser artifact token counts
projects/calculator/       demo, six wasm modules, bench page, WAT
projects/json/             demo, six wasm modules, bench page, WAT
builds/                    sources, toolchain configs, measurement scripts
```

Rebuilding the wasm modules requires Rust (`wasm32-unknown-unknown`), AssemblyScript,
clang with `wasm-ld`, and `wasm-opt`; the hand-written modules need `wasm-as` from
Binaryen. Ready binaries are committed, so measurements can be reproduced without the
toolchains. `npm run build:json` rebuilds the JSON project; `npm run build:manual`
reproduces the calculator's `calc.wasm` from `calc.wat`.

## License

MIT © Sergey Knyazev
