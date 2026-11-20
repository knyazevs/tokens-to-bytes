---
name: macro-asm-synthesis
description: Systematic guidelines, mental models, and invariants for LLMs generating bare-metal assembly, Macro-ASM, and zero-overhead systems code.
triggers:
  - "Writing assembly, x86-64, AVX2, or SIMD kernels"
  - "Developing bare-metal, no-libc, or no-CRT systems software"
  - "Optimizing high-throughput network engines (epoll, IOCP, kqueue)"
  - "Implementing non-standard packed data structures (12-bit, 24-bit, bitfields)"
---

# Skill: Macro-ASM & Low-Level Systems Synthesis

This skill counteracts the systemic high-level biases of Large Language Models (LLMs) when tasked with generating low-level systems code. LLMs by default suffer from "C gravity," hidden CRT dependencies, standard power-of-two type rigidity, instruction latency ignorance, and naive ABI translation overhead.

When generating low-level or assembly code, the model **MUST** strictly adhere to the following rules and invariants.

---

## 1. The Core Invariants

### Invariant 1: Register-First Architecture (Zero Spill)
- **The Rule:** Pass all parameters and return all values in physical registers (`rax`, `rdx`, `rcx`, `r8`, `r9`, `r10`, `r11`).
- **Antipattern:** Passing output parameters via memory pointers (`lea r9, [rsp + 16]` into `call kernel`). This forces the compiler/assembler to perform a memory spill before the call and a memory clobber reload afterward.
- **Enforcement:** If an inner kernel returns updated offsets or buffer lengths, return them directly in `rax` (or `eax`). Never spill to stack memory unless all 16 general-purpose registers are legitimately exhausted.

### Invariant 2: No-Libc & No-CRT Invariants
- **The Rule:** When building bare-metal systems, eliminate the C Runtime (CRT) and standard libraries entirely (`-nostdlib`, `-static`).
- **Antipattern:** Inlining calls to `memcpy`, `memmove`, `memset`, `strlen`, `sprintf`, or `malloc`.
- **Enforcement:**
  - Replace buffer shifts and copies with 1–2 AVX2 vector instructions (`vmovups [rdi], ymm0` / `vmovups [rdi+32], ymm1`).
  - Use stack-allocated fixed frames (`alloca` / static stack reserve) or direct OS allocation syscalls (`sys_mmap` / `sys_brk`).

### Invariant 3: Microarchitectural Latency Budgets
- **Division Ban:** Never use hardware division (`div`, `idiv`) for integer formatting or decimal conversion. Hardware division stalls the CPU execution pipeline for **35–40 cycles**.
  - *Correct Pattern:* Use Lemire/Granlund multiplicative inverse multiplication (`imul reg, 0xcccccccd; shr reg, 35`), completing in **3 cycles**.
- **Branchless Predication:** Avoid cascading conditional branches (`cmp` + `jne` / `je`) on unpredictable runtime data (e.g. sorting, parsing tokens).
  - *Correct Pattern:* Use conditional moves (`cmov`), sorting networks, or SIMD comparison masks (`vpcmpeqb`, `vptest`, `vpmovmskb`).

### Invariant 4: Sub-Word & Bit Packing Duty
- **The Rule:** If a dataset or domain value has a bounded range (e.g. `0..4095` for 12-bit keys, `0..16,777,215` for 24-bit IDs, or small enums), **do not** inflate it to `uint32_t` or `uint64_t`.
- **Reasoning:** Standard types waste 50% to 75% of CPU cache capacity (L1/L2) and memory bandwidth.
- **Enforcement:** Implement 12-bit pairwise packing, 24-bit byte triples, or bitfields with bitwise extraction instructions (`shrx`, `bextr`, `and`, `shl`).

### Invariant 5: OS Kernel ABI Layout Verification
- **The Rule:** Always verify struct layout and padding directly against Linux kernel headers or platform ABI specs, rather than assuming standard C alignment.
- **Case Study (`struct epoll_event` on Linux x86-64):**
  - Linux kernel defines `struct epoll_event` with `__attribute__((__packed__))`.
  - Its size is **strictly 12 bytes** (4 bytes `events` + 8 bytes `data`), **NOT 16 bytes**.
  - Offset of `data` is `+4`, **NOT +8**.
  - Indexing events in an array requires stepping by 12 bytes (`lea rax, [rbx + rbx*2]; shl rax, 2`), not 16.

### Invariant 6: Asynchronous Network Zero-Latency Fast Path
- **The Rule:** In non-blocking edge-triggered network event loops (`epoll` with `EPOLLET`, `kqueue` with `EV_CLEAR`, `IOCP`), **never** simply accept a connection and wait for the multiplexer to wake you up.
- **Reasoning:** If HTTP data arrived in the same packet as the TCP three-way handshake before `epoll_ctl(ADD)` was issued, no edge transition occurs after registration, causing the connection to stall until timeout.
- **Enforcement:** Always perform an immediate non-blocking `sys_read` and parse/respond directly in the `accept` branch. Only defer to `epoll_wait` if `read` returns `-EAGAIN` / `-EWOULDBLOCK`.

### Invariant 7: Macro-ASM Structural Hygiene
- **The Rule:** Avoid both high-level runtime bloat and "flat spaghetti assembly" with hundreds of arbitrary labels.
- **Pattern:** Use **Macro-ASM**:
  - Define register contracts at the top of the file:
    ```assembly
    // REGISTERS:
    // rbx = IP / read pointer
    // r12 = Stack Depth
    // r13 = Bytecode base
    // r14 = Operand stack base
    // r10d = Cached Top-of-Stack (TOS)
    ```
  - Use hygienic C preprocessor (`#define`) or GNU `.macro` to encapsulate micro-routines (e.g. `DISPATCH()`, `CHECK_STACK()`, `EMIT_CHUNK()`).
  - Retain 100% control over physical registers without compiler heuristic interference.

### Invariant 8: Linker Footprint Hygiene
- **The Rule:** Be aware of virtual memory page alignment overhead.
- **Understanding:** An ELF binary compiled with standard `ld` pads each `LOAD` segment to 4,096 bytes (`0x1000`). A 2.4 KB assembly server can become 9.6 KB on disk solely due to 6.5 KB of `0x00` padding bytes.
- **Enforcement:** For extreme embedded or micro-container deployment:
  - Link with `-Wl,-N` (or `--nmagic`) to merge readable and executable segments without page padding.
  - Pass `-Wl,--build-id=none` and strip all unneeded sections (`strip --strip-all --remove-section=.note.gnu.property`).

---

## 2. Pre-Generation Checklist for LLM Agents

Before writing systems or assembly code, answer these 6 gatekeeper questions:

1. [ ] **Register Allocation:** Are all inner-loop variables pinned to dedicated physical registers?
2. [ ] **Zero CRT:** Are all calls to `memcpy`, `memmove`, `malloc`, `printf`, and `div` completely absent?
3. [ ] **Arithmetic Latencies:** Is any division by a constant replaced with multiplicative inversion?
4. [ ] **Branchlessness:** Can condition cascades be replaced with `cmov` or SIMD mask blend?
5. [ ] **ABI Packing:** Have all OS structures been verified for packing attributes (`__packed__`)?
6. [ ] **Network Fast Path:** Is there an immediate zero-latency I/O read on `accept`?
