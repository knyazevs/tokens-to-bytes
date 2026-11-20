#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CONNS 512
#define BUF_SIZE 8192

typedef struct {
    SOCKET fd;
    char in_buf[BUF_SIZE];
    int in_len;
    char out_buf[BUF_SIZE * 2];
    int out_len;
    int out_sent;
} Connection;

static Connection conns[MAX_CONNS];
static WSAPOLLFD poll_fds[MAX_CONNS];
static int num_fds = 0;

/* Macro-ASM kernel */
extern void asm_handle_request(const char *req, int req_len, char *out_buf, int *out_len);

static inline char *fast_find_crlf_crlf(char *buf, int len) {
    if (len < 4) return NULL;
    for (int j = 0; j <= len - 4; j++) {
        if (*(unsigned int*)(buf + j) == 0x0a0d0a0d) {
            return buf + j;
        }
    }
    return NULL;
}

static void close_conn(int idx) {
    if (conns[idx].fd != INVALID_SOCKET) {
        closesocket(conns[idx].fd);
        conns[idx].fd = INVALID_SOCKET;
    }
    int last = num_fds - 1;
    if (idx != last) {
        conns[idx] = conns[last];
        poll_fds[idx] = poll_fds[last];
    }
    num_fds--;
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
    if (listen(listener, 1024) != 0) return 1;

    u_long mode = 1;
    ioctlsocket(listener, FIONBIO, &mode);

    for (int i = 0; i < MAX_CONNS; i++) conns[i].fd = INVALID_SOCKET;

    poll_fds[0].fd = listener;
    poll_fds[0].events = POLLIN;
    num_fds = 1;

    printf("Macro-ASM Server listening on port %d...\n", port);
    fflush(stdout);

    while (1) {
        for (int i = 1; i < num_fds; i++) {
            poll_fds[i].fd = conns[i].fd;
            poll_fds[i].events = POLLIN;
            if (conns[i].out_len > conns[i].out_sent) {
                poll_fds[i].events |= POLLOUT;
            }
        }

        int ready = WSAPoll(poll_fds, num_fds, 100);
        if (ready <= 0) continue;

        if (poll_fds[0].revents & POLLIN) {
            while (num_fds < MAX_CONNS) {
                SOCKET client = accept(listener, NULL, NULL);
                if (client == INVALID_SOCKET) break;
                u_long client_mode = 1;
                ioctlsocket(client, FIONBIO, &client_mode);
                int flag = 1;
                setsockopt(client, IPPROTO_TCP, TCP_NODELAY, (const char*)&flag, sizeof(flag));

                int idx = num_fds++;
                conns[idx].fd = client;
                conns[idx].in_len = 0;
                conns[idx].out_len = 0;
                conns[idx].out_sent = 0;
            }
        }

        for (int i = 1; i < num_fds; i++) {
            if (poll_fds[i].revents & POLLOUT) {
                int to_send = conns[i].out_len - conns[i].out_sent;
                if (to_send > 0) {
                    int sent = send(conns[i].fd, conns[i].out_buf + conns[i].out_sent, to_send, 0);
                    if (sent > 0) {
                        conns[i].out_sent += sent;
                        if (conns[i].out_sent >= conns[i].out_len) {
                            conns[i].out_len = 0;
                            conns[i].out_sent = 0;
                        }
                    } else if (sent == SOCKET_ERROR && WSAGetLastError() != WSAEWOULDBLOCK) {
                        close_conn(i);
                        i--;
                        continue;
                    }
                }
            }

            if (poll_fds[i].revents & POLLIN) {
                int space = BUF_SIZE - 1 - conns[i].in_len;
                if (space > 0) {
                    int recvd = recv(conns[i].fd, conns[i].in_buf + conns[i].in_len, space, 0);
                    if (recvd > 0) {
                        conns[i].in_len += recvd;
                        conns[i].in_buf[conns[i].in_len] = '\0';

                        while (1) {
                            char *delim = fast_find_crlf_crlf(conns[i].in_buf, conns[i].in_len);
                            if (!delim) break;
                            int req_len = (int)(delim - conns[i].in_buf) + 4;
                            
                            if (req_len < 14 || (conns[i].in_buf[0] != 'G' && conns[i].in_buf[0] != 'P')) {
                                const char *err400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                send(conns[i].fd, err400, (int)strlen(err400), 0);
                                close_conn(i);
                                i--;
                                break;
                            }

                            /* Zero-copy, non-destructive parsing */
                            asm_handle_request(conns[i].in_buf, req_len, conns[i].out_buf, &conns[i].out_len);

                            int rest = conns[i].in_len - req_len;
                            if (rest > 0) {
                                memmove(conns[i].in_buf, conns[i].in_buf + req_len, rest);
                            }
                            conns[i].in_len = rest;
                            conns[i].in_buf[conns[i].in_len] = '\0';
                        }

                        if (i < num_fds && conns[i].out_len > conns[i].out_sent) {
                            int to_send = conns[i].out_len - conns[i].out_sent;
                            int sent = send(conns[i].fd, conns[i].out_buf + conns[i].out_sent, to_send, 0);
                            if (sent > 0) {
                                conns[i].out_sent += sent;
                                if (conns[i].out_sent >= conns[i].out_len) {
                                    conns[i].out_len = 0;
                                    conns[i].out_sent = 0;
                                }
                            }
                        }
                    } else if (recvd == 0 || (recvd == SOCKET_ERROR && WSAGetLastError() != WSAEWOULDBLOCK)) {
                        close_conn(i);
                        i--;
                    }
                }
            } else if (poll_fds[i].revents & (POLLERR | POLLHUP)) {
                close_conn(i);
                i--;
            }
        }
    }

    WSACleanup();
    return 0;
}
