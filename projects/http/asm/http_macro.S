.intel_syntax noprefix

#define HTTP_GET_MAGIC 0x20544547 /* "GET " */
#define BASELINE_PREFIX 0x6e696c657361622f /* "/baselin" */
#define JSON_PREFIX 0x00002f6e6f736a2f /* "/json/" */

#define LEN_OK_PLAIN 59
#define LEN_OK_JSON 65
#define LEN_CRLF_CRLF 28
#define LEN_404 69
#define LEN_405 73

.section .rdata,"dr"
.p2align 4
str_ok_plain:
    .ascii "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: "
str_ok_json:
    .ascii "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
str_crlf_crlf:
    .ascii "\r\nConnection: keep-alive\r\n\r\n"
str_404:
    .ascii "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n"
str_405:
    .ascii "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"

.text
.globl asm_handle_request
.def asm_handle_request; .scl 2; .type 32; .endef

/*
 * Windows x64 ABI:
 * rcx = const char *req
 * rdx = int req_len
 * r8  = char *out_buf
 * r9  = int *out_len
 */
asm_handle_request:
    push rbx
    push rsi
    push rdi
    push r12
    push r13
    push r14
    push r15
    sub rsp, 136

    cld

    mov rsi, rcx
    mov rbx, r8
    mov r12, r9
    movsxd r13, dword ptr [r12]
    lea rdi, [rbx + r13]

    /* 1. Check Method: "GET " */
    cmp edx, 4
    jl .L_err405
    cmp dword ptr [rsi], HTTP_GET_MAGIC
    jne .L_err405

    /* 2. Routing */
    mov rax, qword ptr [rsi + 4]
    mov r10, BASELINE_PREFIX
    cmp rax, r10
    je .L_route_baseline

    /* Check "/json/" (6 bytes) */
    mov rax, qword ptr [rsi + 4]
    mov r11, 0x0000ffffffffffff
    and rax, r11
    mov r10, JSON_PREFIX
    cmp rax, r10
    je .L_route_json

    /* 404 Not Found */
    lea rsi, [rip + str_404]
    mov ecx, LEN_404
    rep movsb
    add r13d, LEN_404
    mov dword ptr [r12], r13d
    jmp .L_done

.L_err405:
    lea rsi, [rip + str_405]
    mov ecx, LEN_405
    rep movsb
    add r13d, LEN_405
    mov dword ptr [r12], r13d
    jmp .L_done

.L_route_baseline:
    lea rsi, [rsi + 16] /* skip "GET /baseline11?" */
    xor eax, eax        /* a = 0 */
    xor edx, edx        /* b = 0 */

.L_scan_loop:
    movzx ecx, byte ptr [rsi]
    cmp cl, ' '
    je .L_calc_sum
    cmp cl, '\r'
    je .L_calc_sum
    test cl, cl
    jz .L_calc_sum

    cmp cl, 'a'
    jne .L_check_b
    cmp byte ptr [rsi + 1], '='
    jne .L_next_char
    add rsi, 2
.L_atoi_a:
    movzx ecx, byte ptr [rsi]
    sub cl, '0'
    cmp cl, 9
    ja .L_scan_loop
    imul eax, eax, 10
    movzx ecx, cl
    add eax, ecx
    inc rsi
    jmp .L_atoi_a

.L_check_b:
    cmp cl, 'b'
    jne .L_next_char
    cmp byte ptr [rsi + 1], '='
    jne .L_next_char
    add rsi, 2
.L_atoi_b:
    movzx ecx, byte ptr [rsi]
    sub cl, '0'
    cmp cl, 9
    ja .L_scan_loop
    imul edx, edx, 10
    movzx ecx, cl
    add edx, ecx
    inc rsi
    jmp .L_atoi_b

.L_next_char:
    inc rsi
    jmp .L_scan_loop

.L_calc_sum:
    add eax, edx        /* eax = sum */
    
    /* Format body in [rsp + 32] */
    lea rsi, [rsp + 32]
    mov r8d, eax
    xor ecx, ecx

    test r8d, r8d
    jnz .L_body_digits
    mov byte ptr [rsi], '0'
    mov ecx, 1
    jmp .L_body_ready

.L_body_digits:
    mov eax, r8d
    mov r10d, 10
.L_digit_loop:
    xor edx, edx
    div r10d
    add dl, '0'
    mov byte ptr [rsi + rcx], dl
    inc ecx
    test eax, eax
    jnz .L_digit_loop

    /* Reverse digits */
    xor edx, edx
    lea r11, [rcx - 1]
.L_rev_loop:
    cmp edx, r11d
    jge .L_body_ready
    mov al, byte ptr [rsi + rdx]
    mov r10b, byte ptr [rsi + r11]
    mov byte ptr [rsi + rdx], r10b
    mov byte ptr [rsi + r11], al
    inc edx
    dec r11d
    jmp .L_rev_loop

