# From Tokens to Bytes

**Cost, Correctness, and Competitiveness of LLM-Synthesized WebAssembly**

Research artifact: can a language model write WebAssembly bytecode directly, without a
high-level language and a compiler? The first project is a calculator with a fixed API of
17 exports, implemented five ways:

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written bytecode | WAT → wasm, no compiler | 1 147 B | 595 B | 567 B | 17/17 | 3 499 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 042 B | 914 B | 869 B | 17/17 | 1 548 |
| AssemblyScript | asc → wasm-opt | 1 164 B | 616 B | 588 B | 17/17 | 1 411 |
| C | clang --target=wasm32-freestanding | 1 935 B | 944 B | 883 B | 17/17 | 1 209 |
| C++ | clang++ -Oz, no exceptions/RTTI | 1 872 B | 911 B | 822 B | 17/17 | 1 225 |

The article lives at the repository root: [`index.html`](index.html).
Live version: <https://knyazevs.github.io/tokens-to-bytes/>.

## What is measured

- **Artifact tokens** — tokens of the natural authoring form (source code, or WAT for the
  hand-written module), counted with `o200k_base`. This is a **lower bound** on generation
  cost, not the model's actual output-token usage.
- **Correctness** — 16 input/arithmetic scenarios plus one formula check after `=`, run
  identically in Node and in the browser.
- **Size** — raw wasm bytes, gzip -9, brotli q11.
- **Performance** — API calls per second on a deterministic workload (76 calls per pass,
  5 rounds × 120 ms, median).

Generation tokens and wall-clock time were not logged during the original runs, so they are
marked as not measured rather than reconstructed. The protocol for future runs is described
in the article.

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
npm run tokens    # data/tokens.json
npm run measure   # data/calculator.json (sizes, tests, ops/sec)
```

## Structure

```
index.html                 the article
assets/                    styles, scripts, shared measurement protocol
data/
  projects.json            project registry
  calculator.json          measurements
  tokens.json              artifact token counts
projects/calculator/       demo, five wasm modules, bench page, WAT
builds/                    sources, toolchain configs, measurement scripts
```

Rebuilding the wasm modules requires Rust (`wasm32-unknown-unknown`), AssemblyScript,
clang with `wasm-ld`, and `wasm-opt`; ready binaries are committed, so measurements can be
reproduced without the toolchains.

## License

MIT © Sergey Knyazev
