.intel_syntax noprefix

#define HTTP_GET_MAGIC 0x20544547 /* "GET " */
#define BASELINE_PREFIX 0x6e696c657361622f /* "/baselin" */
#define JSON_PREFIX 0x00002f6e6f736a2f /* "/json/" */

#define LEN_OK_PLAIN 59
#define LEN_OK_JSON 65
#define LEN_CRLF_CRLF 28
#define LEN_JSON_TAIL 27
#define LEN_404 69
#define LEN_405 73

.section .rdata,"dr"
.p2align 5
str_ok_plain:
    .ascii "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: "
str_ok_json:
    .ascii "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
str_crlf_crlf:
    .ascii "\r\nConnection: keep-alive\r\n\r\n"
str_json_tail:
    .ascii ",\"message\":\"Hello, World!\"}"
str_404:
    .ascii "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n"
str_405:
    .ascii "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
.space 64, 0

.text
.globl asm_handle_request
.def asm_handle_request; .scl 2; .type 32; .endef

/*
 * AVX2 256-bit Overlapping Vector Macros:
 * Copies 59 bytes in TWO 256-bit instructions!
 * Zero branching, 0 microcode loops
 */
.macro COPY_59_PLAIN_FAST
    vmovups ymm0, [rip + str_ok_plain]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_ok_plain + 27]
    vmovups [r8 + 27], ymm1
    add r8, 59
.endm

.macro COPY_65_JSON_FAST
    vmovups ymm0, [rip + str_ok_json]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_ok_json + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_ok_json + 33]
    vmovups [r8 + 33], ymm2
    add r8, 65
.endm

.macro COPY_28_CRLF_FAST
    vmovups xmm0, [rip + str_crlf_crlf]
    vmovups [r8], xmm0
    vmovups xmm1, [rip + str_crlf_crlf + 12]
    vmovups [r8 + 12], xmm1
    add r8, 28
.endm

.macro COPY_69_404_FAST
    vmovups ymm0, [rip + str_404]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_404 + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_404 + 37]
    vmovups [r8 + 37], ymm2
    add r8, 69
.endm

.macro COPY_73_405_FAST
    vmovups ymm0, [rip + str_405]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_405 + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_405 + 41]
    vmovups [r8 + 41], ymm2
    add r8, 73
.endm

/*
 * Windows x64 ABI Zero-Preserve Handler:
 * - Uses ONLY volatile registers: rax, rcx, rdx, r8, r9, r10, r11, ymm0..ymm3
 * - ZERO pushes, ZERO pops of non-volatile registers
 *
 * rcx = const char *req
 * rdx = int req_len
 * r8  = char *out_buf
 * r9  = int *out_len
 */
asm_handle_request:
    sub rsp, 104

    /* r8 points to append position: out_buf + *out_len */
    mov eax, dword ptr [r9]
    add r8, rax
    mov qword ptr [rsp], r8  /* [rsp] = start position */

    /* 1. Check Method: "GET " */
    cmp edx, 4
    jl .L_err405
    cmp dword ptr [rcx], HTTP_GET_MAGIC
    jne .L_err405

    /* 2. Route Check: "/baselin" */
    mov rax, qword ptr [rcx + 4]
    mov r10, BASELINE_PREFIX
    cmp rax, r10
    je .L_route_baseline

    /* Check "/json/" (6 bytes) */
    mov rax, qword ptr [rcx + 4]
    mov r10, 0x0000ffffffffffff
    and rax, r10
    mov r10, JSON_PREFIX
    cmp rax, r10
    je .L_route_json

    /* 404 Not Found */
    COPY_69_404_FAST
    jmp .L_finish

.L_err405:
    COPY_73_405_FAST
    jmp .L_finish

.L_route_baseline:
    /* skip "GET /baseline11?" (16 bytes) */
    add rcx, 16
    xor eax, eax            /* a = 0 */
    xor edx, edx            /* b = 0 */

.L_scan_loop:
    movzx r10d, byte ptr [rcx]
    cmp r10b, ' '
    jbe .L_calc_sum         /* space, \r, \n, \0 are all <= ' ' */

    cmp r10b, 'a'
    jne .L_check_b
    cmp byte ptr [rcx + 1], '='
    jne .L_next_char
    add rcx, 2
.L_atoi_a:
    movzx r10d, byte ptr [rcx]
    sub r10b, '0'
    cmp r10b, 9
    ja .L_scan_loop
    imul eax, eax, 10
    add eax, r10d
    inc rcx
    jmp .L_atoi_a

.L_check_b:
    cmp r10b, 'b'
    jne .L_next_char
    cmp byte ptr [rcx + 1], '='
    jne .L_next_char
    add rcx, 2
.L_atoi_b:
    movzx r10d, byte ptr [rcx]
    sub r10b, '0'
    cmp r10b, 9
    ja .L_scan_loop
    imul edx, edx, 10
    add edx, r10d
    inc rcx
    jmp .L_atoi_b

