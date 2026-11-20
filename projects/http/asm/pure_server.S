.intel_syntax noprefix

#define MAX_CONNS 512
#define BUF_SIZE 8192

#define CONN_SZ        24640
#define OFF_FD         0
#define OFF_IN_LEN     8
#define OFF_OUT_LEN    12
#define OFF_OUT_SENT   16
#define OFF_IN_BUF     64
#define OFF_OUT_BUF    8256

#define POLLIN_EVENT   0x0300
#define POLLOUT_EVENT  0x0010
#define POLLERR_EVENT  0x0001
#define POLLHUP_EVENT  0x0002

#define HTTP_GET_MAGIC  0x20544547 /* "GET " */
#define BASELINE_PREFIX 0x6e696c657361622f /* "/baselin" */
#define JSON_PREFIX     0x00002f6e6f736a2f /* "/json/" */

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
str_400:
    .ascii "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
.space 64, 0

.section .bss,"dw"
.p2align 6
conns:
    .space (MAX_CONNS * CONN_SZ), 0
poll_fds:
    .space (MAX_CONNS * 16), 0
wsadata:
    .space 512, 0

.text
.globl main
.def main; .scl 2; .type 32; .endef

.macro FAST_DIV10
    mov r11d, 0xcccccccd
    mov edx, eax
    imul r11, rax
    shr r11, 35
    lea eax, [r11 + r11*4]
    add eax, eax
    sub edx, eax
    mov eax, r11d
.endm

main:
    sub rsp, 104
    cld

    mov esi, 8080

    cmp ecx, 1
    jle .L_init_wsa
    mov rax, qword ptr [rdx + 8]
    test rax, rax
    jz .L_init_wsa

    xor esi, esi
.L_atoi_port:
    movzx ecx, byte ptr [rax]
    sub cl, '0'
    cmp cl, 9
    ja .L_init_wsa
    imul esi, esi, 10
    movzx ecx, cl
    add esi, ecx
    inc rax
    jmp .L_atoi_port

.L_init_wsa:
    mov ecx, 0x0202
    lea rdx, [rip + wsadata]
    call WSAStartup
    test eax, eax
    jnz .L_exit_fail

    mov ecx, 2
    mov edx, 1
    mov r8d, 6
    call socket
    cmp rax, -1
    je .L_exit_fail
    mov r15, rax

    mov dword ptr [rsp + 40], 1
    mov rcx, r15
    mov edx, 0xffff
    mov r8d, 4
    lea r9, [rsp + 40]
    mov dword ptr [rsp + 32], 4
    call setsockopt

    mov word ptr [rsp + 56], 2
    mov eax, esi
    xchg al, ah
    mov word ptr [rsp + 58], ax
    mov dword ptr [rsp + 60], 0
    mov qword ptr [rsp + 64], 0

    mov rcx, r15
    lea rdx, [rsp + 56]
    mov r8d, 16
    call bind
    test eax, eax
    jnz .L_exit_fail

    mov rcx, r15
    mov edx, 1024
    call listen
    test eax, eax
    jnz .L_exit_fail

    mov dword ptr [rsp + 40], 1
    mov rcx, r15
    mov edx, 0x8004667e
    lea r8, [rsp + 40]
    call ioctlsocket

    lea r12, [rip + conns]
    lea r13, [rip + poll_fds]
    xor ecx, ecx
.L_init_conns:
    imul rax, rcx, CONN_SZ
    mov qword ptr [r12 + rax + OFF_FD], -1
    inc ecx
    cmp ecx, MAX_CONNS
    jl .L_init_conns

    mov qword ptr [r13 + 0], r15
    mov word ptr [r13 + 8], POLLIN_EVENT
    mov word ptr [r13 + 10], 0
    mov r14d, 1

/* ============================================================ */
/* MAIN EVENT LOOP                                              */
/* ============================================================ */
.L_event_loop:
    lea rbx, [r12 + CONN_SZ]
    lea rdi, [r13 + 16]
    mov ebp, 1

.L_prep_poll:
    cmp ebp, r14d
    jge .L_do_poll

    mov rax, qword ptr [rbx + OFF_FD]
    mov qword ptr [rdi + 0], rax
    mov word ptr [rdi + 8], POLLIN_EVENT
    mov word ptr [rdi + 10], 0

    mov eax, dword ptr [rbx + OFF_OUT_LEN]
    cmp eax, dword ptr [rbx + OFF_OUT_SENT]
    jle .L_prep_next
    or word ptr [rdi + 8], POLLOUT_EVENT

.L_prep_next:
    add rbx, CONN_SZ
    add rdi, 16
    inc ebp
    jmp .L_prep_poll