.L_body_ready:
    mov r14d, ecx       /* r14d = body_len */

    /* Copy str_ok_plain */
    lea rsi, [rip + str_ok_plain]
    mov ecx, LEN_OK_PLAIN
    rep movsb
    add r13d, LEN_OK_PLAIN

    /* Write body_len digits */
    cmp r14d, 10
    jl .L_len_single
    mov eax, r14d
    xor edx, edx
    mov r10d, 10
    div r10d
    add al, '0'
    add dl, '0'
    mov byte ptr [rdi], al
    mov byte ptr [rdi + 1], dl
    add rdi, 2
    add r13d, 2
    jmp .L_write_headers_end

.L_len_single:
    mov al, r14b
    add al, '0'
    mov byte ptr [rdi], al
    inc rdi
    inc r13d

.L_write_headers_end:
    lea rsi, [rip + str_crlf_crlf]
    mov ecx, LEN_CRLF_CRLF
    rep movsb
    add r13d, LEN_CRLF_CRLF

    /* Copy body */
    mov ecx, r14d
    lea rsi, [rsp + 32]
    rep movsb
    add r13d, r14d

    mov dword ptr [r12], r13d
    jmp .L_done

.L_route_json:
    /* Parse id from rsi + 10 ("/json/<id>") */
    lea rsi, [rsi + 10]
    xor eax, eax
.L_json_atoi:
    movzx ecx, byte ptr [rsi]
    sub cl, '0'
    cmp cl, 9
    ja .L_json_body_format
    imul eax, eax, 10
    movzx ecx, cl
    add eax, ecx
    inc rsi
    jmp .L_json_atoi

.L_json_body_format:
    /* eax = id. Format body in [rsp + 64] using r11 as pointer */
    lea r11, [rsp + 64]
    mov dword ptr [r11], 0x6469227b   /* '{"id' */
    mov word ptr [r11 + 4], 0x3a22    /* '":' */
    add r11, 6

    mov r8d, eax
    test r8d, r8d
    jnz .L_json_id_digits
    mov byte ptr [r11], '0'
    inc r11
    jmp .L_json_tail

.L_json_id_digits:
    mov eax, r8d
    mov r10d, 10
    lea rsi, [rsp + 100]
    xor ecx, ecx
.L_json_d_loop:
    xor edx, edx
    div r10d
    add dl, '0'
    mov byte ptr [rsi + rcx], dl
    inc ecx
    test eax, eax
    jnz .L_json_d_loop

    /* Copy reversed digits into r11 */
.L_json_rev_copy:
    dec ecx
    mov al, byte ptr [rsi + rcx]
    mov byte ptr [r11], al
    inc r11
    test ecx, ecx
    jnz .L_json_rev_copy

.L_json_tail:
    /* Tail: ',"message":"Hello, World!"}' (27 bytes) */
    mov dword ptr [r11], 0x656d222c   /* ',"me' */
    mov dword ptr [r11 + 4], 0x67617373 /* 'ssag' */
    mov dword ptr [r11 + 8], 0x223a2265 /* 'e":"' */
    mov dword ptr [r11 + 12], 0x6c6c6548 /* 'Hell' */
    mov dword ptr [r11 + 16], 0x57202c6f /* 'o, W' */
    mov dword ptr [r11 + 20], 0x646c726f /* 'orld' */
    mov word ptr [r11 + 24], 0x2221      /* '!"' */
    mov byte ptr [r11 + 26], 0x7d       /* '}' */
    add r11, 27

    lea rax, [rsp + 64]
    sub r11, rax
    mov r15d, r11d       /* r15d = json body len */

    /* Copy str_ok_json */
    lea rsi, [rip + str_ok_json]
    mov ecx, LEN_OK_JSON
    rep movsb
    add r13d, LEN_OK_JSON

    /* Write body length (typically 32-35) */
    mov eax, r15d
    xor edx, edx
    mov ecx, 10
    div ecx
    add al, '0'
    add dl, '0'
    mov byte ptr [rdi], al
    mov byte ptr [rdi + 1], dl
    add rdi, 2
    add r13d, 2

    lea rsi, [rip + str_crlf_crlf]
    mov ecx, LEN_CRLF_CRLF
    rep movsb
    add r13d, LEN_CRLF_CRLF

    /* Copy json body */
    mov ecx, r15d
    lea rsi, [rsp + 64]
    rep movsb
    add r13d, r15d
    mov dword ptr [r12], r13d

.L_done:
    add rsp, 136
    pop r15
    pop r14
    pop r13
    pop r12
    pop rdi
    pop rsi
    pop rbx
    ret
