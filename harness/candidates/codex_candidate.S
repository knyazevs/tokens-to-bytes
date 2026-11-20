.intel_syntax noprefix
.text
.globl vm_interpret
.def vm_interpret; .scl 2; .type 32; .endef

// r13: instruction pointer, rdi: end of code, rcx: code base.
// r11: next free stack slot, r14d/r15d: top two items, r10: jump table.
// Stack writes are mirrored in VMState. Empty cache slots have no VM meaning.
.macro dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [r13]
    add r13, 4
    movzx eax, dl
    jmp qword ptr [r10 + rax*8]
.endm

.macro pop_cached
    sub r11, 4
    mov r14d, r15d
    mov r15d, dword ptr [r11 - 8]
.endm

.macro binary name, operation
    .p2align 4
 .L_\name:
    \operation r15d, r14d
    sub r11, 4
    mov r14d, r15d
    mov dword ptr [r11 - 4], r14d
    mov r15d, dword ptr [r11 - 8]
    dispatch
.endm

.seh_proc vm_interpret
vm_interpret:
    push rdi
    .seh_pushreg rdi
    push r13
    .seh_pushreg r13
    push r14
    .seh_pushreg r14
    push r15
    .seh_pushreg r15
    .seh_endprologue

    lea rdi, [rcx + rdx*4]
    movsxd rax, dword ptr [r8 + 4]
    lea r13, [rcx + rax*4]
    movsxd r9, dword ptr [r8]
    lea r11, [r8 + 8 + r9*4]
    cmp rax, rdx
    jae .L_exit
    mov r14d, dword ptr [r11 - 4]
    mov r15d, dword ptr [r11 - 8]
    lea r10, [rip + .L_table]
    dispatch

    .p2align 4
.L_push:
    sar edx, 8
    mov r15d, r14d
    mov r14d, edx
    mov dword ptr [r11], edx
    add r11, 4
    dispatch

    .p2align 4
.L_pop:
    pop_cached
    dispatch

    .p2align 4
.L_dup:
    mov r15d, r14d
    mov dword ptr [r11], r14d
    add r11, 4
    dispatch

    .p2align 4
.L_swap:
    mov eax, r14d
    mov r14d, r15d
    mov r15d, eax
    mov dword ptr [r11 - 8], eax
    mov dword ptr [r11 - 4], r14d
    dispatch

    binary add, add
    binary sub, sub
    binary mul, imul

    .p2align 4
.L_loadl:
    and edx, 0xf00
    shr edx, 8
    mov edx, dword ptr [r8 + rdx*4 + 1032]
    mov r15d, r14d
    mov r14d, edx
    mov dword ptr [r11], edx
    add r11, 4
    dispatch

    .p2align 4
.L_storel:
    and edx, 0xf00
    shr edx, 8
    mov dword ptr [r8 + rdx*4 + 1032], r14d
    pop_cached
    dispatch

    .p2align 4
.L_jnz:
    test r14d, r14d
    lea r11, [r11 - 4]
    mov r14d, r15d
    mov r15d, dword ptr [r11 - 8]
    jz .L_fallthrough
.L_jmp:
    shr edx, 8
    movzx edx, dx
    lea r13, [rcx + rdx*4]
.L_fallthrough:
    dispatch

.L_exit:
    sub r13, rcx
    sar r13, 2
    mov dword ptr [r8 + 4], r13d
    sub r11, r8
    sub r11, 8
    sar r11, 2
    mov dword ptr [r8], r11d
    pop r15
    pop r14
    pop r13
    pop rdi
    ret
.seh_endproc

.section .rdata,"dr"
.p2align 3
.L_table:
    .quad .L_exit, .L_push, .L_pop, .L_dup
    .quad .L_swap, .L_add, .L_sub, .L_mul
    .quad .L_loadl, .L_storel, .L_jnz, .L_jmp
    .rept 244
    .quad .L_exit
    .endr
