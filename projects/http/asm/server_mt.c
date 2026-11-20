#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <immintrin.h>

#define MAX_WORKERS 16
#define CONNS_PER_WORKER 256
#define BUF_SIZE 8192
#define QUEUE_SIZE 128

typedef struct {
    SOCKET fd;
    char in_buf[BUF_SIZE];
    int in_len;
    char out_buf[BUF_SIZE * 2];
    int out_len;
    int out_sent;
} Connection;

typedef struct {
    SOCKET queue[QUEUE_SIZE];
    volatile long q_head;
    volatile long q_tail;
    HANDLE event;
    int worker_id;
    int num_fds;
    WSAPOLLFD poll_fds[CONNS_PER_WORKER];
    Connection conns[CONNS_PER_WORKER];
} Worker;

static Worker workers[MAX_WORKERS];
static int num_workers = 6;

/* Macro-ASM kernel: returns new out_len in eax directly */
extern void asm_handle_request(const char *req, int req_len, char *out_buf, int *out_len);

static inline char *fast_find_crlf_crlf(char *buf, int len) {
    if (len < 4) return NULL;
    int limit = len - 4;
    for (int j = 0; j <= limit; j++) {
        if (*(const unsigned int*)(buf + j) == 0x0a0d0a0d) {
            return buf + j;
        }
    }
    return NULL;
}

static inline void fast_shift_buf(char *dst, const char *src, int len) {
    if (len <= 32) {
        __m256i v = _mm256_loadu_si256((const __m256i*)src);
        _mm256_storeu_si256((__m256i*)dst, v);
    } else if (len <= 64) {
        __m256i v0 = _mm256_loadu_si256((const __m256i*)src);
        __m256i v1 = _mm256_loadu_si256((const __m256i*)(src + len - 32));
        _mm256_storeu_si256((__m256i*)dst, v0);
        _mm256_storeu_si256((__m256i*)(dst + len - 32), v1);
    } else {
        memmove(dst, src, len);
    }
}

static void worker_close_conn(Worker *w, int idx) {
    if (w->conns[idx].fd != INVALID_SOCKET) {
        closesocket(w->conns[idx].fd);
        w->conns[idx].fd = INVALID_SOCKET;
    }
    int last = w->num_fds - 1;
    if (idx != last) {
        w->conns[idx] = w->conns[last];
        w->poll_fds[idx] = w->poll_fds[last];
    }
    w->num_fds--;
}