.L_do_poll:
    mov rcx, r13
    mov edx, r14d
    mov r8d, 100
    call WSAPoll
    test eax, eax
    jle .L_event_loop

    test word ptr [r13 + 10], POLLIN_EVENT
    jz .L_check_clients

.L_accept_clients:
    cmp r14d, MAX_CONNS
    jge .L_check_clients

    mov rcx, r15
    xor edx, edx
    xor r8d, r8d
    call accept
    cmp rax, -1
    je .L_check_clients
    mov rsi, rax

    mov dword ptr [rsp + 40], 1
    mov rcx, rsi
    mov edx, 0x8004667e
    lea r8, [rsp + 40]
    call ioctlsocket

    mov dword ptr [rsp + 44], 1
    mov rcx, rsi
    mov edx, 6
    mov r8d, 1
    lea r9, [rsp + 44]
    mov dword ptr [rsp + 32], 4
    call setsockopt

    imul rax, r14, CONN_SZ
    lea rbx, [r12 + rax]
    mov qword ptr [rbx + OFF_FD], rsi
    mov dword ptr [rbx + OFF_IN_LEN], 0
    mov dword ptr [rbx + OFF_OUT_LEN], 0
    mov dword ptr [rbx + OFF_OUT_SENT], 0

    mov rax, r14
    shl rax, 4
    lea rdi, [r13 + rax]
    mov qword ptr [rdi + 0], rsi
    mov word ptr [rdi + 8], POLLIN_EVENT
    mov word ptr [rdi + 10], 0

    inc r14d
    jmp .L_accept_clients

/* ============================================================ */
/* PROCESS CLIENT SOCKETS                                       */
/* ============================================================ */
.L_check_clients:
    lea rbx, [r12 + CONN_SZ]
    lea rdi, [r13 + 16]
    mov ebp, 1

.L_client_loop:
    cmp ebp, r14d
    jge .L_event_loop

    test word ptr [rdi + 10], (POLLERR_EVENT | POLLHUP_EVENT)
    jnz .L_close_and_retry

    test word ptr [rdi + 10], POLLOUT_EVENT
    jz .L_check_pollin

    mov r8d, dword ptr [rbx + OFF_OUT_LEN]
    sub r8d, dword ptr [rbx + OFF_OUT_SENT]
    jle .L_check_pollin

    mov rcx, qword ptr [rbx + OFF_FD]
    movsxd rdx, dword ptr [rbx + OFF_OUT_SENT]
    lea rdx, [rbx + OFF_OUT_BUF + rdx]
    xor r9d, r9d
    call send
    cmp eax, 0
    jle .L_send_check_err

    add dword ptr [rbx + OFF_OUT_SENT], eax
    mov edx, dword ptr [rbx + OFF_OUT_SENT]
    cmp edx, dword ptr [rbx + OFF_OUT_LEN]
    jl .L_check_pollin
    mov dword ptr [rbx + OFF_OUT_LEN], 0
    mov dword ptr [rbx + OFF_OUT_SENT], 0
    jmp .L_check_pollin

.L_send_check_err:
    call WSAGetLastError
    cmp eax, 10035
    je .L_check_pollin
    jmp .L_close_and_retry

.L_check_pollin:
    test word ptr [rdi + 10], POLLIN_EVENT
    jz .L_client_next

    mov r8d, (BUF_SIZE - 1)
    sub r8d, dword ptr [rbx + OFF_IN_LEN]
    jle .L_client_next

    mov rcx, qword ptr [rbx + OFF_FD]
    movsxd rdx, dword ptr [rbx + OFF_IN_LEN]
    lea rdx, [rbx + OFF_IN_BUF + rdx]
    xor r9d, r9d
    call recv
    cmp eax, 0
    jle .L_recv_check_err

    add dword ptr [rbx + OFF_IN_LEN], eax
    movsxd rdx, dword ptr [rbx + OFF_IN_LEN]
    mov byte ptr [rbx + OFF_IN_BUF + rdx], 0

.L_parse_req_loop:
    mov r8d, dword ptr [rbx + OFF_IN_LEN]
    cmp r8d, 4
    jl .L_req_loop_end

    lea rsi, [rbx + OFF_IN_BUF]
    xor edx, edx
    mov ecx, r8d
    sub ecx, 4
.L_search_crlf:
    cmp dword ptr [rsi + rdx], 0x0a0d0a0d
    je .L_found_crlf
    inc edx
    cmp edx, ecx
    jle .L_search_crlf
    jmp .L_req_loop_end

.L_found_crlf:
    lea r10d, [edx + 4]

    cmp r10d, 14
    jl .L_send_400
    mov al, byte ptr [rsi]
    cmp al, 'G'
    je .L_route_req
    cmp al, 'P'
    je .L_route_req

