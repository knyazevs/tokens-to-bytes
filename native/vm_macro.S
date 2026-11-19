// ============================================================================
// Macro-Assembly (GAS + CPP) implementation of Stack VM Bytecode Interpreter
// Synthesized for LLM Context Compression with Zero Abstraction Penalty
// ============================================================================

.intel_syntax noprefix
.text

// ----------------------------------------------------------------------------
// Core Architecture Macros
// ----------------------------------------------------------------------------

// Direct Threaded Dispatch Macro: fetches next opcode and jumps directly to its handler
#define DISPATCH \
    cmp r13, rdi; \
    jae .L_exit; \
    mov edx, dword ptr [rsi + r13*4]; \
    inc r13; \
    movzx eax, dl; \
    cmp eax, 11; \
    ja .L_exit; \
    jmp qword ptr [r10 + rax*8]

// Binary Arithmetic Operations: reads top-of-stack, executes instruction, shrinks stack
#define BINARY_OP(name, inst) \
    .p2align 4; \
    .L_OP_##name: \
        mov eax, dword ptr [r11 - 4]; \
        inst dword ptr [r11 - 8], eax; \
        sub r11, 4; \
        DISPATCH

// ----------------------------------------------------------------------------
// Entry Point: vm_interpret_macro
// ----------------------------------------------------------------------------
.globl vm_interpret_macro
.def vm_interpret_macro; .scl 2; .type 32; .endef
vm_interpret_macro:
    // Windows x64 ABI Prologue: preserve non-volatile registers
    push rbx
    push rsi
    push rdi
    push r12
    push r13
    push r14
    push r15
    sub rsp, 40

    // Setup working environment
    mov rsi, rcx                     // rsi = code pointer
    mov rdi, rdx                     // rdi = code_len
    mov r14, r8                      // r14 = state pointer

    lea r12, [r14 + 1032]            // r12 = &state->locals[0]
    lea r15, [r14 + 8]               // r15 = &state->values[0]

    movsxd r13, dword ptr [r14 + 4]  // r13 = pc
    movsxd rax, dword ptr [r14]      // rax = sp
    lea r11, [r15 + rax*4]           // r11 = &values[sp] (TOS pointer)

    lea r10, [rip + .L_dispatch_table]

    // Initial dispatch
    DISPATCH

    .p2align 4
.L_OP_HALT:
    jmp .L_exit

    .p2align 4
.L_OP_PUSH:
    sar edx, 8
    mov dword ptr [r11], edx
    add r11, 4
    DISPATCH

    .p2align 4
.L_OP_POP:
    sub r11, 4
    DISPATCH

    .p2align 4
.L_OP_DUP:
    mov eax, dword ptr [r11 - 4]
    mov dword ptr [r11], eax
    add r11, 4
    DISPATCH

    .p2align 4
.L_OP_SWAP:
    mov eax, dword ptr [r11 - 4]
    mov ebx, dword ptr [r11 - 8]
    mov dword ptr [r11 - 4], ebx
    mov dword ptr [r11 - 8], eax
    DISPATCH

    // Binary operations defined via macro
    BINARY_OP(ADD, add)
    BINARY_OP(SUB, sub)

    .p2align 4
.L_OP_MUL:
    mov eax, dword ptr [r11 - 8]
    imul eax, dword ptr [r11 - 4]
    mov dword ptr [r11 - 8], eax
    sub r11, 4
    DISPATCH

    .p2align 4
.L_OP_LOADL:
    movzx eax, dh
    and eax, 0x0F
    mov eax, dword ptr [r12 + rax*4]
    mov dword ptr [r11], eax
    add r11, 4
    DISPATCH

    .p2align 4
.L_OP_STOREL:
    sub r11, 4
    mov eax, dword ptr [r11]
    movzx ebx, dh
    and ebx, 0x0F
    mov dword ptr [r12 + rbx*4], eax
    DISPATCH

    .p2align 4
.L_OP_JNZ:
    sub r11, 4
    cmp dword ptr [r11], 0
    jz .L_jnz_skip
    shr edx, 8
    movzx r13d, dx
.L_jnz_skip:
    DISPATCH

    .p2align 4
.L_OP_JMP:
    shr edx, 8
    movzx r13d, dx
    DISPATCH

.L_exit:
    // Epilogue: sync state back to struct
    mov dword ptr [r14 + 4], r13d
    sub r11, r15
    sar r11, 2
    mov dword ptr [r14], r11d

    add rsp, 40
    pop r15
    pop r14
    pop r13
    pop r12
    pop rdi
    pop rsi
    pop rbx
    ret

.section .rdata,"dr"
.p2align 3
.L_dispatch_table:
    .quad .L_OP_HALT
    .quad .L_OP_PUSH
    .quad .L_OP_POP
    .quad .L_OP_DUP
    .quad .L_OP_SWAP
    .quad .L_OP_ADD
    .quad .L_OP_SUB
    .quad .L_OP_MUL
    .quad .L_OP_LOADL
    .quad .L_OP_STOREL
    .quad .L_OP_JNZ
    .quad .L_OP_JMP