DWORD WINAPI worker_thread(LPVOID param) {
    Worker *w = (Worker*)param;
    
    // Pin worker to specific CPU core (P-cores 0..5)
    SetThreadAffinityMask(GetCurrentThread(), (DWORD_PTR)1 << w->worker_id);

    while (1) {
        // Drain incoming sockets from queue
        while (w->q_tail < w->q_head) {
            long tail = w->q_tail;
            SOCKET client = w->queue[tail % QUEUE_SIZE];
            MemoryBarrier();
            w->q_tail = tail + 1;

            if (w->num_fds < CONNS_PER_WORKER) {
                u_long mode = 1;
                ioctlsocket(client, FIONBIO, &mode);
                int flag = 1;
                setsockopt(client, IPPROTO_TCP, TCP_NODELAY, (const char*)&flag, sizeof(flag));

                int idx = w->num_fds++;
                w->conns[idx].fd = client;
                w->conns[idx].in_len = 0;
                w->conns[idx].out_len = 0;
                w->conns[idx].out_sent = 0;
                w->poll_fds[idx].fd = client;
                w->poll_fds[idx].events = POLLIN;
                w->poll_fds[idx].revents = 0;
            } else {
                closesocket(client);
            }
        }

        if (w->num_fds == 0) {
            WaitForSingleObject(w->event, 10);
            continue;
        }

        // Setup poll fds
        for (int i = 0; i < w->num_fds; i++) {
            w->poll_fds[i].events = POLLIN;
            if (w->conns[i].out_len > w->conns[i].out_sent) {
                w->poll_fds[i].events |= POLLOUT;
            }
        }

        int ready = WSAPoll(w->poll_fds, w->num_fds, 1);
        if (ready <= 0) continue;

        for (int i = 0; i < w->num_fds; i++) {
            if (w->poll_fds[i].revents & (POLLERR | POLLHUP)) {
                worker_close_conn(w, i);
                i--;
                continue;
            }

            if (w->poll_fds[i].revents & POLLOUT) {
                int to_send = w->conns[i].out_len - w->conns[i].out_sent;
                if (to_send > 0) {
                    int sent = send(w->conns[i].fd, w->conns[i].out_buf + w->conns[i].out_sent, to_send, 0);
                    if (sent > 0) {
                        w->conns[i].out_sent += sent;
                        if (w->conns[i].out_sent >= w->conns[i].out_len) {
                            w->conns[i].out_len = 0;
                            w->conns[i].out_sent = 0;
                        }
                    } else if (sent == SOCKET_ERROR && WSAGetLastError() != WSAEWOULDBLOCK) {
                        worker_close_conn(w, i);
                        i--;
                        continue;
                    }
                }
            }

            if (w->poll_fds[i].revents & POLLIN) {
                int space = BUF_SIZE - 1 - w->conns[i].in_len;
                if (space > 0) {
                    int recvd = recv(w->conns[i].fd, w->conns[i].in_buf + w->conns[i].in_len, space, 0);
                    if (recvd > 0) {
                        w->conns[i].in_len += recvd;
                        w->conns[i].in_buf[w->conns[i].in_len] = '\0';

                        while (1) {
                            char *delim = fast_find_crlf_crlf(w->conns[i].in_buf, w->conns[i].in_len);
                            if (!delim) break;
                            int req_len = (int)(delim - w->conns[i].in_buf) + 4;

                            if (req_len < 14 || (w->conns[i].in_buf[0] != 'G' && w->conns[i].in_buf[0] != 'P')) {
                                const char *err400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                send(w->conns[i].fd, err400, (int)strlen(err400), 0);
                                worker_close_conn(w, i);
                                i--;
                                break;
                            }

                            asm_handle_request(w->conns[i].in_buf, req_len, w->conns[i].out_buf, &w->conns[i].out_len);

                            int rest = w->conns[i].in_len - req_len;
                            if (rest > 0) {
                                fast_shift_buf(w->conns[i].in_buf, w->conns[i].in_buf + req_len, rest);
                                w->conns[i].in_len = rest;
                                w->conns[i].in_buf[rest] = '\0';
                            } else {
                                w->conns[i].in_len = 0;
                                w->conns[i].in_buf[0] = '\0';
                                break;
                            }
                        }

                        int to_send = w->conns[i].out_len - w->conns[i].out_sent;
                        if (to_send > 0) {
                            int sent = send(w->conns[i].fd, w->conns[i].out_buf + w->conns[i].out_sent, to_send, 0);
                            if (sent > 0) {
                                w->conns[i].out_sent += sent;
                                if (w->conns[i].out_sent >= w->conns[i].out_len) {
                                    w->conns[i].out_len = 0;
                                    w->conns[i].out_sent = 0;
                                }
                            }
                        }
                    } else if (recvd == 0 || (recvd == SOCKET_ERROR && WSAGetLastError() != WSAEWOULDBLOCK)) {
                        worker_close_conn(w, i);
                        i--;
                    }
                }
            }
        }
    }
    return 0;
}

int main(int argc, char **argv) {
    int port = 8080;
    if (argc > 1) port = atoi(argv[1]);
    const char *env_port = getenv("PORT");
    if (env_port) port = atoi(env_port);

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) return 1;

    int opt = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    struct sockaddr_in sin;
    memset(&sin, 0, sizeof(sin));
    sin.sin_family = AF_INET;
    sin.sin_addr.s_addr = htonl(INADDR_ANY);
    sin.sin_port = htons((u_short)port);

    if (bind(listener, (struct sockaddr*)&sin, sizeof(sin)) != 0) return 1;
    if (listen(listener, 4096) != 0) return 1;

    u_long mode = 1;
    ioctlsocket(listener, FIONBIO, &mode);

    // Initialize worker threads
    for (int i = 0; i < num_workers; i++) {
        workers[i].worker_id = i;
        workers[i].q_head = 0;
        workers[i].q_tail = 0;
        workers[i].num_fds = 0;
        workers[i].event = CreateEvent(NULL, FALSE, FALSE, NULL);
        CreateThread(NULL, 0, worker_thread, &workers[i], 0, NULL);
    }

    printf("Macro-ASM Multi-Core Server listening on port %d with %d P-core workers...\n", port, num_workers);
    fflush(stdout);

    int next_worker = 0;
    WSAPOLLFD l_pfd = { .fd = listener, .events = POLLIN, .revents = 0 };

    while (1) {
        int ready = WSAPoll(&l_pfd, 1, 100);
        if (ready <= 0) continue;

        if (l_pfd.revents & POLLIN) {
            while (1) {
                SOCKET client = accept(listener, NULL, NULL);
                if (client == INVALID_SOCKET) break;

                Worker *w = &workers[next_worker];
                next_worker = (next_worker + 1) % num_workers;

                long head = w->q_head;
                w->queue[head % QUEUE_SIZE] = client;
                MemoryBarrier();
                w->q_head = head + 1;
                SetEvent(w->event);
            }
        }
    }

    WSACleanup();
    return 0;
}
