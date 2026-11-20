# Task Specification: Native x86-64 Stack VM Bytecode Interpreter

You are tasked with engineering a world-class, ultra-fast bytecode virtual machine interpreter in x86-64 assembly (`.s` / `.S`) targeting Windows x64 ABI.

Your implementation will compete directly in real-time hardware cycle benchmarking against Clang -O3 compiled C++ on a physical CPU core.

---

## 1. Function Signature & Windows x64 ABI
You must export a single function:
```c
extern "C" void vm_interpret(const uint32_t* code, size_t code_len, VMState* state);
```
- Parameters:
  - `rcx` = pointer to 32-bit instructions (`code`)
  - `rdx` = number of instructions (`code_len`)
  - `r8`  = pointer to `VMState`
- Calling Convention: Windows x64 ABI.
  - Preserved (non-volatile) registers that MUST be saved/restored if modified: `rbx`, `rsi`, `rdi`, `r12`, `r13`, `r14`, `r15`.
  - Scratch registers: `rax`, `rcx`, `rdx`, `r8`, `r9`, `r10`, `r11`.

---

## 2. Data Structures & Instruction Encoding
```c
struct VMState {
    int32_t sp;           // offset 0: operand stack pointer (number of items on stack)
    int32_t pc;           // offset 4: program counter
    int32_t values[256];  // offset 8: operand stack array (int32)
    int32_t locals[16];   // offset 1032: local variables array (int32)
};
```

Each instruction is a 32-bit integer:
- **Low 8 bits (`inst & 0xFF`):** Opcode (0 to 11).
- **High 24 bits (`(int32_t)inst >> 8`):** Signed 24-bit immediate operand.

### The 12 Opcodes:
- `0 (OP_HALT)`: Halt execution. Save current `pc` and `sp` back to `state`, restore non-volatile registers, and return.
- `1 (OP_PUSH imm)`: Push signed immediate `imm` onto stack (`values[sp++] = imm`).
- `2 (OP_POP)`: Pop and discard top of stack (`--sp`).
- `3 (OP_DUP)`: Duplicate top of stack (`values[sp] = values[sp - 1]; sp++`).
- `4 (OP_SWAP)`: Swap the top two elements on the stack.
- `5 (OP_ADD)`: Pop `b`, pop `a`, push `a + b` (`values[sp - 2] += values[sp - 1]; --sp`).
- `6 (OP_SUB)`: Pop `b`, pop `a`, push `a - b` (`values[sp - 2] -= values[sp - 1]; --sp`).
- `7 (OP_MUL)`: Pop `b`, pop `a`, push `a * b` (`values[sp - 2] *= values[sp - 1]; --sp`).
- `8 (OP_LOADL idx)`: Read `locals[idx]` and push onto stack.
- `9 (OP_STOREL idx)`: Pop top of stack and write into `locals[idx]`.
- `10 (OP_JNZ target_pc)`: Pop condition; if `condition != 0`, set `pc = target_pc`. Otherwise proceed to next instruction.
- `11 (OP_JMP target_pc)`: Unconditional jump: set `pc = target_pc`.

---

## 3. Mandatory Hardware Optimization Invariants (Macro-ASM Skill)

Standard compiled C++ (`switch` loop) runs at **3.66 cycles per opcode**. Your goal is **<= 1.80 cycles per opcode** (> 50% speedup).

To achieve this hardware parity:
1. **Direct Threading (Computed GOTO):** Do NOT use a `switch` jump or binary search. Build a direct dispatch table of 12 code pointers (`.quad .L_OP_0, .L_OP_1, ...`) and dispatch with `jmp [table + rax*8]`.
2. **Register Pinning (Zero Memory Access in Loop):**
   - Pin the instruction pointer (PC / offset) in a dedicated physical register (e.g. `r13`).
   - Pin the operand stack pointer/address in a dedicated register (e.g. `r11` pointing to `&values[sp]`).
   - Pin the dispatch table base address in a register (e.g. `r10`).
3. **Macro-ASM Hygiene:**
   - Define a `DISPATCH` macro to fetch next instruction and jump in 3-4 instructions without function calls.

---

## 4. Parity Target
- **Correctness:** 100% state match with C++ reference on both functional and 200,000-iteration reduction loop programs.
- **Speed:** $\le$ 1.80 cycles / op.

Produce ONLY the compilable assembly file enclosed in ````assembly ... ````.
