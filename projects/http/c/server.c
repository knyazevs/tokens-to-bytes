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

static int fast_atoi(const char *p, const char **end) {
    int val = 0;
    while (*p >= '0' && *p <= '9') {
        val = val * 10 + (*p - '0');
        p++;
    }
    if (end) *end = p;
    return val;
}

static int fast_itoa(int val, char *buf) {
    char temp[16];
    int i = 0;
    if (val == 0) {
        buf[0] = '0';
        return 1;
    }
    if (val < 0) {
        buf[0] = '-';
        return 1 + fast_itoa(-val, buf + 1);
    }
    while (val > 0) {
        temp[i++] = (char)('0' + (val % 10));
        val /= 10;
    }
    for (int j = 0; j < i; j++) {
        buf[j] = temp[i - 1 - j];
    }
    return i;
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

int main(int argc, char **argv) {
    int port = 8080;
    if (argc > 1) port = atoi(argv[1]);
    const char *env_port = getenv("PORT");
    if (env_port) port = atoi(env_port);

    WSADATA wsa;
    int err = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (err != 0) {
        printf("WSAStartup error: %d\n", err);
        return 1;
    }

    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) {
        printf("socket error: %d\n", WSAGetLastError());
        return 1;
    }

    int opt = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    struct sockaddr_in sin;
    memset(&sin, 0, sizeof(sin));
    sin.sin_family = AF_INET;
    sin.sin_addr.s_addr = htonl(INADDR_ANY);
    sin.sin_port = htons((u_short)port);

    if (bind(listener, (struct sockaddr*)&sin, sizeof(sin)) != 0) {
        printf("bind error: %d\n", WSAGetLastError());
        return 1;
    }
    if (listen(listener, 1024) != 0) {
        printf("listen error: %d\n", WSAGetLastError());
        return 1;
    }

    u_long mode = 1;
    ioctlsocket(listener, FIONBIO, &mode);

    for (int i = 0; i < MAX_CONNS; i++) conns[i].fd = INVALID_SOCKET;

    poll_fds[0].fd = listener;
    poll_fds[0].events = POLLIN;
    num_fds = 1;

    printf("Server listening on port %d...\n", port);
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
        if (ready < 0) {
            printf("WSAPoll error: %d\n", WSAGetLastError());
            break;
        }
        if (ready == 0) continue;

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
                            char *delim = strstr(conns[i].in_buf, "\r\n\r\n");
                            if (!delim) break;
                            int req_len = (int)(delim - conns[i].in_buf) + 4;
                            
                            if (req_len < 14 || (conns[i].in_buf[0] != 'G' && conns[i].in_buf[0] != 'P')) {
                                const char *err400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                send(conns[i].fd, err400, (int)strlen(err400), 0);
                                close_conn(i);
                                i--;
                                break;
                            }

                            // Temporarily null-terminate the request string for safe routing
                            char save = conns[i].in_buf[req_len];
                            conns[i].in_buf[req_len] = '\0';
                            handle_request(&conns[i], conns[i].in_buf, req_len);
                            conns[i].in_buf[req_len] = save;

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
