/*
 * 100% Pure Bare-Metal x86-64 Linux HTTP Server (Zero Libc / Zero CRT)
 * 
 * Uses direct Linux x86-64 syscalls:
 *   sys_read(0), sys_write(1), sys_close(3), sys_socket(41), sys_bind(49),
 *   sys_listen(50), sys_setsockopt(54), sys_fork(57), sys_exit(60),
 *   sys_epoll_wait(232), sys_epoll_ctl(233), sys_accept4(288), sys_epoll_create1(291)
 *
 * Multi-core scaling via Linux kernel SO_REUSEPORT hardware balancing.
 * HTTP request parsing via AVX-256 overlapping vector stores and reciprocal math.
 */

.intel_syntax noprefix

/* Linux x86-64 Syscall Numbers */
#define SYS_READ 0
#define SYS_WRITE 1
#define SYS_CLOSE 3
#define SYS_POLL 7
#define SYS_SOCKET 41
#define SYS_CONNECT 42
#define SYS_ACCEPT 43
#define SYS_SENDTO 44
#define SYS_RECVFROM 45
#define SYS_BIND 49
#define SYS_LISTEN 50
#define SYS_SETSOCKOPT 54
#define SYS_FORK 57
#define SYS_EXIT 60
#define SYS_EPOLL_WAIT 232
#define SYS_EPOLL_CTL 233
#define SYS_ACCEPT4 288
#define SYS_EPOLL_CREATE1 291

/* Socket Constants */
#define AF_INET 2
#define SOCK_STREAM 1
#define SOL_SOCKET 1
#define SO_REUSEADDR 2
#define SO_REUSEPORT 15
#define IPPROTO_TCP 6
#define TCP_NODELAY 1
#define SOCK_NONBLOCK 0x800

/* Epoll Constants */
#define EPOLLIN 0x00000001
#define EPOLLOUT 0x00000004
#define EPOLLERR 0x00000008
#define EPOLLHUP 0x00000010
#define EPOLLET 0x80000000
#define EPOLL_CTL_ADD 1
#define EPOLL_CTL_DEL 2
#define EPOLL_CTL_MOD 3

#define MAX_EVENTS 64
#define MAX_CONNS 1024
#define BUF_SIZE 8192

#define OFF_FD 0
#define OFF_IN_LEN 8
#define OFF_OUT_LEN 12
#define OFF_OUT_SENT 16
#define OFF_IN_BUF 24
#define OFF_OUT_BUF 8216
#define CONN_SZ 24640

.section .rodata
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

.section .bss
.p2align 6
conns:
    .space (CONN_SZ * MAX_CONNS), 0
events:
    .space (12 * MAX_EVENTS), 0

.text
.globl _start

/*
 * AVX-256 Overlapping Vector Store Macros:
 * Copies headers in 2-3 instructions! Zero loops, 0 ERMS startup penalty.
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

.macro COPY_70_400_FAST
    vmovups ymm0, [rip + str_400]
    vmovups [r8], ymm0
    vmovups ymm1, [rip + str_400 + 32]
    vmovups [r8 + 32], ymm1
    vmovups ymm2, [rip + str_400 + 38]
    vmovups [r8 + 38], ymm2
    add r8, 70
.endm

/* Fast division by 10 without clobbering rbx/r10 */
.macro FAST_DIV10 reg
    mov eax, \reg
    xor edx, edx
    mov r11d, 10
    div r11d
    mov \reg, eax
.endm

_start:
    /* Read port from argv[1] if present, default 8080 (0x1f90 -> big-endian 0x901f) */
    mov r14w, 0x901f /* default 8080 */

    /* [rsp] = argc, [rsp + 8] = argv[0], [rsp + 16] = argv[1] */
    mov rax, [rsp]
    cmp rax, 1
    jle .L_fork_workers

    mov rsi, [rsp + 16] /* argv[1] */
    test rsi, rsi
    jz .L_fork_workers

    /* Simple atoi for port */
    xor eax, eax
.L_parse_port:
    movzx ecx, byte ptr [rsi]
    test cl, cl
    jz .L_port_parsed
    sub cl, '0'
    cmp cl, 9
    ja .L_port_parsed
    imul eax, eax, 10
    movzx ecx, cl
    add eax, ecx
    inc rsi
    jmp .L_parse_port

