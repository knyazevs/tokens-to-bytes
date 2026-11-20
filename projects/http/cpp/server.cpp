#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string_view>
#include <charconv>

constexpr int MAX_CONNS = 512;
constexpr int BUF_SIZE = 8192;

struct Connection {
    SOCKET fd{INVALID_SOCKET};
    char in_buf[BUF_SIZE]{};
    int in_len{0};
    char out_buf[BUF_SIZE * 2]{};
    int out_len{0};
    int out_sent{0};
};

static Connection conns[MAX_CONNS];
static WSAPOLLFD poll_fds[MAX_CONNS];
static int num_fds = 0;

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

static void handle_request(Connection &c, std::string_view req) {
    if (!req.starts_with("GET ")) {
        constexpr std::string_view err405 = "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        std::memcpy(c.out_buf + c.out_len, err405.data(), err405.size());
        c.out_len += static_cast<int>(err405.size());
        return;
    }

    std::string_view url = req.substr(4);
    if (url.starts_with("/baseline11?")) {
        std::string_view params = url.substr(12);
        int a = 0, b = 0;
        size_t space_pos = params.find(' ');
        if (space_pos != std::string_view::npos) params = params.substr(0, space_pos);

        size_t a_pos = params.find("a=");
        if (a_pos != std::string_view::npos) {
            std::from_chars(params.data() + a_pos + 2, params.data() + params.size(), a);
        }
        size_t b_pos = params.find("b=");
        if (b_pos != std::string_view::npos) {
            std::from_chars(params.data() + b_pos + 2, params.data() + params.size(), b);
        }

        int sum = a + b;
        char body[16];
        auto [ptr, ec] = std::to_chars(body, body + sizeof(body), sum);
        int body_len = static_cast<int>(ptr - body);

        char header[128];
        int h_len = std::snprintf(header, sizeof(header),
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: keep-alive\r\n\r\n",
            body_len);

        std::memcpy(c.out_buf + c.out_len, header, h_len);
        c.out_len += h_len;
        std::memcpy(c.out_buf + c.out_len, body, body_len);
        c.out_len += body_len;
    } else if (url.starts_with("/json/")) {
        int id = 0;
        std::from_chars(url.data() + 6, url.data() + url.size(), id);

        char body[128];
        int body_len = std::snprintf(body, sizeof(body), "{\"id\":%d,\"message\":\"Hello, World!\"}", id);

        char header[128];
        int h_len = std::snprintf(header, sizeof(header),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: keep-alive\r\n\r\n",
            body_len);

        std::memcpy(c.out_buf + c.out_len, header, h_len);
        c.out_len += h_len;
        std::memcpy(c.out_buf + c.out_len, body, body_len);
        c.out_len += body_len;
    } else {
        constexpr std::string_view err404 = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";
        std::memcpy(c.out_buf + c.out_len, err404.data(), err404.size());
        c.out_len += static_cast<int>(err404.size());
    }
}

int main(int argc, char **argv) {
    int port = 8080;
    if (argc > 1) port = std::atoi(argv[1]);
    const char *env_port = std::getenv("PORT");
    if (env_port) port = std::atoi(env_port);

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) return 1;

    int opt = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

    sockaddr_in sin{};
    sin.sin_family = AF_INET;
    sin.sin_addr.s_addr = htonl(INADDR_ANY);
    sin.sin_port = htons(static_cast<u_short>(port));

    if (bind(listener, reinterpret_cast<sockaddr*>(&sin), sizeof(sin)) != 0) return 1;
    if (listen(listener, 1024) != 0) return 1;

    u_long mode = 1;
    ioctlsocket(listener, FIONBIO, &mode);

    for (auto &c : conns) c.fd = INVALID_SOCKET;

    poll_fds[0].fd = listener;
    poll_fds[0].events = POLLIN;
    num_fds = 1;

    std::printf("C++ Server listening on port %d...\n", port);
    std::fflush(stdout);

    while (true) {
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
                SOCKET client = accept(listener, nullptr, nullptr);
                if (client == INVALID_SOCKET) break;
                u_long client_mode = 1;
                ioctlsocket(client, FIONBIO, &client_mode);
                int flag = 1;
                setsockopt(client, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&flag), sizeof(flag));

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

                        while (true) {
                            char *delim = std::strstr(conns[i].in_buf, "\r\n\r\n");
                            if (!delim) break;
                            int req_len = static_cast<int>(delim - conns[i].in_buf) + 4;
                            
                            if (req_len < 14 || (conns[i].in_buf[0] != 'G' && conns[i].in_buf[0] != 'P')) {
                                constexpr std::string_view err400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                send(conns[i].fd, err400.data(), static_cast<int>(err400.size()), 0);
                                close_conn(i);
                                i--;
                                break;
                            }

                            handle_request(conns[i], std::string_view(conns[i].in_buf, req_len));

                            int rest = conns[i].in_len - req_len;
                            if (rest > 0) {
                                std::memmove(conns[i].in_buf, conns[i].in_buf + req_len, rest);
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
