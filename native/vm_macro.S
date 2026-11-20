// ============================================================================
// Macro-ASM Direct Threading Stack VM Reference
// Implements 12 opcodes with zero-latency computed goto and direct register caching
// ============================================================================

.intel_syntax noprefix
.text

// ----------------------------------------------------------------------------
// Core Direct Threading Dispatch Macro
// ----------------------------------------------------------------------------
#define DISPATCH \
    mov edx, dword ptr [rsi + r13*4]; \
    inc r13; \
    movzx eax, dl; \
    jmp qword ptr [r10 + rax*8]

// ----------------------------------------------------------------------------
// Binary Operation Template Macro
// ----------------------------------------------------------------------------
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
    mov rdi, rdx                     // rdi = code length
    mov r12, r8                      // r12 = VMState pointer

    mov r13d, dword ptr [r12 + 4]    // r13 = pc
    mov eax, dword ptr [r12]         // eax = sp
    lea r11, [r12 + 8 + rax*4]       // r11 = &values[sp] (stack top pointer)

    lea r14, [r12 + 1032]            // r14 = &locals[0]
    lea r10, [rip + dispatch_table]  // r10 = dispatch table base

    // Enter execution loop
    DISPATCH

    // ------------------------------------------------------------------------
    // Opcode Handlers
    // ------------------------------------------------------------------------

    .p2align 4
    .L_OP_HALT:
        jmp .L_exit

    .p2align 4
    .L_OP_PUSH:
        sar edx, 8                   // edx = sign-extended immediate
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
        mov edx, dword ptr [r11 - 8]
        mov dword ptr [r11 - 4], edx
        mov dword ptr [r11 - 8], eax
        DISPATCH

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
        sar edx, 8
        mov eax, dword ptr [r14 + rdx*4]
        mov dword ptr [r11], eax
        add r11, 4
        DISPATCH

    .p2align 4
    .L_OP_STOREL:
        sar edx, 8
        sub r11, 4
        mov eax, dword ptr [r11]
        mov dword ptr [r14 + rdx*4], eax
        DISPATCH

    .p2align 4
    .L_OP_JNZ:
        sub r11, 4
        mov eax, dword ptr [r11]
        test eax, eax
        jz .L_jnz_fallthrough
        sar edx, 8
        mov r13d, edx
    .L_jnz_fallthrough:
        DISPATCH

    .p2align 4
    .L_OP_JMP:
        sar edx, 8
        mov r13d, edx
        DISPATCH

    // ------------------------------------------------------------------------
    // Exit & Epilogue
    // ------------------------------------------------------------------------
    .p2align 4
    .L_exit:
        // Sync VMState (pc and sp)
        mov dword ptr [r12 + 4], r13d
        lea rax, [r12 + 8]
        sub r11, rax
        shr r11, 2
        mov dword ptr [r12], r11d

        // Windows x64 ABI Epilogue
        add rsp, 40
        pop r15
        pop r14
        pop r13
        pop r12
        pop rdi
        pop rsi
        pop rbx
        ret

// ----------------------------------------------------------------------------
// Computed GOTO Dispatch Table
// ----------------------------------------------------------------------------
.section .rdata,"dr"
.p2align 3
dispatch_table:
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
