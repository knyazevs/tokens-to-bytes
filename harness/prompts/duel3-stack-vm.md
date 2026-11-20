# Task Specification: Native x86-64 Stack VM Bytecode Interpreter

You are tasked with engineering a world-class, ultra-fast bytecode virtual machine interpreter in x86-64 assembly (`.s` / `.S`) targeting Windows x64 ABI.

Your implementation will compete directly in real-time hardware cycle benchmarking against Clang -O3 compiled C++ and a human Macro-ASM baseline on a physical CPU core.

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

## 3. Macro-ASM Framework & Macro Library

Standard compiled C++ (`switch` loop) runs at **3.66 cycles per opcode**.
The human Macro-ASM reference runs at **1.56 cycles per opcode**.
Your goal is **<= 1.80 cycles per opcode** (> 50% speedup).

To achieve maximum performance without boilerplate errors, you are provided with and encouraged to use the **Macro-ASM** abstraction framework (C-preprocessor `#define` macros or GAS `.macro`):

### Core Direct Threading Dispatch Macro:
```gas
#define DISPATCH \
    mov edx, dword ptr [rsi + r13*4]; \
    inc r13; \
    movzx eax, dl; \
    jmp qword ptr [r10 + rax*8]
```

### Binary Arithmetic Template Macro:
```gas
#define BINARY_OP(name, inst) \
    .p2align 4; \
    .L_OP_##name: \
        mov eax, dword ptr [r11 - 4]; \
        inst dword ptr [r11 - 8], eax; \
        sub r11, 4; \
        DISPATCH
```

### Recommended Register Pinning:
- `rsi` = code pointer (`code`)
- `r12` = `VMState*`
- `r13` = program counter (`pc`, instruction index)
- `r11` = operand stack top pointer (`&values[sp]`)
- `r14` = locals array base (`&locals[0]`)
- `r10` = dispatch table base address (`dispatch_table`)

You may adapt, extend, or refine these macros (e.g. adding Top-of-Stack register caching or branch-free decoding) to beat the 1.56 c/op baseline.

---

## 4. Parity Target
- **Correctness:** 100% state match with C++ reference on both functional and 200,000-iteration reduction loop programs.
- **Speed:** $\le$ 1.80 cycles / op.

Produce ONLY the compilable assembly file enclosed in ````assembly ... ````.