.L_port_parsed:
    test eax, eax
    jz .L_fork_workers
    /* Convert to network byte order (htons) */
    rol ax, 8
    mov r14w, ax

.L_fork_workers:
    /* Fork 6 worker processes for multi-core scaling */
    mov ecx, 5 /* 5 forks = 6 processes total */
.L_fork_loop:
    push rcx
    mov eax, SYS_FORK
    syscall
    test rax, rax
    jz .L_worker_start /* child process enters worker */
    pop rcx
    dec ecx
    jnz .L_fork_loop

.L_worker_start:
    /* Allocate 256 bytes on stack frame */
    sub rsp, 256

    /* Each worker process creates its own listening socket with SO_REUSEPORT */
    /* 1. socket(AF_INET, SOCK_STREAM, 0) */
    mov eax, SYS_SOCKET
    mov edi, AF_INET
    mov esi, SOCK_STREAM
    xor edx, edx
    syscall
    test eax, eax
    js .L_exit_fail
    mov r15d, eax /* r15d = listener fd */

    /* 2. setsockopt(listener, SOL_SOCKET, SO_REUSEPORT, &1, 4) */
    mov dword ptr [rsp + 32], 1
    mov eax, SYS_SETSOCKOPT
    mov edi, r15d
    mov esi, SOL_SOCKET
    mov edx, SO_REUSEPORT
    lea r10, [rsp + 32]
    mov r8d, 4
    syscall

    /* setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &1, 4) */
    mov eax, SYS_SETSOCKOPT
    mov edi, r15d
    mov esi, SOL_SOCKET
    mov edx, SO_REUSEADDR
    lea r10, [rsp + 32]
    mov r8d, 4
    syscall

    /* 3. bind(listener, &sockaddr_in, 16) */
    mov word ptr [rsp + 40], AF_INET
    mov word ptr [rsp + 42], r14w
    mov dword ptr [rsp + 44], 0 /* INADDR_ANY */
    mov qword ptr [rsp + 48], 0

    mov eax, SYS_BIND
    mov edi, r15d
    lea rsi, [rsp + 40]
    mov edx, 16
    syscall
    test eax, eax
    js .L_exit_fail

    /* 4. listen(listener, 4096) */
    mov eax, SYS_LISTEN
    mov edi, r15d
    mov esi, 4096
    syscall
    test eax, eax
    js .L_exit_fail

    /* 5. epoll_create1(0) */
    mov eax, SYS_EPOLL_CREATE1
    xor edi, edi
    syscall
    test eax, eax
    js .L_exit_fail
    mov r12d, eax /* r12d = epoll fd */

    /* 6. epoll_ctl(epfd, EPOLL_CTL_ADD, listener, &ev) */
    /* struct epoll_event is 12 bytes packed: events(4), data.fd(4), pad(4) */
    mov dword ptr [rsp + 64], EPOLLIN
    mov dword ptr [rsp + 68], -1 /* data.fd = -1 indicates listener */
    mov dword ptr [rsp + 72], 0

    mov eax, SYS_EPOLL_CTL
    mov edi, r12d
    mov esi, EPOLL_CTL_ADD
    mov edx, r15d
    lea r10, [rsp + 64]
    syscall
    test eax, eax
    js .L_exit_fail

    /* Main epoll event loop */
.L_event_loop:
    /* epoll_wait(epfd, events, MAX_EVENTS, -1) */
    mov eax, SYS_EPOLL_WAIT
    mov edi, r12d
    lea rsi, [rip + events]
    mov edx, MAX_EVENTS
    mov r10d, -1
    syscall
    test eax, eax
    jle .L_event_loop

    mov ebp, eax /* ebp = num_events */
    xor ebx, ebx /* ebx = event index (NEVER clobber ebx!) */

.L_process_events:
    cmp ebx, ebp
    jge .L_event_loop

    /* Each epoll_event is 12 bytes: index * 12 = (index * 3) * 4 */
    lea rax, [rbx + rbx * 2]
    shl rax, 2
    lea rsi, [rip + events]
    add rsi, rax

    mov r13d, [rsi]     /* r13d = revents (offset 0) */
    mov r14d, [rsi + 4]  /* r14d = data.fd (offset 4!) */

    cmp r14d, -1
    je .L_accept_loop

    /* Map client fd to connection struct */
    mov eax, r14d
    and eax, (MAX_CONNS - 1)
    imul rax, rax, CONN_SZ
    lea r14, [rip + conns]
    add r14, rax
    jmp .L_handle_client

    /* ─── Accept new clients on listener ─── */