.L_send_400:
    mov rcx, qword ptr [rbx + OFF_FD]
    lea rdx, [rip + str_400]
    mov r8d, 70
    xor r9d, r9d
    call send
    jmp .L_close_and_retry

.L_route_req:
    movsxd rax, dword ptr [rbx + OFF_OUT_LEN]
    lea r8, [rbx + OFF_OUT_BUF + rax]
    mov qword ptr [rsp + 48], r8

    cmp dword ptr [rsi], HTTP_GET_MAGIC
    jne .L_emit_405

    mov rax, qword ptr [rsi + 4]
    mov r11, BASELINE_PREFIX
    cmp rax, r11
    je .L_exec_baseline

    mov rax, qword ptr [rsi + 4]
    mov r11, 0x0000ffffffffffff
    and rax, r11
    mov r11, JSON_PREFIX
    cmp rax, r11
    je .L_exec_json

    vmovups ymm0, [rip + str_404]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_404 + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_404 + 37]
    vmovups [r8 + 37], ymm2
    add r8, 69
    jmp .L_req_finished

.L_emit_405:
    vmovups ymm0, [rip + str_405]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_405 + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_405 + 41]
    vmovups [r8 + 41], ymm2
    add r8, 73
    jmp .L_req_finished

.L_exec_baseline:
    lea rcx, [rsi + 16]
    xor eax, eax
    xor edx, edx

.L_scan_params:
    movzx r11d, byte ptr [rcx]
    cmp r11b, ' '
    jbe .L_calc_baseline_sum

    cmp r11b, 'a'
    jne .L_check_param_b
    cmp byte ptr [rcx + 1], '='
    jne .L_skip_param_char
    add rcx, 2
.L_atoi_param_a:
    movzx r11d, byte ptr [rcx]
    sub r11b, '0'
    cmp r11b, 9
    ja .L_scan_params
    imul eax, eax, 10
    add eax, r11d
    inc rcx
    jmp .L_atoi_param_a

.L_check_param_b:
    cmp r11b, 'b'
    jne .L_skip_param_char
    cmp byte ptr [rcx + 1], '='
    jne .L_skip_param_char
    add rcx, 2
.L_atoi_param_b:
    movzx r11d, byte ptr [rcx]
    sub r11b, '0'
    cmp r11b, 9
    ja .L_scan_params
    imul edx, edx, 10
    add edx, r11d
    inc rcx
    jmp .L_atoi_param_b

.L_skip_param_char:
    inc rcx
    jmp .L_scan_params

.L_calc_baseline_sum:
    add eax, edx

    lea r9, [rsp + 24]
    xor ecx, ecx

    test eax, eax
    jnz .L_sum_digits_loop
    dec r9
    mov byte ptr [r9], '0'
    mov ecx, 1
    jmp .L_sum_ready

.L_sum_digits_loop:
    FAST_DIV10
    add dl, '0'
    dec r9
    mov byte ptr [r9], dl
    inc ecx
    test eax, eax
    jnz .L_sum_digits_loop

.L_sum_ready:
    vmovups ymm0, [rip + str_ok_plain]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_ok_plain + 27]
    vmovups [r8 + 27], ymm1
    add r8, 59

    cmp ecx, 10
    jl .L_cl_single_digit
    mov eax, ecx
    FAST_DIV10
    add al, '0'
    add dl, '0'
    mov byte ptr [r8], al
    mov byte ptr [r8 + 1], dl
    add r8, 2
    jmp .L_write_crlf_plain

.L_cl_single_digit:
    mov al, cl
    add al, '0'
    mov byte ptr [r8], al
    inc r8

.L_write_crlf_plain:
    vmovups xmm0, [rip + str_crlf_crlf]
    vmovups [r8], xmm0
    vmovups xmm1, [rip + str_crlf_crlf + 12]
    vmovups [r8 + 12], xmm1
    add r8, 28

    mov rax, qword ptr [r9]
    mov qword ptr [r8], rax
    add r8, rcx
    jmp .L_req_finished

.L_exec_json:
    lea rcx, [rsi + 10]
    xor eax, eax
.L_atoi_json_id:
    movzx r11d, byte ptr [rcx]
    sub r11b, '0'
    cmp r11b, 9
    ja .L_json_format_body
    imul eax, eax, 10
    add eax, r11d
    inc rcx
    jmp .L_atoi_json_id

.L_json_format_body:
    lea r9, [rsp + 24]
    xor ecx, ecx

    test eax, eax
    jnz .L_json_id_loop
    dec r9
    mov byte ptr [r9], '0'
    mov ecx, 1
    jmp .L_json_body_assembled

.L_json_id_loop:
    FAST_DIV10
    add dl, '0'
    dec r9
    mov byte ptr [r9], dl
    inc ecx
    test eax, eax
    jnz .L_json_id_loop

