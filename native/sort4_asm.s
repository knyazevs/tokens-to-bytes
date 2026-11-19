.intel_syntax noprefix
.text

# ====================================================================
# void sort4_asm(int32_t a[4])
# RCX = a
# Only volatile registers: XMM0-XMM3
# ====================================================================
.globl sort4_asm
.def sort4_asm; .scl 2; .type 32; .endef
sort4_asm:
    vmovdqu xmm0, xmmword ptr [rcx]
    
    # Stage 1: (0,1) and (2,3)
    vpshufd xmm1, xmm0, 0xb1
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 10
    
    # Stage 2: (0,2) and (1,3)
    vpshufd xmm1, xmm0, 0x4e
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 12
    
    # Stage 3: (1,2)
    vpshufd xmm1, xmm0, 0xd8
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 4
    
    vmovdqu xmmword ptr [rcx], xmm0
    ret

# ====================================================================
# void sort4_batch_asm(int32_t* data, size_t count)
# RCX = data, RDX = count
#
# Processes 4 arrays (16 ints = 64 bytes = exactly 1 L1 cache line)
# using ONLY volatile registers YMM0..YMM4 (no stack frame/ABI spill).
# ====================================================================
.globl sort4_batch_asm
.def sort4_batch_asm; .scl 2; .type 32; .endef
sort4_batch_asm:
    test rdx, rdx
    jz .L_batch_ret

    cmp rdx, 4
    jb .L_tail_loop

    .p2align 4
.L_unrolled_loop:
    # Load 64 bytes (4 arrays) into YMM0 and YMM4
    vmovdqu ymm0, ymmword ptr [rcx]
    vmovdqu ymm4, ymmword ptr [rcx + 32]
    
    # Stage 1: (0,1) and (2,3)
    vpshufd ymm1, ymm0, 0xb1
    vpminsd ymm2, ymm0, ymm1
    vpmaxsd ymm3, ymm0, ymm1
    vpblendd ymm0, ymm2, ymm3, 170

    vpshufd ymm1, ymm4, 0xb1
    vpminsd ymm2, ymm4, ymm1
    vpmaxsd ymm3, ymm4, ymm1
    vpblendd ymm4, ymm2, ymm3, 170

    # Stage 2: (0,2) and (1,3)
    vpshufd ymm1, ymm0, 0x4e
    vpminsd ymm2, ymm0, ymm1
    vpmaxsd ymm3, ymm0, ymm1
    vpblendd ymm0, ymm2, ymm3, 204

    vpshufd ymm1, ymm4, 0x4e
    vpminsd ymm2, ymm4, ymm1
    vpmaxsd ymm3, ymm4, ymm1
    vpblendd ymm4, ymm2, ymm3, 204

    # Stage 3: (1,2)
    vpshufd ymm1, ymm0, 0xd8
    vpminsd ymm2, ymm0, ymm1
    vpmaxsd ymm3, ymm0, ymm1
    vpblendd ymm0, ymm2, ymm3, 68

    vpshufd ymm1, ymm4, 0xd8
    vpminsd ymm2, ymm4, ymm1
    vpmaxsd ymm3, ymm4, ymm1
    vpblendd ymm4, ymm2, ymm3, 68

    # Store 64 bytes back
    vmovdqu ymmword ptr [rcx], ymm0
    vmovdqu ymmword ptr [rcx + 32], ymm4

    add rcx, 64
    sub rdx, 4
    cmp rdx, 4
    jae .L_unrolled_loop

.L_tail_loop:
    test rdx, rdx
    jz .L_batch_ret

    vmovdqu xmm0, xmmword ptr [rcx]
    vpshufd xmm1, xmm0, 0xb1
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 10

    vpshufd xmm1, xmm0, 0x4e
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 12

    vpshufd xmm1, xmm0, 0xd8
    vpminsd xmm2, xmm0, xmm1
    vpmaxsd xmm3, xmm0, xmm1
    vpblendd xmm0, xmm2, xmm3, 4

    vmovdqu xmmword ptr [rcx], xmm0
    add rcx, 16
    dec rdx
    jnz .L_tail_loop

.L_batch_ret:
    vzeroupper
    ret
