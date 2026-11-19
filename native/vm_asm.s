.intel_syntax noprefix
.text

.globl vm_interpret_asm
.def vm_interpret_asm; .scl 2; .type 32; .endef
vm_interpret_asm:
    // Windows x64 ABI:
    // rcx = code (uint32_t*)
    // rdx = code_len (size_t)
    // r8  = state (VMState*)

    // Prologue: save non-volatile registers
    push rbx
    push rsi
    push rdi
    push r12
    push r13
    push r14
    push r15
    sub rsp, 40

    // Setup working registers:
    // rsi = code
    // rdi = code_len
    // r14 = state
    // r12 = locals pointer (state->locals)
    // r15 = base values pointer (state->values)
    // r13 = pc (uint64_t)
    // r11 = current stack pointer (values + sp*4)
    // r10 = dispatch table pointer

    mov rsi, rcx
    mov rdi, rdx
    mov r14, r8

    lea r12, [r14 + 1032]      // state->locals (sp:4, pc:4, values:256*4=1024 -> offset 1032)
    lea r15, [r14 + 8]         // state->values (offset 8)

    movsxd r13, dword ptr [r14 + 4] // pc = state->pc
    movsxd rax, dword ptr [r14]     // sp = state->sp
    lea r11, [r15 + rax*4]          // r11 = &values[sp]

    lea r10, [rip + .L_dispatch_table]

    // Fetch first instruction
    cmp r13, rdi
    jae .L_exit

    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_HALT:
    // OP_HALT = 0
    jmp .L_exit

    .p2align 4
.L_OP_PUSH:
    // OP_PUSH = 1
    // edx has inst, imm = edx >> 8
    sar edx, 8
    mov dword ptr [r11], edx
    add r11, 4

    // Direct Threaded Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_POP:
    // OP_POP = 2
    sub r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_DUP:
    // OP_DUP = 3
    mov eax, dword ptr [r11 - 4]
    mov dword ptr [r11], eax
    add r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_SWAP:
    // OP_SWAP = 4
    mov eax, dword ptr [r11 - 4]
    mov ebx, dword ptr [r11 - 8]
    mov dword ptr [r11 - 4], ebx
    mov dword ptr [r11 - 8], eax

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_ADD:
    // OP_ADD = 5
    mov eax, dword ptr [r11 - 4]
    add dword ptr [r11 - 8], eax
    sub r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_SUB:
    // OP_SUB = 6
    mov eax, dword ptr [r11 - 4]
    sub dword ptr [r11 - 8], eax
    sub r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_MUL:
    // OP_MUL = 7
    mov eax, dword ptr [r11 - 8]
    imul eax, dword ptr [r11 - 4]
    mov dword ptr [r11 - 8], eax
    sub r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_LOADL:
    // OP_LOADL = 8
    movzx eax, dh
    and eax, 0x0F
    mov eax, dword ptr [r12 + rax*4]
    mov dword ptr [r11], eax
    add r11, 4

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_STOREL:
    // OP_STOREL = 9
    sub r11, 4
    mov eax, dword ptr [r11]
    movzx ebx, dh
    and ebx, 0x0F
    mov dword ptr [r12 + rbx*4], eax

    // Dispatch
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_JNZ:
    // OP_JNZ = 10
    sub r11, 4
    cmp dword ptr [r11], 0
    jz .L_jnz_dont_branch

    shr edx, 8
    movzx r13d, dx
    jmp .L_dispatch_next

.L_jnz_dont_branch:
    // Dispatch next
.L_dispatch_next:
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

    .p2align 4
.L_OP_JMP:
    // OP_JMP = 11
    shr edx, 8
    movzx r13d, dx
    cmp r13, rdi
    jae .L_exit
    mov edx, dword ptr [rsi + r13*4]
    inc r13
    movzx eax, dl
    cmp eax, 11
    ja .L_exit
    jmp qword ptr [r10 + rax*8]

.L_exit:
    // Write back pc and sp
    mov dword ptr [r14 + 4], r13d
    sub r11, r15
    sar r11, 2
    mov dword ptr [r14], r11d

    // Epilogue
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
    .quad .L_OP_HALT   // 0
    .quad .L_OP_PUSH   // 1
    .quad .L_OP_POP    // 2
    .quad .L_OP_DUP    // 3
    .quad .L_OP_SWAP   // 4
    .quad .L_OP_ADD    // 5
    .quad .L_OP_SUB    // 6
    .quad .L_OP_MUL    // 7
    .quad .L_OP_LOADL  // 8
    .quad .L_OP_STOREL // 9
    .quad .L_OP_JNZ    // 10
    .quad .L_OP_JMP    // 11
