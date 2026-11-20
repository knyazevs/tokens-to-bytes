import cluster from 'node:cluster';
import http from 'node:http';

if (cluster.isPrimary) {
  const numWorkers = parseInt(process.env.WORKERS || '6', 10);
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }
} else {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const url = req.url || '';
    if (url.startsWith('/baseline11')) {
      const qIdx = url.indexOf('?');
      let a = 0, b = 0;
      if (qIdx !== -1) {
        const query = url.slice(qIdx + 1);
        for (const pair of query.split('&')) {
          const eq = pair.indexOf('=');
          if (eq > 0) {
            const key = pair.slice(0, eq);
            const val = parseInt(pair.slice(eq + 1), 10) || 0;
            if (key === 'a') a = val;
            else if (key === 'b') b = val;
          }
        }
      }
      const sum = String(a + b);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(sum)
      });
      res.end(sum);
    } else if (url.startsWith('/json/')) {
      const id = parseInt(url.slice(6), 10) || 0;
      const body = JSON.stringify({ id, message: 'Hello, World!' });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      });
      res.end(body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  const port = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
  server.listen(port, '127.0.0.1');
}
