import net from 'node:net';

export async function runHttpTests(port = 8080) {
  const tests = [];

  function sendRaw(payload) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.write(payload);
      });
      let data = '';
      client.on('data', (chunk) => {
        data += chunk.toString('utf-8');
        // If we received expected responses or server closed connection
        if (data.includes('\r\n\r\n')) {
          // check if we got full response or wait short timeout
          setTimeout(() => {
            client.end();
            resolve(data);
          }, 30);
        }
      });
      client.on('error', reject);
      client.on('end', () => resolve(data));
      setTimeout(() => {
        client.destroy();
        resolve(data);
      }, 1000);
    });
  }

  async function check(name, fn) {
    try {
      await fn();
      tests.push({ name, pass: true });
    } catch (err) {
      tests.push({ name, pass: false, error: err.message });
    }
  }

  // Test 1: Baseline 13 + 42
  await check('GET /baseline11?a=13&b=42', async () => {
    const res = await sendRaw('GET /baseline11?a=13&b=42 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 200 OK')) throw new Error(`Expected 200 OK, got: ${res.split('\r\n')[0]}`);
    if (!res.toLowerCase().includes('content-type: text/plain')) throw new Error('Missing Content-Type: text/plain');
    const body = res.split('\r\n\r\n')[1];
    if (body.trim() !== '55') throw new Error(`Expected body "55", got: "${body}"`);
  });

  // Test 2: Baseline 100 + 250
  await check('GET /baseline11?a=100&b=250', async () => {
    const res = await sendRaw('GET /baseline11?a=100&b=250 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 200 OK')) throw new Error(`Expected 200 OK, got: ${res.split('\r\n')[0]}`);
    const body = res.split('\r\n\r\n')[1];
    if (body.trim() !== '350') throw new Error(`Expected body "350", got: "${body}"`);
  });

  // Test 3: JSON Endpoint
  await check('GET /json/50', async () => {
    const res = await sendRaw('GET /json/50 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 200 OK')) throw new Error(`Expected 200 OK, got: ${res.split('\r\n')[0]}`);
    if (!res.toLowerCase().includes('content-type: application/json')) throw new Error('Missing Content-Type: application/json');
    const body = res.split('\r\n\r\n')[1]?.trim();
    const parsed = JSON.parse(body);
    if (parsed.id !== 50 || parsed.message !== 'Hello, World!') {
      throw new Error(`Unexpected JSON: ${JSON.stringify(parsed)}`);
    }
  });

  // Test 4: Keep-Alive Sequential
  await check('Keep-Alive: 5 sequential requests on one socket', () => {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, async () => {
        let count = 0;
        let buf = '';

        client.on('data', (chunk) => {
          buf += chunk.toString('utf-8');
          while (buf.includes('\r\n\r\n')) {
            const headerEnd = buf.indexOf('\r\n\r\n');
            const headers = buf.slice(0, headerEnd);
            const clMatch = headers.match(/content-length:\s*(\d+)/i);
            const cl = clMatch ? parseInt(clMatch[1], 10) : 0;
            if (buf.length < headerEnd + 4 + cl) break; // waiting for body

            buf = buf.slice(headerEnd + 4 + cl);
            count++;
            if (count < 5) {
              client.write(`GET /baseline11?a=${count}&b=1 HTTP/1.1\r\nHost: localhost\r\n\r\n`);
            } else {
              client.end();
              resolve();
            }
          }
        });

        client.on('error', reject);
        client.write('GET /baseline11?a=0&b=1 HTTP/1.1\r\nHost: localhost\r\n\r\n');
      });
    });
  });

  // Test 5: Pipelining
  await check('Pipelining: 3 requests in single packet', () => {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        let buf = '';
        client.on('data', (chunk) => {
          buf += chunk.toString('utf-8');
          const matches = buf.match(/HTTP\/1\.1 200 OK/g);
          if (matches && matches.length === 3) {
            client.end();
            resolve();
          }
        });
        client.on('error', reject);

        const packet =
          'GET /baseline11?a=1&b=2 HTTP/1.1\r\nHost: localhost\r\n\r\n' +
          'GET /baseline11?a=10&b=20 HTTP/1.1\r\nHost: localhost\r\n\r\n' +
          'GET /json/99 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';
        client.write(packet);
      });
    });
  });

  // Test 6: 404 Not Found
  await check('GET /nonexistent -> 404', async () => {
    const res = await sendRaw('GET /unknown-path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 404')) throw new Error(`Expected 404, got: ${res.split('\r\n')[0]}`);
  });

  // Test 7: Method Not Allowed
  await check('POST /baseline11 -> 405 or 400', async () => {
    const res = await sendRaw('POST /baseline11 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 405') && !res.startsWith('HTTP/1.1 400')) {
      throw new Error(`Expected 405 or 400, got: ${res.split('\r\n')[0]}`);
    }
  });

  // Test 8: Malformed
  await check('Malformed Request -> 400', async () => {
    const res = await sendRaw('INVALID_HTTP_DATA\r\n\r\n');
    if (!res.startsWith('HTTP/1.1 400')) {
      throw new Error(`Expected 400, got: ${res.split('\r\n')[0]}`);
    }
  });

  const passed = tests.filter((t) => t.pass).length;
  return { passed, total: tests.length, tests };
}

// Standalone CLI execution
if (process.argv[1]?.endsWith('test-http.mjs')) {
  const port = parseInt(process.argv[2] || '8080', 10);
  runHttpTests(port).then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.passed === res.total ? 0 : 1);
  });
}
