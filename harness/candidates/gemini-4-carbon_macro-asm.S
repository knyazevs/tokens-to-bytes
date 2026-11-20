/*
 * Native x86-64 Stack VM Bytecode Interpreter (Windows x64 ABI)
 *
 * REGISTER CONTRACT:
 *   r8  = Instruction Pointer (ip = &code[pc])
 *   r9  = Bytecode base pointer (&code[0])
 *   r10 = Direct-threading dispatch table base
 *   r11 = Operand stack top pointer (&state->values[sp])
 *   rdi = Locals base pointer (&state->locals[0]; state == rdi - 1032)
 *   ecx = Write-through cached Top-of-Stack (TOS = values[sp - 1])
 *   esi = Write-through cached Next-on-Stack (NOS = values[sp - 2])
 *   edx = Current / prefetched 32-bit instruction word
 *   eax = Opcode index / scratch
 */

    .intel_syntax noprefix
    .text

.macro DISPATCH
    mov edx, dword ptr [r8]
    add r8, 4
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]
.endm

.macro BINARY_COMM_OP label, mnemonic
    .p2align 6
\label:
    mov edx, dword ptr [r8]
    \mnemonic ecx, esi
    mov esi, dword ptr [r11 - 12]
    add r8, 4
    mov dword ptr [r11 - 8], ecx
    movzx eax, dl
    sub r11, 4
    jmp qword ptr [r10 + rax*8]
.endm

    .globl vm_interpret
    .p2align 6
vm_interpret:
    /* Entry ABI: rcx = code, rdx = code_len, r8 = state */
    movsxd rax, dword ptr [r8 + 4]
    cmp rax, rdx
    jae .L_early_ret

    push rsi
    push rdi

    mov r9, rcx
    movsxd rcx, dword ptr [r8]
    lea rdi, [r8 + 1032]
    lea r11, [r8 + rcx*4 + 8]
    lea r8, [r9 + rax*4]
    lea r10, [rip + .L_dispatch_table]

    /* Safe preload of TOS and NOS (reads within VMState even when sp < 2) */
    mov ecx, dword ptr [r11 - 4]
    mov esi, dword ptr [r11 - 8]

    DISPATCH

.L_early_ret:
    ret

    /* 0: OP_HALT */
    .p2align 6
.L_OP_HALT:
    lea rax, [rdi - 1024]
    sub r11, rax
    sar r11, 2
    sub r8, r9
    sar r8, 2
    mov dword ptr [rdi - 1032], r11d
    mov dword ptr [rdi - 1028], r8d
    pop rdi
    pop rsi
    ret

    /* 1: OP_PUSH imm */
    .p2align 6
.L_OP_PUSH:
    mov esi, ecx
    mov ecx, edx
    mov edx, dword ptr [r8]
    sar ecx, 8
    add r8, 4
    mov dword ptr [r11], ecx
    movzx eax, dl
    add r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 2: OP_POP */
    .p2align 6
.L_OP_POP:
    mov edx, dword ptr [r8]
    mov ecx, esi
    mov esi, dword ptr [r11 - 12]
    add r8, 4
    movzx eax, dl
    sub r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 3: OP_DUP */
    .p2align 6
.L_OP_DUP:
    mov edx, dword ptr [r8]
    mov esi, ecx
    mov dword ptr [r11], ecx
    add r8, 4
    movzx eax, dl
    add r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 4: OP_SWAP */
    .p2align 6
.L_OP_SWAP:
    mov edx, dword ptr [r8]
    mov eax, ecx
    mov ecx, esi
    mov esi, eax
    mov dword ptr [r11 - 8], eax
    mov dword ptr [r11 - 4], ecx
    add r8, 4
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]

    /* 5: OP_ADD */
    BINARY_COMM_OP .L_OP_ADD, add

    /* 6: OP_SUB */
    .p2align 6
.L_OP_SUB:
    mov edx, dword ptr [r8]
    sub esi, ecx
    mov ecx, esi
    mov esi, dword ptr [r11 - 12]
    add r8, 4
    mov dword ptr [r11 - 8], ecx
    movzx eax, dl
    sub r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 7: OP_MUL */
    BINARY_COMM_OP .L_OP_MUL, imul

    /* 8: OP_LOADL idx */
    .p2align 6
.L_OP_LOADL:
    movsxd rax, edx
    mov edx, dword ptr [r8]
    sar rax, 8
    mov esi, ecx
    mov ecx, dword ptr [rdi + rax*4]
    add r8, 4
    mov dword ptr [r11], ecx
    movzx eax, dl
    add r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 9: OP_STOREL idx */
    .p2align 6
.L_OP_STOREL:
    movsxd rax, edx
    mov edx, dword ptr [r8]
    sar rax, 8
    mov dword ptr [rdi + rax*4], ecx
    mov ecx, esi
    mov esi, dword ptr [r11 - 12]
    add r8, 4
    movzx eax, dl
    sub r11, 4
    jmp qword ptr [r10 + rax*8]

    /* 10: OP_JNZ target_pc */
    .p2align 6
.L_OP_JNZ:
    mov eax, ecx
    mov ecx, esi
    mov esi, dword ptr [r11 - 12]
    sub r11, 4
    test eax, eax
    jz .L_jnz_not_taken
    movsxd rdx, edx
    sar rdx, 8
    lea r8, [r9 + rdx*4 + 4]
    mov edx, dword ptr [r9 + rdx*4]
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_jnz_not_taken:
    DISPATCH

    /* 11: OP_JMP target_pc */
    .p2align 6
.L_OP_JMP:
    movsxd rdx, edx
    sar rdx, 8
    lea r8, [r9 + rdx*4 + 4]
    mov edx, dword ptr [r9 + rdx*4]
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]

    .p2align 7
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
