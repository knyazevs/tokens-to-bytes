# Pure Assembly (x86-64 / AVX2 / epoll) HTTP Server for HttpArena

A 100% hand-crafted bare-metal x86-64 Linux HTTP web server written entirely in pure assembly (`.S`), utilizing direct Linux kernel `syscall`s, edge/level `epoll`, and `SO_REUSEPORT` hardware balancing.

## Architectural Highlights

- **Zero Libc / Zero CRT**: Does not link to `glibc`, `musl`, or any runtime. Boots directly from Linux kernel `_start`.
- **4.82 KB Container**: Multi-stage build into `FROM scratch`. Total image content size is just **4.82 KB**, the smallest in the entire benchmark.
- **Direct Linux Syscalls**: Direct invocations of `sys_socket(41)`, `sys_bind(49)`, `sys_listen(50)`, `sys_setsockopt(54)`, `sys_epoll_create1(291)`, `sys_epoll_ctl(233)`, `sys_epoll_wait(232)`, `sys_accept4(288)`, `sys_read(0)`, and `sys_write(1)`.
- **Multi-Core Scaling via `SO_REUSEPORT`**: Worker processes each bind their own listening socket on the same port; the Linux kernel's TCP 4-tuple hashing distributes incoming connections across all CPU cores with zero user-space locking or dispatch queues.
- **AVX-256 Vector HTTP Formatting**: HTTP headers and JSON envelopes are emitted in 2-3 vector instructions using overlapping 256-bit `vmovups` registers, bypassing loop counters and ERMS startup penalties.
- **Zero-Latency Fast Path**: Newly accepted connections are processed immediately on accept to eliminate initial epoll roundtrips.

## Endpoints Implemented

1. `GET /baseline11?a=...&b=...` -> HTTP 200 plain text sum
2. `GET /json/<id>` -> HTTP 200 `{"id":<id>,"message":"Hello, World!"}`
3. `POST /...` -> HTTP 405 Method Not Allowed
4. Unknown routes -> HTTP 404 Not Found
5. Malformed requests -> HTTP 400 Bad Request
6. HTTP/1.1 Keep-Alive & HTTP Pipelining support
