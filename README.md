# From Tokens to Bytes

**Cost, Correctness, and Competitiveness of LLM-Synthesized WebAssembly**

Research artifact: can a language model write WebAssembly bytecode directly, without a
high-level language and a compiler? Four projects are measured, each with the same fixed API
implemented across nine builds — five languages, with hand-written WAT evaluated in two versions
(v1 baseline and v2 optimized) both raw and with `wasm-opt -Oz`, alongside C++ built twice (`-Oz` and `-O3`).
The article (`index.html`) is in Russian with an English abstract, keywords, references and a statements section; version v0.4.

## Calculator

17 exports. State machine: input, decimals, backspace, sign change, operation chains and
repeat `=`.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written v1 (wasm-as) | WAT v1 → wasm, no compiler | 1 418 B | 610 B | 574 B | 17/17 | 3 006 |
| Hand-written v1 + wasm-opt | WAT v1 → wasm-as → wasm-opt -Oz | 1 401 B | 606 B | 567 B | 17/17 | 3 006 |
| Hand-written v2 (tuned) | WAT v2 → wasm-as | 1 598 B | 691 B | 648 B | 17/17 | 3 569 |
| Hand-written v2 + wasm-opt | WAT v2 → wasm-as → wasm-opt -Oz | 1 517 B | 677 B | 631 B | 17/17 | 3 569 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 042 B | 914 B | 869 B | 17/17 | 1 548 |
| AssemblyScript | asc → wasm-opt | 1 164 B | 616 B | 588 B | 17/17 | 1 411 |
| C | clang --target=wasm32-freestanding | 1 935 B | 944 B | 883 B | 17/17 | 1 209 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 1 872 B | 911 B | 822 B | 17/17 | 1 225 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 2 437 B | 987 B | 900 B | 17/17 | 1 225 |

Speed lives in `data/calculator.json`: hand-written v2 reaches **151.7M ops/sec** (vs C++ `-O3` at 144.7M ops/sec). In
paired randomized blocks (12 blocks, seed `20261119`), `manual-v2-opt` achieves **102.0 % relative to C++ `-O3` (8/12 block wins)**,
staying ahead of AssemblyScript (94.9 %), C++ `-Oz` (93.0 %), C (90.3 %), and Rust (85.8 %).

The hand-written module is the smallest after gzip/brotli (606/567 B), but not in raw
bytes where AssemblyScript is 1 164 B vs 1 401 B.

## JSON parser

Byte-oriented parsing with recursion, UTF-8 decoding, `\u` escapes (including surrogate
pairs), floating-point numbers and exact error positions. No imports; the input buffer lives
at `0x10000` and the root-string buffer at `0x20000`.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written v1 (wasm-as) | WAT v1 → wasm, no compiler | 3 271 B | 1 385 B | 1 268 B | 27/27 | 9 556 |
| Hand-written v1 + wasm-opt | WAT v1 → wasm-as → wasm-opt -Oz | 3 029 B | 1 372 B | 1 256 B | 27/27 | 9 556 |
| Hand-written v2 (tuned) | WAT v2 → wasm-as | 3 320 B | 1 408 B | 1 300 B | 27/27 | 9 519 |
| Hand-written v2 + wasm-opt | WAT v2 → wasm-as → wasm-opt -Oz | 3 056 B | 1 415 B | 1 299 B | 27/27 | 9 519 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 4 699 B | 2 038 B | 1 843 B | 27/27 | 4 135 |
| AssemblyScript | asc → wasm-opt | 3 190 B | 1 378 B | 1 259 B | 27/27 | 3 828 |
| C | clang --target=wasm32-freestanding | 4 137 B | 1 866 B | 1 644 B | 27/27 | 3 303 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 4 676 B | 2 045 B | 1 803 B | 27/27 | 3 400 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 5 701 B | 2 280 B | 2 012 B | 27/27 | 3 400 |

With `wasm-opt -Oz`, the hand-written code shrinks to **3 056 B raw** (beating AssemblyScript's 3 190 B and almost half of C++ `-O3`'s 5 701 B).
In paired blocks (12 blocks), tuned `manual-v2` reaches **3 144 786 docs/s (+8.9 % relative to C++ `-O3`, 12/12 BLOCK WINS)**, decisively beating
all compilers (C++ `-O3` 2.93M, C 2.73M, C++ `-Oz` 2.69M, Rust 2.63M, and AssemblyScript 2.63M docs/s).

## Regex engine

