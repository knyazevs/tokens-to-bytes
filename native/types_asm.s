.intel_syntax noprefix
.text

# ====================================================================
# uint64_t query_packed_asm(
#     const uint64_t* nodes,   // RCX
#     size_t count,            // RDX
#     uint32_t target_type,    // R8D
#     uint32_t min_id,         // R9D
#     uint32_t max_id          // [RSP + 40]
# )
# ====================================================================
.globl query_packed_asm
.def query_packed_asm; .scl 2; .type 32; .endef
query_packed_asm:
    test rdx, rdx
    jnz .L_has_work
    xor rax, rax
    ret

.L_has_work:
    # Save non-volatile registers xmm6..xmm11
    sub rsp, 104
    vmovdqa xmmword ptr [rsp], xmm6
    vmovdqa xmmword ptr [rsp + 16], xmm7
    vmovdqa xmmword ptr [rsp + 32], xmm8
    vmovdqa xmmword ptr [rsp + 48], xmm9
    vmovdqa xmmword ptr [rsp + 64], xmm10
    vmovdqa xmmword ptr [rsp + 80], xmm11

    # YMM4 = 4x target_type
    vmovd xmm0, r8d
    vpbroadcastq ymm4, xmm0

    # YMM5 = 4x (min_id - 1)
    lea eax, [r9d - 1]
    vmovd xmm0, eax
    vpbroadcastq ymm5, xmm0

    # YMM6 = 4x (max_id + 1)
    mov eax, dword ptr [rsp + 144]
    inc eax
    vmovd xmm0, eax
    vpbroadcastq ymm6, xmm0

    # YMM7 = 4x 0x0F (type mask)
    mov rax, 15
    vmovq xmm0, rax
    vpbroadcastq ymm7, xmm0

    # YMM8 = 4x 0x3FFF (id mask)
    mov rax, 0x3FFF
    vmovq xmm0, rax
    vpbroadcastq ymm8, xmm0

    # YMM9 = 4x 0x3FFFF (value mask)
    mov rax, 0x3FFFF
    vmovq xmm0, rax
    vpbroadcastq ymm9, xmm0

    # Accumulators
    vpxor ymm10, ymm10, ymm10   # sum0
    vpxor ymm11, ymm11, ymm11   # sum1

    cmp rdx, 8
    jb .L_tail_prep

    # End pointer for 8-node chunks
    mov r8, rdx
    and r8, -8
    lea r8, [rcx + r8 * 8]

    .p2align 4
.L_avx2_loop:
    # Load 64 bytes (8 nodes)
    vmovdqu ymm0, ymmword ptr [rcx]
    vmovdqu ymm1, ymmword ptr [rcx + 32]

    # --- Match Type (bits 0..3 == target_type) ---
    vpand ymm2, ymm0, ymm7
    vpcmpeqq ymm2, ymm2, ymm4  # mask_type0

    vpand ymm3, ymm1, ymm7
    vpcmpeqq ymm3, ymm3, ymm4  # mask_type1

    # --- Match ID (bits 10..23 in [min_id, max_id]) ---
    vpsrlq ymm12, ymm0, 10
    vpand ymm12, ymm12, ymm8   # id0
    vpcmpgtq ymm13, ymm12, ymm5 # id0 > min-1
    vpcmpgtq ymm12, ymm6, ymm12 # max+1 > id0
    vpand ymm13, ymm13, ymm12
    vpand ymm2, ymm2, ymm13    # final_mask0

    vpsrlq ymm12, ymm1, 10
    vpand ymm12, ymm12, ymm8   # id1
    vpcmpgtq ymm13, ymm12, ymm5 # id1 > min-1
    vpcmpgtq ymm12, ymm6, ymm12 # max+1 > id1
    vpand ymm13, ymm13, ymm12
    vpand ymm3, ymm3, ymm13    # final_mask1

    # --- Extract Value (bits 24..41) and mask ---
    vpsrlq ymm12, ymm0, 24
    vpand ymm12, ymm12, ymm9
    vpand ymm12, ymm12, ymm2   # zero if not matched
    vpaddq ymm10, ymm10, ymm12 # accumulate sum0

    vpsrlq ymm12, ymm1, 24
    vpand ymm12, ymm12, ymm9
    vpand ymm12, ymm12, ymm3   # zero if not matched
    vpaddq ymm11, ymm11, ymm12 # accumulate sum1

    add rcx, 64
    cmp rcx, r8
    jb .L_avx2_loop

    # Combine accumulators: ymm10 += ymm11
    vpaddq ymm10, ymm10, ymm11

.L_tail_prep:
    # Horizontal add ymm10 -> rax
    vextracti128 xmm0, ymm10, 1
    vpaddq xmm0, xmm0, xmm10
    vpsrldq xmm1, xmm0, 8
    vpaddq xmm0, xmm0, xmm1
    vmovq rax, xmm0

    # Restore callee-saved registers
    vmovdqa xmm6, xmmword ptr [rsp]
    vmovdqa xmm7, xmmword ptr [rsp + 16]
    vmovdqa xmm8, xmmword ptr [rsp + 32]
    vmovdqa xmm9, xmmword ptr [rsp + 48]
    vmovdqa xmm10, xmmword ptr [rsp + 64]
    vmovdqa xmm11, xmmword ptr [rsp + 80]
    add rsp, 104

    vzeroupper
    ret