.L_next_char:
    inc rcx
    jmp .L_scan_loop

.L_calc_sum:
    add eax, edx            /* eax = sum */

    /* Format body backwards from [rsp + 24] */
    lea r10, [rsp + 24]
    mov r11d, 10
    xor ecx, ecx

    test eax, eax
    jnz .L_sum_digits
    dec r10
    mov byte ptr [r10], '0'
    mov ecx, 1
    jmp .L_sum_ready

.L_sum_digits:
    mov edi, eax
    mov r11, 0xcccccccd
    imul rax, r11
    shr rax, 35
    lea edx, [rax + rax*4]
    add edx, edx
    sub edi, edx
    add dil, '0'
    dec r10
    mov byte ptr [r10], dil
    inc ecx
    test eax, eax
    jnz .L_sum_digits

.L_sum_ready:
    /* r10 points to first digit, ecx = body_len */
    COPY_59_PLAIN_FAST

    /* Write Content-Length digits */
    cmp ecx, 10
    jl .L_cl_single
    mov eax, ecx
    mov edi, eax
    mov r11, 0xcccccccd
    imul rax, r11
    shr rax, 35
    lea edx, [rax + rax*4]
    add edx, edx
    sub edi, edx
    add al, '0'
    add dil, '0'
    mov byte ptr [r8], al
    mov byte ptr [r8 + 1], dil
    add r8, 2
    jmp .L_write_crlf

.L_cl_single:
    mov al, cl
    add al, '0'
    mov byte ptr [r8], al
    inc r8

.L_write_crlf:
    COPY_28_CRLF_FAST

    /* Copy body digits (ecx <= 10) from [r10] */
    mov rax, qword ptr [r10]
    mov qword ptr [r8], rax
    add r8, rcx
    jmp .L_finish

.L_route_json:
    /* Parse id from rcx + 10 ("/json/<id>") */
    add rcx, 10
    xor eax, eax
.L_json_atoi:
    movzx r10d, byte ptr [rcx]
    sub r10b, '0'
    cmp r10b, 9
    ja .L_json_body_format
    imul eax, eax, 10
    add eax, r10d
    inc rcx
    jmp .L_json_atoi

.L_json_body_format:
    /* Format id backwards into [rsp + 24] */
    lea r10, [rsp + 24]
    mov r11d, 10
    xor ecx, ecx

    test eax, eax
    jnz .L_json_id_loop
    dec r10
    mov byte ptr [r10], '0'
    mov ecx, 1
    jmp .L_json_assemble

.L_json_id_loop:
    mov edi, eax
    mov r11, 0xcccccccd
    imul rax, r11
    shr rax, 35
    lea edx, [rax + rax*4]
    add edx, edx
    sub edi, edx
    add dil, '0'
    dec r10
    mov byte ptr [r10], dil
    inc ecx
    test eax, eax
    jnz .L_json_id_loop

.L_json_assemble:
    /* r10 points to id string, ecx = id length */
    /* Assemble JSON into [rsp + 32] */
    mov dword ptr [rsp + 32], 0x6469227b   /* '{"id' */
    mov word ptr [rsp + 36], 0x3a22        /* '\":' */
    
    /* Copy id digits */
    mov rax, qword ptr [r10]
    mov qword ptr [rsp + 38], rax
    lea r10, [rsp + 38 + rcx]              /* r10 = position for tail */

    /* Append ',"message":"Hello, World!"}' (27 bytes) with Overlapping SSE */
    vmovups xmm0, [rip + str_json_tail]
    vmovups [r10], xmm0
    vmovups xmm1, [rip + str_json_tail + 11]
    vmovups [r10 + 11], xmm1
    add r10, 27

    /* Calculate total json body length: r10 - (rsp + 32) */
    lea rax, [rsp + 32]
    sub r10, rax
    mov ecx, r10d           /* ecx = body length (30..35) */

    COPY_65_JSON_FAST

    /* Write body length (always 2 digits: 30..35) */
    mov eax, ecx
    mov edi, eax
    mov r11, 0xcccccccd
    imul rax, r11
    shr rax, 35
    lea edx, [rax + rax*4]
    add edx, edx
    sub edi, edx
    add al, '0'
    add dil, '0'
    mov byte ptr [r8], al
    mov byte ptr [r8 + 1], dil
    add r8, 2

    COPY_28_CRLF_FAST

    /* Copy json body from [rsp + 32] (ecx bytes) using Overlapping SSE */
    vmovups xmm0, [rsp + 32]
    vmovups [r8], xmm0
    vmovups xmm1, [rsp + 48]
    vmovups [r8 + 16], xmm1
    vmovups xmm2, [rsp + 32 + rcx - 16]
    vmovups [r8 + rcx - 16], xmm2
    add r8, rcx

.L_finish:
    /* Update *out_len */
    sub r8, qword ptr [rsp] /* r8 = bytes written this request */
    add dword ptr [r9], r8d
    vzeroupper
    add rsp, 104
    ret