A compile-once API: `re_compile` turns a subset of PCRE into bytecode (`CHAR`, `ANY`,
`CLASS`, `BOL`, `EOL`, `JMP`, `SPLIT`, `MATCH`), then each `re_match` runs a backtracking VM
with an explicit return stack. Literals, `.`, classes with ranges and `\d \w \s`, anchors,
non-capturing groups, alternation and greedy `* + ?`; no flags or captures. Pattern and text
buffers live at `0x10000` and `0x20000`; no imports. A 1 000 000-step cap turns catastrophic
backtracking into error `8` instead of a hang.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written v1 (wasm-as) | WAT v1 → wasm, no compiler | 3 449 B | 1 589 B | 1 427 B | 61/61 | 10 727 |
| Hand-written v1 + wasm-opt | WAT v1 → wasm-as → wasm-opt -Oz | 3 050 B | 1 501 B | 1 378 B | 61/61 | 10 727 |
| Hand-written v2 (tuned) | WAT v2 → wasm-as | 3 424 B | 1 613 B | 1 446 B | 61/61 | 10 727 |
| Hand-written v2 + wasm-opt | WAT v2 → wasm-as → wasm-opt -Oz | 3 019 B | 1 512 B | 1 395 B | 61/61 | 10 727 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 4 005 B | 1 933 B | 1 812 B | 61/61 | 4 679 |
| AssemblyScript | asc → wasm-opt | 3 132 B | 1 491 B | 1 386 B | 61/61 | 4 650 |
| C | clang --target=wasm32-freestanding | 3 761 B | 1 880 B | 1 703 B | 61/61 | 4 182 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 3 761 B | 1 880 B | 1 703 B | 61/61 | 4 188 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 5 703 B | 2 406 B | 2 104 B | 61/61 | 4 188 |

**Major Optimization Breakthrough:**
- Baseline v1 without opt trailed C++ `-O3` by 10.3 % (0/12 wins).
- Tuned v2 eliminated the 8-`if` dispatch chain in favor of `br_table` and used hardware memory offsets.
- `manual-v2` reached **102.0 % of C++ `-O3` (11/12 block wins)**.
- `manual-v2-opt` achieved **106.4 % of C++ `-O3` (12/12 BLOCK WINS)** — becoming the **#1 fastest engine overall**, while module size shrank to **3 019 B** (smaller than AssemblyScript 3 132 B and almost half the size of C++ 5 703 B).

## Stack VM

A small bytecode interpreter: 4-byte instructions `[op, x, y, z]`, 27 opcodes, i32 only.
Eight locals per frame, 128 frames, a shared 1 024-value stack and 4 096 instructions; no
data memory and no imports. `vm_load(n)` validates the whole program (unknown opcode, jump
target, local index, length), then `vm_run(limit)` executes until `HALT`, a fault or the step
limit. Runtime faults leave `pc` on the offending instruction; a zero limit means 1 000 000
steps.

| Implementation | How it was made | `.wasm` | gzip | brotli | Tests | Artifact tokens |
|---|---|---:|---:|---:|---:|---:|
| Hand-written v1 (wasm-as) | WAT v1 → wasm, no compiler | 2 513 B | 878 B | 782 B | 52/52 | 7 948 |
| Hand-written v1 + wasm-opt | WAT v1 → wasm-as → wasm-opt -Oz | 2 135 B | 896 B | 804 B | 52/52 | 7 948 |
| Hand-written v2 (tuned) | WAT v2 → wasm-as | 2 468 B | 871 B | 779 B | 52/52 | 7 948 |
| Hand-written v2 + wasm-opt | WAT v2 → wasm-as → wasm-opt -Oz | 2 090 B | 891 B | 794 B | 52/52 | 7 948 |
| Rust | rustc → wasm32-unknown-unknown → wasm-opt | 2 255 B | 1 138 B | 1 054 B | 52/52 | 2 820 |
| AssemblyScript | asc → wasm-opt | 1 693 B | 953 B | 874 B | 52/52 | 2 713 |
| C | clang --target=wasm32-freestanding | 1 897 B | 1 072 B | 977 B | 52/52 | 2 228 |
| C++ -Oz | clang++ -Oz, no exceptions/RTTI | 1 897 B | 1 072 B | 977 B | 52/52 | 2 239 |
| C++ -O3 | clang++ -O3, no exceptions/RTTI | 1 917 B | 1 064 B | 960 B | 52/52 | 2 239 |

