use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

const BUF_SIZE: usize = 8192;

fn handle_connection(mut stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let mut in_buf = [0u8; BUF_SIZE];
    let mut in_len = 0;
    let mut out_buf = [0u8; BUF_SIZE * 2];

    while let Ok(n) = stream.read(&mut in_buf[in_len..]) {
        if n == 0 {
            break;
        }
        in_len += n;

        // Process all complete requests in buffer (pipelining)
        loop {
            let slice = &in_buf[..in_len];
            let Some(delim_idx) = slice.windows(4).position(|w| w == b"\r\n\r\n") else {
                break;
            };
            let req_len = delim_idx + 4;
            let req = &in_buf[..req_len];

            let mut out_len = 0;
            if req.starts_with(b"POST ") {
                let err405 = b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(err405);
                return;
            }
            if req_len < 14 || !req.starts_with(b"GET ") {
                let err400 =
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(err400);
                return;
            }

            let url = &req[4..];
            if url.starts_with(b"/baseline11?") {
                let params = &url[12..];
                let mut a: i32 = 0;
                let mut b: i32 = 0;

                let end = params
                    .iter()
                    .position(|&c| c == b' ' || c == b'\r')
                    .unwrap_or(params.len());
                let p_slice = &params[..end];

                for part in p_slice.split(|&c| c == b'&') {
                    if part.starts_with(b"a=") {
                        a = std::str::from_utf8(&part[2..])
                            .unwrap_or("0")
                            .parse()
                            .unwrap_or(0);
                    } else if part.starts_with(b"b=") {
                        b = std::str::from_utf8(&part[2..])
                            .unwrap_or("0")
                            .parse()
                            .unwrap_or(0);
                    }
                }

                let sum = a + b;
                let body = sum.to_string();
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
                    body.len()
                );

                let h_bytes = header.as_bytes();
                let b_bytes = body.as_bytes();
                out_buf[out_len..out_len + h_bytes.len()].copy_from_slice(h_bytes);
                out_len += h_bytes.len();
                out_buf[out_len..out_len + b_bytes.len()].copy_from_slice(b_bytes);
                out_len += b_bytes.len();
            } else if url.starts_with(b"/json/") {
                let id_slice = &url[6..];
                let end = id_slice
                    .iter()
                    .position(|&c| c == b' ' || c == b'\r')
                    .unwrap_or(id_slice.len());
                let id: i32 = std::str::from_utf8(&id_slice[..end])
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0);

                let body = format!("{{\"id\":{},\"message\":\"Hello, World!\"}}", id);
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
                    body.len()
                );

                let h_bytes = header.as_bytes();
                let b_bytes = body.as_bytes();
                out_buf[out_len..out_len + h_bytes.len()].copy_from_slice(h_bytes);
                out_len += h_bytes.len();
                out_buf[out_len..out_len + b_bytes.len()].copy_from_slice(b_bytes);
                out_len += b_bytes.len();
            } else {
                let err404 = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";
                out_buf[out_len..out_len + err404.len()].copy_from_slice(err404);
                out_len += err404.len();
            }

            if stream.write_all(&out_buf[..out_len]).is_err() {
                return;
            }

            // Shift buffer
            let rest = in_len - req_len;
            if rest > 0 {
                in_buf.copy_within(req_len..in_len, 0);
            }
            in_len = rest;
        }
    }
}

fn main() {
    let mut port = 8080;
    let args: Vec<String> = env::args().collect();
    if args.len() > 1 {
        if let Ok(p) = args[1].parse::<u16>() {
            port = p;
        }
    }
    if let Ok(p_str) = env::var("PORT") {
        if let Ok(p) = p_str.parse::<u16>() {
            port = p;
        }
    }

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).expect("Failed to bind");
    println!("Rust Server listening on port {}...", port);

    for stream in listener.incoming() {
        if let Ok(s) = stream {
            std::thread::spawn(move || {
                handle_connection(s);
            });
        }
    }
}
