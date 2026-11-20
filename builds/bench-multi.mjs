import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function benchMulti({
  port = 8080,
  clientProcesses = 4,
  concurrencyPerProcess = 15,
  requestsPerProcess = 15000,
  path: reqPath = '/baseline11?a=13&b=42'
} = {}) {
  const runnerScript = path.join(root, 'builds/bench-http.mjs');

  const promises = [];
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < clientProcesses; i++) {
    promises.push(
      new Promise((resolve, reject) => {
        const child = spawn(
          'node',
          [
            '-e',
            `
            import('./builds/bench-http.mjs').then(async m => {
              const res = await m.benchHttp({
                port: ${port},
                concurrency: ${concurrencyPerProcess},
                totalRequests: ${requestsPerProcess},
                path: '${reqPath}'
              });
              console.log(JSON.stringify(res));
            }).catch(e => { console.error(e); process.exit(1); });
          `
          ],
          { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
        );

        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.stderr.on('data', (d) => (err += d.toString()));

        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`Worker ${i} failed: ${err}`));
          try {
            const parsed = JSON.parse(out.trim());
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse worker output: ${out} (${e.message})`));
          }
        });
      })
    );
  }

  const results = await Promise.all(promises);
  const t1 = process.hrtime.bigint();
  const totalDurationSec = Number(t1 - t0) / 1e9;

  let totalRequests = 0;
  let totalWeightedMedian = 0;
  let maxP99 = 0;
  let minLat = 999999;

  for (const r of results) {
    totalRequests += r.totalRequests;
    totalWeightedMedian += r.latencyUs.median * r.totalRequests;
    if (r.latencyUs.p99 > maxP99) maxP99 = r.latencyUs.p99;
    if (r.latencyUs.min < minLat) minLat = r.latencyUs.min;
  }

  const rps = Math.round(totalRequests / totalDurationSec);
  const avgMedian = Math.round(totalWeightedMedian / totalRequests);

  return {
    rps,
    totalRequests,
    durationSec: Number(totalDurationSec.toFixed(3)),
    latencyUs: {
      min: minLat,
      median: avgMedian,
      p99: maxP99
    }
  };
}

if (process.argv[1]?.endsWith('bench-multi.mjs')) {
  const port = parseInt(process.argv[2] || '8080', 10);
  benchMulti({ port }).then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
}