.L_accept_loop:
    /* accept4(listener, NULL, NULL, SOCK_NONBLOCK) */
    mov eax, SYS_ACCEPT4
    mov edi, r15d
    xor esi, esi
    xor edx, edx
    mov r10d, SOCK_NONBLOCK
    syscall
    test eax, eax
    js .L_accept_done

    mov dword ptr [rsp + 24], eax /* save client_fd safely on stack */

    /* setsockopt(client, IPPROTO_TCP, TCP_NODELAY, &1, 4) */
    mov dword ptr [rsp + 32], 1
    mov eax, SYS_SETSOCKOPT
    mov edi, dword ptr [rsp + 24]
    mov esi, IPPROTO_TCP
    mov edx, TCP_NODELAY
    lea r10, [rsp + 32]
    mov r8d, 4
    syscall

    /* Allocate slot in conns array: simple fd modulo */
    mov eax, dword ptr [rsp + 24]
    and eax, (MAX_CONNS - 1)
    imul rax, rax, CONN_SZ
    lea r14, [rip + conns]
    add r14, rax

    mov edx, dword ptr [rsp + 24]
    mov qword ptr [r14 + OFF_FD], rdx
    mov dword ptr [r14 + OFF_IN_LEN], 0
    mov dword ptr [r14 + OFF_OUT_LEN], 0
    mov dword ptr [r14 + OFF_OUT_SENT], 0

    /* epoll_ctl(epfd, EPOLL_CTL_ADD, client_fd, &ev) */
    mov dword ptr [rsp + 64], EPOLLIN
    mov eax, dword ptr [rsp + 24]
    mov dword ptr [rsp + 68], eax /* data.fd = client_fd */
    mov dword ptr [rsp + 72], 0

    mov eax, SYS_EPOLL_CTL
    mov edi, r12d
    mov esi, EPOLL_CTL_ADD
    mov edx, dword ptr [rsp + 24]
    lea r10, [rsp + 64]
    syscall

    /* Zero-latency optimization: immediately read and handle first request! */
    xor r13d, r13d /* revents = 0 */
    jmp .L_read_client

.L_accept_done:
    inc ebx
    jmp .L_process_events

    /* ─── Handle Client I/O ─── */
.L_handle_client:
    /* r14 = pointer to connection struct */
    test r13d, (EPOLLERR | EPOLLHUP)
    jnz .L_close_conn

    /* Read incoming HTTP data */
.L_read_client:
    mov r8d, (BUF_SIZE - 1)
    sub r8d, dword ptr [r14 + OFF_IN_LEN]
    jle .L_parse_reqs

    mov eax, SYS_READ
    mov edi, dword ptr [r14 + OFF_FD]
    movsxd rsi, dword ptr [r14 + OFF_IN_LEN]
    lea rsi, [r14 + OFF_IN_BUF + rsi]
    mov edx, r8d
    syscall

    test eax, eax
    jle .L_read_check
    add dword ptr [r14 + OFF_IN_LEN], eax
    movsxd rsi, dword ptr [r14 + OFF_IN_LEN]
    mov byte ptr [r14 + OFF_IN_BUF + rsi], 0
    jmp .L_read_client

.L_read_check:
    cmp eax, 0
    je .L_close_conn

    /* Parse all complete requests in buffer (Pipelining) */
.L_parse_reqs:
    mov r8d, dword ptr [r14 + OFF_IN_LEN]
    cmp r8d, 4
    jl .L_send_client

    /* Find \r\n\r\n */
    lea rsi, [r14 + OFF_IN_BUF]
    xor edx, edx
    mov ecx, r8d
    sub ecx, 4
.L_search_crlf:
    cmp dword ptr [rsi + rdx], 0x0a0d0a0d
    je .L_found_crlf
    inc edx
    cmp edx, ecx
    jle .L_search_crlf
    jmp .L_send_client