`manual-v2-opt` delivers **104.5 % relative to C++ `-O3` (12/12 block wins)** at 37 864 runs/s,
beating Rust by +23.2 % and AssemblyScript by 2.66× (14 208 runs/s, 39.1 % of leader).
Raw size dropped to 2 090 B (−16.8 %), and `manual-v2` set an absolute brotli compression record of **779 B**.

## Adversarial Hardening of Reference C++

To defend against the "straw man baseline" critique — the suspicion that high-level C++ reference code was written sub-optimally to make hand-written assembly appear artificially faster — all C++ references (`builds/cpp/*.cpp`) underwent an adversarial optimization audit:

1. **Stack VM (`builds/cpp/vm.cpp`):** The 13 arithmetic opcodes previously shared a merged `switch` label containing a 13-branch linear `if-else` cascade. Un-nesting them into dedicated `case` labels with direct jump table dispatch yielded a **+14.6 % speedup in C++ -O3** (38 581 → 44 233 runs/s).
2. **JSON Parser (`builds/cpp/json.cpp`):** Linear `if-else` value dispatch was converted to `switch (c)`, single-check ASCII whitespace filter `c > ' '` was added to `skipWs()`, and unsigned range checks were introduced in number and hex parsing. C++ -O3 throughput grew from 2.96M to **3.10M docs/s**.
3. **Regex Engine (`builds/cpp/regex.cpp`):** Linear 8-branch interpreter chain was replaced with idiomatic `switch (op)`. C++ -O3 throughput rose to **1.32M searches/s**.
4. **Calculator (`builds/cpp/calc.cpp`):** Floating-point division in fractional input was replaced with fast multiplication `scale *= 0.1`, yielding **145.1M ops/s**.

Even against this hardened, optimized baseline:
- **Regex:** Hand-written WAT (`manual-v2-opt`) beats C++ -O3 in **12 out of 12 paired blocks** (+6.2 %, 1.407M vs 1.323M searches/s).
- **JSON:** Hand-written WAT (`manual-v2`) beats C++ -O3 in **10 out of 12 paired blocks** (+6.2 %, 3.300M vs 3.097M docs/s).
- **Calculator:** Hand-written WAT (`manual-v2-opt`) is in **statistical parity** with C++ -O3 (148.2M vs 145.1M ops/s, 95 % CI: -2.9 % … +4.4 %, 5/12 wins) while being **4.3× smaller** (562 B vs 2 437 B).
- **VM:** Hardened C++ -O3 takes the lead (44.2k vs 40.0k runs/s, -8.7 %) because Clang's loop optimizer pins the stack pointer `sp` in a physical CPU register across jump table dispatches, whereas WebAssembly WAT accesses a global variable and computes memory addresses per instruction.

## Cross-model replication

The artifact-token counts above measure the artifact, not the generation process. A pilot
experiment now logs the process itself: three models (`deepseek-v4.1-flash-free`,
`flint-40b-free`, `mimo-v2.6-flash-free`) received the same calculator spec, the same 17-test
protocol and an isolated sandbox without the reference source. After every edit they ran
`build-test.mjs`, which appended the iteration, the fix note and the test result to
`dev-log.json`. `builds/replication.mjs setup|verify|collect` creates the sandbox,
independently re-checks the result and writes `data/replication.json`.

In this pilot, all three final implementations independently passed 17/17. DeepSeek and Mimo
finished in 1 iteration with 0 failed iterations and 0 documented defects (1 623 and 1 926
artifact tokens, o200k_base). Flint required 3 iterations and 2 failures — a compile error
(implicit `floor`/`fabs` declarations) and a test failure after that fix — before reaching
17/17 (1 404 tokens). These numbers are a lower bound on the generation process: the ledger
records only what went through the helper, not every mistake a model may have made.

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
- **Paired blocks** — for contrasts smaller than the between-session drift, each block runs
  every build once in a randomized order, one fresh process per build. The ratio to C++ `-O3`
  is computed inside the block; the median ratio gets a 95 % bootstrap interval over blocks
  (10 000 resamples). Calculator: 20 blocks; JSON, regex and VM: 12 each; seed `20261119`.
  Results live in `data/paired-<slug>.json` and feed the paired table in the article.

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
node builds/paired.mjs calculator 20   # data/paired-calculator.json
node builds/paired.mjs json 12         # data/paired-json.json
node builds/paired.mjs regex 12        # data/paired-regex.json
node builds/paired.mjs vm 12           # data/paired-vm.json
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
  paired-calculator.json   calculator paired randomized blocks
  paired-json.json         JSON paired randomized blocks
  paired-regex.json        regex paired randomized blocks
  paired-vm.json           VM paired randomized blocks
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
