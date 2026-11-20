# Task Specification: Bare-Metal Linux x86-64 HTTP Engine

You are tasked with engineering a high-throughput, bare-metal HTTP web server written in 100% pure assembly (`.S`) or Macro-ASM for Linux x86-64.

---

## 1. Operating System & Runtime Constraints
- **Zero Libc / Zero CRT:** You must NOT link against `libc`, `musl`, or any C runtime library. Entry point must be `_start`.
- **Direct Linux Syscalls:** Use direct `syscall` instructions (`sys_socket: 41`, `sys_bind: 49`, `sys_listen: 50`, `sys_setsockopt: 54`, `sys_epoll_create1: 291`, `sys_epoll_ctl: 233`, `sys_epoll_wait: 232`, `sys_accept4: 288`, `sys_read: 0`, `sys_write: 1`, `sys_fork: 57`, `sys_exit: 60`).
- **Compilation Contract:** Must compile cleanly via:
  ```bash
  gcc -nostdlib -static -O3 -march=native server.S -o server && strip --strip-all server
  ```
- **CLI Arguments:** Port number is passed in `argv[1]` as an ASCII string. If omitted, default to port 8080.

---

## 2. API Contract & RFC Endpoints

Your server must pass 100% of the verification test suite (`builds/test-http.mjs`):

1. **`GET /baseline11?a=13&b=42 HTTP/1.1`**
   - Returns: `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n55`
   - Dynamically parses query string parameters `a` and `b`, sums them, and formats the decimal sum.
2. **`GET /json/50 HTTP/1.1`**
   - Returns: `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 36\r\nConnection: keep-alive\r\n\r\n{"id":50,"message":"Hello, World!"}`
   - Formats the JSON envelope embedding the integer `:id`.
3. **`POST /baseline11 HTTP/1.1`**
   - Returns: `HTTP/1.1 405 Method Not Allowed` (or `400 Bad Request`).
4. **Unknown Routes (e.g. `GET /nonexistent`)**
   - Returns: `HTTP/1.1 404 Not Found`.
5. **Malformed Requests**
   - Returns: `HTTP/1.1 400 Bad Request`.
6. **HTTP/1.1 Keep-Alive & Pipelining**
   - Keep connections open for sequential requests.
   - Accurately process pipelined requests batched in a single TCP receive buffer.

---

## 3. Mandatory Hardware Invariants (Macro-ASM Synthesis Skill)

1. **Zero-Spill Registers:** All hot loop state must reside in physical registers (`rax`, `rcx`, `rdx`, `rsi`, `rdi`, `r8`–`r15`). Do NOT spill variables to stack.
2. **No Hardware Division (`div`/`idiv`):** For formatting ASCII numbers, use Lemire/Granlund multiplicative reduction (`imul` with `0xcccccccd; shr rax, 35`).
3. **AVX2 Vectorization:** HTTP headers and JSON bodies must be formatted using 256-bit AVX2 vector instructions (`vmovups [dst], ymmX`).
4. **Linux `struct epoll_event` Packing:** On Linux x86-64, `struct epoll_event` is packed (`__packed__`, strictly **12 bytes**, data offset **+4 bytes**).
5. **Zero-Latency Accept Path:** In edge-triggered non-blocking I/O (`EPOLLET`), perform an immediate synchronous read/respond on accept before waiting for `epoll_wait`.
6. **Multi-Core Scaling:** Fork worker processes bound to listening sockets with `SO_REUSEPORT` enabled.

---

## 4. Parity Target
- **Functional Correctness:** 8 / 8 tests passed (100%).
- **Binary Footprint:** $\le$ 10,000 bytes.
- **Throughput:** $\ge$ 135,000 req/s.
- **Tail Latency:** p99 $\le$ 2.0 ms.

Produce only the complete, compilable assembly code enclosed in ````assembly ... ````.
