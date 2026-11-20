# Multi-stage zero-dependency build for Pure x86-64 Assembly Web Server
FROM alpine:3.20 AS builder

RUN apk add --no-cache gcc binutils musl-dev

WORKDIR /build
COPY linux_server.S .

# Build 100% static bare-metal ELF binary (zero libc, zero dynamic linker)
RUN gcc -nostdlib -static -O3 -march=x86-64-v3 linux_server.S -o /server && \
    strip --strip-all /server

# Stage 2: Empty scratch image (~9.6 KB total container image size)
FROM scratch

COPY --from=builder /server /server

EXPOSE 8080

ENTRYPOINT ["/server", "8080"]