.L_found_crlf:
    lea r10d, [edx + 4] /* r10d = req_len (preserved across response generation) */

    /* Process request */
    lea r8, [r14 + OFF_OUT_BUF]
    movsxd rax, dword ptr [r14 + OFF_OUT_LEN]
    add r8, rax
    mov qword ptr [rsp + 16], r8 /* start pos */

    /* Check Method */
    cmp dword ptr [rsi], 0x20544547 /* "GET " */
    je .L_check_routes

    cmp dword ptr [rsi], 0x54534f50 /* "POST" */
    je .L_err405

    /* Else 400 Bad Request */
.L_err400:
    COPY_70_400_FAST
    jmp .L_req_done

.L_err405:
    COPY_73_405_FAST
    jmp .L_req_done

.L_check_routes:
    /* Check "/baselin" */
    mov rax, qword ptr [rsi + 4]
    mov r11, 0x6e696c657361622f
    cmp rax, r11
    je .L_route_baseline

    /* Check "/json/" */
    mov rax, qword ptr [rsi + 4]
    mov r11, 0x0000ffffffffffff
    and rax, r11
    mov r11, 0x00002f6e6f736a2f
    cmp rax, r11
    je .L_route_json

    /* Route 404 */
    COPY_69_404_FAST
    jmp .L_req_done

.L_route_baseline:
    /* Parse a and b from /baseline11?a=...&b=... */
    lea rdi, [rsi + 16]
    xor eax, eax
    xor r9d, r9d
.L_parse_params:
    cmp byte ptr [rdi], ' '
    je .L_params_end
    cmp byte ptr [rdi], '\r'
    je .L_params_end
    cmp word ptr [rdi], 0x3d61 /* "a=" */
    je .L_get_a
    cmp word ptr [rdi], 0x3d62 /* "b=" */
    je .L_get_b
    inc rdi
    jmp .L_parse_params

.L_get_a:
    add rdi, 2
.L_read_a:
    movzx ecx, byte ptr [rdi]
    sub cl, '0'
    cmp cl, 9
    ja .L_check_delim
    imul eax, eax, 10
    movzx ecx, cl
    add eax, ecx
    inc rdi
    jmp .L_read_a

.L_get_b:
    add rdi, 2
.L_read_b:
    movzx ecx, byte ptr [rdi]
    sub cl, '0'
    cmp cl, 9
    ja .L_check_delim
    imul r9d, r9d, 10
    movzx ecx, cl
    add r9d, ecx
    inc rdi
    jmp .L_read_b

.L_check_delim:
    cmp byte ptr [rdi], '&'
    jne .L_params_end
    inc rdi
    jmp .L_parse_params

.L_params_end:
    add eax, r9d /* eax = sum */

    /* Copy 59-byte plain header */
    COPY_59_PLAIN_FAST

    /* Format body length and body */
    /* Format sum into stack backwards from [rsp + 120] */
    lea rdi, [rsp + 120]
    mov rcx, rdi
    mov r9d, eax
    test r9d, r9d
    jnz .L_b11_digits
    dec rcx
    mov byte ptr [rcx], '0'
    jmp .L_b11_write_cl

.L_b11_digits:
    test r9d, r9d
    jz .L_b11_write_cl
    FAST_DIV10 r9d
    add dl, '0'
    dec rcx
    mov byte ptr [rcx], dl
    jmp .L_b11_digits

.L_b11_write_cl:
    mov edx, edi
    sub edx, ecx /* edx = body length in bytes */

    /* Content-Length number */
    mov eax, edx
    xor edx, edx
    mov r11d, 10
    div r11d
    test al, al
    jz .L_b11_cl_1
    add al, '0'
    mov byte ptr [r8], al
    inc r8
.L_b11_cl_1:
    add dl, '0'
    mov byte ptr [r8], dl
    inc r8

    /* 28-byte CRLF + Connection: keep-alive */
    COPY_28_CRLF_FAST

    /* Copy body */
.L_b11_copy_body:
    cmp rcx, rdi
    jge .L_req_done
    mov al, byte ptr [rcx]
    mov byte ptr [r8], al
    inc rcx
    inc r8
    jmp .L_b11_copy_body

.L_route_json:
    /* Parse id from /json/<id> */
    lea rdi, [rsi + 10]
    xor eax, eax
.L_parse_id:
    movzx ecx, byte ptr [rdi]
    sub cl, '0'
    cmp cl, 9
    ja .L_id_done
    imul eax, eax, 10
    movzx ecx, cl
    add eax, ecx
    inc rdi
    jmp .L_parse_id

