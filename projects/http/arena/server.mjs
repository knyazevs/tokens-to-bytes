/**
 * Official HttpArena Node.js reference engine implementation
 * Ported from MDA2AV/HttpArena/frameworks/node/server.js
 *
 * Implements the exact HttpArena sumQuery string-split parser without URL object
 * allocations, running on node:http.
 */
import http from 'node:http';

const SERVER_HDR = 'node';

function sendText(res, body) {
  res.writeHead(200, {
    'content-type': 'text/plain',
    'content-length': Buffer.byteLength(body),
    'server': SERVER_HDR
  });
  res.end(body);
}

function sendJson(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'server': SERVER_HDR
  });
  res.end(body);
}

// Exact HttpArena query parser: manual '&' / '=' splitting without URL allocations
function sumQuery(query) {
  let sum = 0;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const n = parseInt(pair.slice(eq + 1), 10);
    if (n === n) sum += n;
  }
  return sum;
}

const server = http.createServer((req, res) => {
  const url = req.url || '';
  const mark = url.indexOf('?');
  const path = mark < 0 ? url : url.slice(0, mark);
  const query = mark < 0 ? '' : url.slice(mark + 1);

  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain', 'server': SERVER_HDR });
    res.end('Method Not Allowed');
    return;
  }

  if (path === '/pipeline') {
    return sendText(res, 'ok');
  }

  if (path === '/baseline11') {
    const querySum = sumQuery(query);
    return sendText(res, String(querySum));
  }

  if (path.startsWith('/json/')) {
    const id = parseInt(path.slice(6), 10) || 0;
    const body = JSON.stringify({ id, message: 'Hello, World!' });
    return sendJson(res, body);
  }

  res.writeHead(404, { 'content-type': 'text/plain', 'content-length': 9, 'server': SERVER_HDR });
  res.end('Not found');
});

const port = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
server.listen(port, '127.0.0.1');
