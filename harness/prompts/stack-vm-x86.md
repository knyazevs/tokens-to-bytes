# Task Specification: Native x86-64 Direct-Threaded Stack VM

You are tasked with engineering a high-speed bytecode virtual machine interpreter in x86-64 assembly (`.S`).

---

## 1. Interface & Data Model
- Interprets 4-byte fixed instructions: `[opcode: uint8, x: uint8, y: uint8, z: uint8]`.
- 27 opcodes: arithmetic (`ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`), bitwise (`AND`, `OR`, `XOR`, `SHL`, `SHR`), comparisons (`EQ`, `LT`, `LE`), locals (`GET_LOCAL`, `SET_LOCAL`), stack operations (`PUSH_CONST`, `POP`, `DUP`, `SWAP`), control flow (`JUMP`, `JUMP_IF`, `CALL`, `RET`, `HALT`).
- Frame and operand stack: 1024 stack slots, 128 call frames with 8 locals per frame.

---

## 2. Hardware Invariants & Optimization Goals
- **Direct Threading:** Do NOT use a `switch` loop with bounds-checked jump instructions. Use computed goto / direct threaded dispatch table (`jmp [dispatch_table + rax*8]`).
- **Physical Register Pinning:**
  - Pin the instruction pointer (IP / PC) in a physical register (`rbx`).
  - Pin the operand stack pointer (`sp`) and stack depth in physical registers (`r12`, `r14`).
  - Cache the Top-of-Stack (TOS) value directly in a register (`r10d`).
- **Zero Function Call Tax:** Macro-ASM inline expansion of opcode routines.

---

## 3. Parity Target
- **Correctness:** 52 / 52 tests passed.
- **Speed:** Execution time $\le$ 1.80 seconds on reference benchmark (45,000+ runs/s).
- **Parity Baseline:** Must match or beat Clang -O3 compiled C reference.