.L_id_done:
    COPY_65_JSON_FAST

    /* Format body into stack: {"id":<id>,"message":"Hello, World!"} */
    lea rdi, [rsp + 160]
    mov rcx, rdi

    /* Append tail */
    vmovups xmm0, [rip + str_json_tail]
    vmovups [rdi], xmm0
    vmovups xmm1, [rip + str_json_tail + 11]
    vmovups [rdi + 11], xmm1
    add rdi, 27

    /* Digits for ID */
    lea rcx, [rsp + 160]
    mov r9d, eax
    test r9d, r9d
    jnz .L_json_digits
    dec rcx
    mov byte ptr [rcx], '0'
    jmp .L_json_prefix

.L_json_digits:
    test r9d, r9d
    jz .L_json_prefix
    FAST_DIV10 r9d
    add dl, '0'
    dec rcx
    mov byte ptr [rcx], dl
    jmp .L_json_digits

.L_json_prefix:
    /* Prefix: {"id": (6 bytes) */
    sub rcx, 6
    mov dword ptr [rcx], 0x6469227b /* "{\"id" */
    mov word ptr [rcx + 4], 0x3a22   /* "\":" ('"' = 0x22, ':' = 0x3a -> 0x3a22) */

    mov edx, edi
    sub edx, ecx /* edx = total json body length */
    mov dword ptr [rsp + 8], edx

    /* Write Content-Length */
    mov eax, edx
    xor edx, edx
    mov r11d, 10
    div r11d
    test al, al
    jz .L_json_cl_1
    add al, '0'
    mov byte ptr [r8], al
    inc r8
.L_json_cl_1:
    add dl, '0'
    mov byte ptr [r8], dl
    inc r8

    COPY_28_CRLF_FAST

    /* Copy JSON body */
    mov edx, dword ptr [rsp + 8]
.L_copy_json_body:
    vmovups ymm0, [rcx]
    vmovups [r8], ymm0
    vmovups ymm1, [rcx + rdx - 32]
    vmovups [r8 + rdx - 32], ymm1
    add r8, rdx

.L_req_done:
    sub r8, qword ptr [rsp + 16]
    add dword ptr [r14 + OFF_OUT_LEN], r8d
    vzeroupper

    /* Shift pipelined input */
    mov ecx, dword ptr [r14 + OFF_IN_LEN]
    sub ecx, r10d
    jle .L_in_buf_empty

    mov edx, ecx
    lea rdi, [r14 + OFF_IN_BUF]
    lea rsi, [r14 + OFF_IN_BUF + r10]
    cld
    rep movsb
    mov dword ptr [r14 + OFF_IN_LEN], edx
    mov byte ptr [r14 + OFF_IN_BUF + rdx], 0
    jmp .L_parse_reqs

.L_in_buf_empty:
    mov dword ptr [r14 + OFF_IN_LEN], 0
    mov byte ptr [r14 + OFF_IN_BUF], 0

.L_send_client:
    /* Send generated HTTP response */
    mov r8d, dword ptr [r14 + OFF_OUT_LEN]
    sub r8d, dword ptr [r14 + OFF_OUT_SENT]
    jle .L_client_io_done

    mov eax, SYS_WRITE
    mov edi, dword ptr [r14 + OFF_FD]
    movsxd rsi, dword ptr [r14 + OFF_OUT_SENT]
    lea rsi, [r14 + OFF_OUT_BUF + rsi]
    mov edx, r8d
    syscall

    test eax, eax
    jle .L_client_io_done

    add dword ptr [r14 + OFF_OUT_SENT], eax
    mov edx, dword ptr [r14 + OFF_OUT_SENT]
    cmp edx, dword ptr [r14 + OFF_OUT_LEN]
    jl .L_client_io_done

    mov dword ptr [r14 + OFF_OUT_LEN], 0
    mov dword ptr [r14 + OFF_OUT_SENT], 0

.L_client_io_done:
    inc ebx
    jmp .L_process_events

.L_close_conn:
    mov eax, SYS_CLOSE
    mov edi, dword ptr [r14 + OFF_FD]
    syscall
    mov qword ptr [r14 + OFF_FD], -1
    inc ebx
    jmp .L_process_events

.L_exit_fail:
    mov eax, SYS_EXIT
    mov edi, 1
    syscall
