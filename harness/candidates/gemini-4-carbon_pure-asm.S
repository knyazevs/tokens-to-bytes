/*
 * Native x86-64 Direct-Threaded Stack VM Interpreter (Windows x64 ABI)
 *
 * REGISTER CONTRACT:
 *   rcx  = const uint32_t* code       (Bytecode base pointer, pinned)
 *   rdx  = int64_t inst / imm         (Fetched instruction & sign-extended immediate)
 *   r8   = VMState* state             (VMState base pointer, pinned)
 *   r10  = const void* const* table   (Direct-threaded dispatch table base, pinned)
 *   r11  = int32_t* sp_ptr            (&state->values[sp], pinned)
 *   r13  = const uint32_t* ip         (&code[pc], instruction read pointer, pinned)
 *   ebx  = int32_t tos                (Write-through cached Top-of-Stack: values[sp - 1])
 *   esi  = int32_t nos                (Write-through cached Next-on-Stack: values[sp - 2])
 *   rax  = uint64_t op / scratch      (Decoded opcode index 0..11 & scratch)
 */

.intel_syntax noprefix
.text
.globl vm_interpret

.macro DISPATCH
    movsxd rdx, dword ptr [r13]
    add r13, 4
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]
.endm

.p2align 4
vm_interpret:
    push rbx
    push rsi
    push r13

    movsxd rax, dword ptr [r8 + 4]
    cmp rax, rdx
    jae .L_early_exit

    lea r13, [rcx + rax*4]
    movsxd rax, dword ptr [r8]
    lea r11, [r8 + rax*4 + 8]
    mov ebx, dword ptr [r11 - 4]
    mov esi, dword ptr [r11 - 8]
    lea r10, [rip + .L_dispatch_table]

    DISPATCH

.p2align 4
.L_OP_0: /* OP_HALT */
    lea rax, [r8 + 8]
    sub r11, rax
    sar r11, 2
    mov dword ptr [r8], r11d

    sub r13, rcx
    sar r13, 2
    mov dword ptr [r8 + 4], r13d

.L_early_exit:
    pop r13
    pop rsi
    pop rbx
    ret

.p2align 4
.L_OP_1: /* OP_PUSH imm */
    sar rdx, 8
    mov esi, ebx
    mov ebx, edx
    mov dword ptr [r11], edx
    add r11, 4
    DISPATCH

.p2align 4
.L_OP_2: /* OP_POP */
    sub r11, 4
    mov ebx, esi
    mov esi, dword ptr [r11 - 8]
    DISPATCH

.p2align 4
.L_OP_3: /* OP_DUP */
    mov esi, ebx
    mov dword ptr [r11], ebx
    add r11, 4
    DISPATCH

.p2align 4
.L_OP_4: /* OP_SWAP */
    mov eax, ebx
    mov ebx, esi
    mov esi, eax
    mov dword ptr [r11 - 4], ebx
    mov dword ptr [r11 - 8], esi
    DISPATCH

.p2align 4
.L_OP_5: /* OP_ADD */
    sub r11, 4
    add ebx, esi
    mov dword ptr [r11 - 4], ebx
    mov esi, dword ptr [r11 - 8]
    DISPATCH

.p2align 4
.L_OP_6: /* OP_SUB */
    sub r11, 4
    sub esi, ebx
    mov ebx, esi
    mov dword ptr [r11 - 4], esi
    mov esi, dword ptr [r11 - 8]
    DISPATCH

.p2align 4
.L_OP_7: /* OP_MUL */
    sub r11, 4
    imul ebx, esi
    mov dword ptr [r11 - 4], ebx
    mov esi, dword ptr [r11 - 8]
    DISPATCH

.p2align 4
.L_OP_8: /* OP_LOADL idx */
    sar rdx, 8
    mov esi, ebx
    mov ebx, dword ptr [r8 + rdx*4 + 1032]
    mov dword ptr [r11], ebx
    add r11, 4
    DISPATCH

.p2align 4
.L_OP_9: /* OP_STOREL idx */
    sar rdx, 8
    sub r11, 4
    mov dword ptr [r8 + rdx*4 + 1032], ebx
    mov ebx, esi
    mov esi, dword ptr [r11 - 8]
    DISPATCH

.p2align 4
.L_OP_10: /* OP_JNZ target_pc */
    mov eax, ebx
    sub r11, 4
    mov ebx, esi
    mov esi, dword ptr [r11 - 8]
    test eax, eax
    jz .L_jnz_fallthrough
    sar rdx, 8
    lea r13, [rcx + rdx*4]
    DISPATCH

.p2align 4
.L_jnz_fallthrough:
    DISPATCH

.p2align 4
.L_OP_11: /* OP_JMP target_pc */
    sar rdx, 8
    lea r13, [rcx + rdx*4]
    DISPATCH

.p2align 3
.L_dispatch_table:
    .quad .L_OP_0
    .quad .L_OP_1
    .quad .L_OP_2
    .quad .L_OP_3
    .quad .L_OP_4
    .quad .L_OP_5
    .quad .L_OP_6
    .quad .L_OP_7
    .quad .L_OP_8
    .quad .L_OP_9
    .quad .L_OP_10
    .quad .L_OP_11
