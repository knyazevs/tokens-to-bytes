# From Tokens to Bytes

**Cost, Correctness, and Competitiveness of LLM-Synthesized WebAssembly**

Research artifact: can a language model write WebAssembly bytecode directly, without a
high-level language and a compiler? The first project is a calculator with a fixed API of
17 exports, implemented six ways — five languages, with C++ built twice:

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 1 147 B | 595 B | 567 B | 17/17 | 3 499 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 042 B | 914 B | 869 B | 17/17 | 1 548 |
| AssemblyScript | asc → wasm-opt | 1 164 B | 616 B | 588 B | 17/17 | 1 411 |
| C | clang --target=wasm32-freestanding | 1 935 B | 944 B | 883 B | 17/17 | 1 209 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 1 872 B | 911 B | 822 B | 17/17 | 1 225 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 2 437 B | 987 B | 900 B | 17/17 | 1 225 |

Speed lives in `data/calculator.json`: all six builds land within ~1.2× of each other, and
the order inside that group is not stable between runs. The one consistent difference is
C++ `-O3` vs `-Oz`: about +7 % ops/sec for +30 % module bytes.

The article lives at the repository root: [`index.html`](index.html).
Live version: <https://knyazevs.github.io/tokens-to-bytes/>.

## What is measured

- **Artifact tokens** — tokens of the natural authoring form (source code, or WAT for the
  hand-written module), counted with `o200k_base`. This is a **lower bound** on generation
  cost, not the model's actual output-token usage.
- **Correctness** — 16 input/arithmetic scenarios plus one formula check after `=`, run
  identically in Node and in the browser.
- **Size** — raw wasm bytes, gzip -9, brotli q11.
- **Performance** — API calls per second on a deterministic workload (76 calls per pass).
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
calculator alone still has an inline base64 fallback and works from `file://`.

## Recompute

```bash
npm install
npm run tokens            # data/tokens.json
npm run measure           # data/calculator.json (sizes, tests, ops/sec)
npm run build:cpp         # rebuild C++ -Oz and -O3 (needs clang)
```

On a hybrid CPU, pin the measurement to P-cores so Windows does not schedule it onto
E-cores:

```powershell
$env:AFFINITY='FFF'; cmd /c start /affinity FFF /wait /b node builds/measure.mjs
```

## Structure

```
index.html                 the article
assets/                    styles, scripts, shared protocol, isolated browser bench
data/
  projects.json            project registry
  calculator.json          measurements
  tokens.json              artifact token counts
projects/calculator/       demo, six wasm modules, bench page, WAT
builds/                    sources, toolchain configs, measurement scripts
```

Rebuilding the wasm modules requires Rust (`wasm32-unknown-unknown`), AssemblyScript,
clang with `wasm-ld`, and `wasm-opt`; ready binaries are committed, so measurements can be
reproduced without the toolchains. The C++ artifacts are reproducible with
`npm run build:cpp`; `calc-cpp.wasm` rebuilds byte-for-byte.

## License

MIT © Sergey Knyazev
