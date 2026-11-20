#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

static inline char *fast_find_crlf_crlf(char *buf, int len) {
    if (len < 4) return NULL;
    for (int j = 0; j <= len - 4; j++) {
        if (*(unsigned int*)(buf + j) == 0x0a0d0a0d) {
            return buf + j;
        }
    }
    return NULL;
}

static inline int fast_atoi(const char *p, const char **end) {
    int v = 0;
    while (*p >= '0' && *p <= '9') {
        v = v * 10 + (*p - '0');
        p++;
    }
    if (end) *end = p;
    return v;
}

static inline int fast_itoa(int val, char *buf) {
    if (val == 0) {
        buf[0] = '0';
        return 1;
    }
    char temp[16];
    int i = 0;
    while (val > 0) {
        temp[i++] = (char)('0' + (val % 10));
        val /= 10;
    }
    for (int j = 0; j < i; j++) {
        buf[j] = temp[i - 1 - j];
    }
    return i;
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

static void handle_request(Connection *c, const char *req, int req_len) {
    if (req_len < 4 || *(unsigned int*)req != 0x20544547) { // "GET "
        const char *err405 = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        memcpy(c->out_buf + c->out_len, err405, strlen(err405));
        c->out_len += (int)strlen(err405);
        return;
    }

    const char *url = req + 4;
    if (strncmp(url, "/baseline11?", 12) == 0) {
        const char *p = url + 12;
        int a = 0, b = 0;
        while (*p && *p != ' ' && *p != '\r') {
            if (*p == 'a' && *(p+1) == '=') {
                a = fast_atoi(p + 2, &p);
            } else if (*p == 'b' && *(p+1) == '=') {
                b = fast_atoi(p + 2, &p);
            } else {
                p++;
            }
        }
        int sum = a + b;
        char body[16];
        int body_len = fast_itoa(sum, body);

        char header[128];
        int h_len = sprintf(header,
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: keep-alive\r\n\r\n",
            body_len);
        
        memcpy(c->out_buf + c->out_len, header, h_len);
        c->out_len += h_len;
        memcpy(c->out_buf + c->out_len, body, body_len);
        c->out_len += body_len;
    } else if (strncmp(url, "/json/", 6) == 0) {
        const char *p = url + 6;
        int id = fast_atoi(p, NULL);

        char body[128];
        int body_len = sprintf(body, "{\"id\":%d,\"message\":\"Hello, World!\"}", id);

        char header[128];
        int h_len = sprintf(header,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: keep-alive\r\n\r\n",
            body_len);

        memcpy(c->out_buf + c->out_len, header, h_len);
        c->out_len += h_len;
        memcpy(c->out_buf + c->out_len, body, body_len);
        c->out_len += body_len;
    } else {
        const char *err404 = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";
        memcpy(c->out_buf + c->out_len, err404, strlen(err404));
        c->out_len += (int)strlen(err404);
    }
}

DWORD WINAPI worker_thread(LPVOID param) {
    Worker *w = (Worker*)param;
    SetThreadAffinityMask(GetCurrentThread(), (DWORD_PTR)1 << w->worker_id);

    while (1) {
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

        for (int i = 0; i < w->num_fds; i++) {
            w->poll_fds[i].events = POLLIN;
            if (w->conns[i].out_len > w->conns[i].out_sent) {
                w->poll_fds[i].events |= POLLOUT;
            }
        }

        int ready = WSAPoll(w->poll_fds, w->num_fds, 5);
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

                            handle_request(&w->conns[i], w->conns[i].in_buf, req_len);

                            int rest = w->conns[i].in_len - req_len;
                            if (rest > 0) {
                                memmove(w->conns[i].in_buf, w->conns[i].in_buf + req_len, rest);
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

    const char *env_workers = getenv("WORKERS");
    if (env_workers) num_workers = atoi(env_workers);
    if (num_workers < 1) num_workers = 1;
    if (num_workers > MAX_WORKERS) num_workers = MAX_WORKERS;

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
    if (listen(listener, 1024) != 0) return 1;

    for (int w = 0; w < num_workers; w++) {
        workers[w].worker_id = w;
        workers[w].num_fds = 0;
        workers[w].q_head = 0;
        workers[w].q_tail = 0;
        workers[w].event = CreateEvent(NULL, FALSE, FALSE, NULL);
        for (int c = 0; c < CONNS_PER_WORKER; c++) {
            workers[w].conns[c].fd = INVALID_SOCKET;
        }
        CreateThread(NULL, 0, worker_thread, &workers[w], 0, NULL);
    }

    printf("C Multi-Core Server (%d workers) listening on port %d...\n", num_workers, port);
    fflush(stdout);

    int round_robin = 0;
    while (1) {
        SOCKET client = accept(listener, NULL, NULL);
        if (client == INVALID_SOCKET) continue;

        int target = round_robin++ % num_workers;
        Worker *w = &workers[target];

        long head = w->q_head;
        w->queue[head % QUEUE_SIZE] = client;
        MemoryBarrier();
        w->q_head = head + 1;
        SetEvent(w->event);
    }

    WSACleanup();
    return 0;
}