.L_json_body_assembled:
    mov dword ptr [rsp + 56], 0x6469227b
    mov word ptr [rsp + 60], 0x3a22

    mov rax, qword ptr [r9]
    mov qword ptr [rsp + 62], rax
    lea r9, [rsp + 62 + rcx]

    vmovups xmm0, [rip + str_json_tail]
    vmovups [r9], xmm0
    vmovups xmm1, [rip + str_json_tail + 11]
    vmovups [r9 + 11], xmm1
    add r9, 27

    lea rax, [rsp + 56]
    sub r9, rax
    mov ecx, r9d

    vmovups ymm0, [rip + str_ok_json]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_ok_json + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_ok_json + 33]
    vmovups [r8 + 33], ymm2
    add r8, 65

    mov eax, ecx
    FAST_DIV10
    add al, '0'
    add dl, '0'
    mov byte ptr [r8], al
    mov byte ptr [r8 + 1], dl
    add r8, 2

    vmovups xmm0, [rip + str_crlf_crlf]
    vmovups [r8], xmm0
    vmovups xmm1, [rip + str_crlf_crlf + 12]
    vmovups [r8 + 12], xmm1
    add r8, 28

    vmovups xmm0, [rsp + 56]
    vmovups [r8], xmm0
    vmovups xmm1, [rsp + 72]
    vmovups [r8 + 16], xmm1
    vmovups xmm2, [rsp + 56 + rcx - 16]
    vmovups [r8 + rcx - 16], xmm2
    add r8, rcx

.L_req_finished:
    sub r8, qword ptr [rsp + 48]
    add dword ptr [rbx + OFF_OUT_LEN], r8d
    vzeroupper

    mov ecx, dword ptr [rbx + OFF_IN_LEN]
    sub ecx, r10d
    test ecx, ecx
    jle .L_in_buf_consumed

    mov edx, ecx
    lea rdi, [rbx + OFF_IN_BUF]
    lea rsi, [rbx + OFF_IN_BUF + r10]
    rep movsb
    mov dword ptr [rbx + OFF_IN_LEN], edx
    mov byte ptr [rbx + OFF_IN_BUF + rdx], 0
    jmp .L_parse_req_loop

.L_in_buf_consumed:
    mov dword ptr [rbx + OFF_IN_LEN], 0
    mov byte ptr [rbx + OFF_IN_BUF], 0

.L_req_loop_end:
    mov r8d, dword ptr [rbx + OFF_OUT_LEN]
    sub r8d, dword ptr [rbx + OFF_OUT_SENT]
    jle .L_client_next

    mov rcx, qword ptr [rbx + OFF_FD]
    movsxd rdx, dword ptr [rbx + OFF_OUT_SENT]
    lea rdx, [rbx + OFF_OUT_BUF + rdx]
    xor r9d, r9d
    call send
    cmp eax, 0
    jle .L_client_next

    add dword ptr [rbx + OFF_OUT_SENT], eax
    mov edx, dword ptr [rbx + OFF_OUT_SENT]
    cmp edx, dword ptr [rbx + OFF_OUT_LEN]
    jl .L_client_next
    mov dword ptr [rbx + OFF_OUT_LEN], 0
    mov dword ptr [rbx + OFF_OUT_SENT], 0
    jmp .L_client_next

.L_recv_check_err:
    cmp eax, 0
    je .L_close_and_retry
    call WSAGetLastError
    cmp eax, 10035
    je .L_client_next
    jmp .L_close_and_retry

.L_close_and_retry:
    mov rcx, qword ptr [rbx + OFF_FD]
    cmp rcx, -1
    je .L_skip_closesocket
    call closesocket
    mov qword ptr [rbx + OFF_FD], -1

.L_skip_closesocket:
    lea eax, [r14d - 1]
    cmp ebp, eax
    je .L_drop_last

    imul rsi, rax, CONN_SZ
    add rsi, r12
    lea rdi, [rbx]
    mov ecx, (CONN_SZ / 8)
    rep movsq

    mov rax, r14
    dec rax
    shl rax, 4
    lea rsi, [r13 + rax]
    mov rax, rbp
    shl rax, 4
    lea rdi, [r13 + rax]
    mov rax, qword ptr [rsi + 0]
    mov qword ptr [rdi + 0], rax
    mov rax, qword ptr [rsi + 8]
    mov qword ptr [rdi + 8], rax

.L_drop_last:
    dec r14d
    /* re-check current slot without incrementing pointer */
    jmp .L_client_loop

.L_client_next:
    add rbx, CONN_SZ
    add rdi, 16
    inc ebp
    jmp .L_client_loop

.L_exit_fail:
    mov ecx, 1
    call ExitProcess
