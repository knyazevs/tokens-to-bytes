import net from 'node:net';

export async function benchHttp({ port = 8080, concurrency = 30, totalRequests = 15000, path = '/baseline11?a=13&b=42' } = {}) {
  const perClient = Math.floor(totalRequests / concurrency);
  const latencies = [];

  const rawReq = `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;

  function runClient() {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        let sent = 0;
        let received = 0;
        let buf = '';
        let startT = process.hrtime.bigint();

        function sendNext() {
          if (sent < perClient) {
            sent++;
            startT = process.hrtime.bigint();
            client.write(rawReq);
          } else {
            client.end();
            resolve();
          }
        }

        client.on('data', (chunk) => {
          buf += chunk.toString('latin1');
          while (buf.includes('\r\n\r\n')) {
            const hEnd = buf.indexOf('\r\n\r\n');
            const clMatch = buf.slice(0, hEnd).match(/content-length:\s*(\d+)/i);
            const cl = clMatch ? parseInt(clMatch[1], 10) : 0;
            if (buf.length < hEnd + 4 + cl) break;

            const endT = process.hrtime.bigint();
            const latencyUs = Number(endT - startT) / 1000;
            latencies.push(latencyUs);

            buf = buf.slice(hEnd + 4 + cl);
            received++;
            sendNext();
          }
        });

        client.on('error', reject);
        sendNext();
      });
    });
  }

  // Warmup 500 requests
  const warmupClient = runClient;

  const t0 = process.hrtime.bigint();
  const clients = Array.from({ length: concurrency }, () => runClient());
  await Promise.all(clients);
  const t1 = process.hrtime.bigint();

  const totalTimeSec = Number(t1 - t0) / 1e9;
  const actualRequests = latencies.length;
  const rps = Math.round(actualRequests / totalTimeSec);

  latencies.sort((a, b) => a - b);
  const min = latencies[0] || 0;
  const median = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  return {
    rps,
    totalRequests: actualRequests,
    durationSec: Number(totalTimeSec.toFixed(3)),
    latencyUs: {
      min: Math.round(min),
      median: Math.round(median),
      p95: Math.round(p95),
      p99: Math.round(p99)
    }
  };
}

if (process.argv[1]?.endsWith('bench-http.mjs')) {
  const port = parseInt(process.argv[2] || '8080', 10);
  benchHttp({ port }).then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
}
