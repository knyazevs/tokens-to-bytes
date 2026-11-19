import { missingExports, runTests } from './protocol.js';
import {
  missingExports as missingJsonExports,
  runTests as runJsonTests,
} from './protocol-json.js';
import {
  missingExports as missingRegexExports,
  runTests as runRegexTests,
} from './protocol-regex.js';
import {
  missingExports as missingVmExports,
  runTests as runVmTests,
} from './protocol-vm.js';
import { benchIsolated, BENCH_PROTOCOL } from './bench-client.js';

const REPO = 'https://github.com/knyazevs/tokens-to-bytes';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const fmtInt = (n) => Number(n).toLocaleString('ru-RU');
const fmtBytes = (n) => `${fmtInt(n)} Б`;
const fmtDec = (n, digits = 1) => Number(n).toFixed(digits).replace('.', ',');
const pct = (n, max) => `${Math.max(2, (n / max) * 100).toFixed(1)}%`;

/* ── тема ─────────────────────────────────────────────────── */

try {
  const saved = localStorage.getItem('ttb-theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
} catch { /* приватный режим */ }

$('#theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ttb-theme', next); } catch { /* ignore */ }
});

$('#repo-link').href = REPO;

/* ── загрузка измерений ───────────────────────────────────── */

function dateRu(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '18 ноября 2026';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function fail(message) {
  const tables = {
    '#setup-table tbody': 4,
    '#results-table tbody': 11,
    '#spread-table tbody': 9,
    '#coverage-table tbody': 3,
    '#json-setup-table tbody': 4,
    '#json-results-table tbody': 11,
    '#json-spread-table tbody': 9,
    '#json-coverage-table tbody': 3,
    '#regex-setup-table tbody': 4,
    '#regex-results-table tbody': 11,
    '#regex-spread-table tbody': 9,
    '#regex-coverage-table tbody': 3,
    '#vm-setup-table tbody': 4,
    '#vm-results-table tbody': 11,
    '#vm-spread-table tbody': 9,
    '#vm-coverage-table tbody': 3,
    '#paired-table tbody': 5,
    '#replication-table tbody': 9,
    '#replication-detail-table tbody': 6,
  };
  for (const [sel, cols] of Object.entries(tables)) {
    const body = $(sel);
    if (body) body.innerHTML = `<tr><td colspan="${cols}" class="quiet">${message}</td></tr>`;
  }
  for (const sel of ['#size-chart', '#json-size-chart', '#regex-size-chart', '#vm-size-chart']) {
    const el = $(sel);
    if (el) el.innerHTML = `<p class="quiet" style="margin:0">${message}</p>`;
  }
  for (const sel of ['#verify-status', '#json-verify-status', '#regex-verify-status', '#vm-verify-status', '#bench-status', '#json-bench-status', '#regex-bench-status', '#vm-bench-status']) {
    const el = $(sel);
    if (el) el.textContent = 'данные недоступны';
  }
}

/* ── общие рендеры ────────────────────────────────────────── */

function projectStats(data) {
  const engines = data.engines;
  const min = engines.reduce((a, b) => (a.bytes <= b.bytes ? a : b));
  const minGzip = engines.reduce((a, b) => (a.gzip <= b.gzip ? a : b));
  const minBrotli = engines.reduce((a, b) => (a.brotli <= b.brotli ? a : b));
  const manual = engines.find((e) => e.id === 'manual');
  const compiled = engines.filter((e) => e.id !== 'manual' && e.tokens);

  let tokenRatio = null;
  if (manual?.tokens && compiled.length) {
    const ratios = compiled.map((e) => manual.tokens.artifact / e.tokens.artifact);
    tokenRatio = { lo: Math.min(...ratios), hi: Math.max(...ratios) };
  }

  const perfValues = engines.map((e) => e.perf.opsPerSec);
  const perfBest = Math.max(...perfValues);
  const perfWorst = Math.min(...perfValues);

  const spreads = engines
    .filter((e) => e.perf.stats?.median)
    .map((e) => (e.perf.stats.stddev / e.perf.stats.median) * 100);

  const cpp = engines.find((e) => e.id === 'cpp');
  const cppOpt = engines.find((e) => e.id === 'cpp-opt');

  return {
    engines, min, minGzip, minBrotli, manual, compiled,
    tokenRatio, perfBest, perfWorst, spreads, cpp, cppOpt,
  };
}

function renderMeta(data, prefix = '', { global = false } = {}) {
  const s = projectStats(data);
  const key = (name) => (prefix ? `${prefix}-${name}` : name);
  const set = (name, value) => {
    const el = $(`[data-stat="${key(name)}"]`);
    if (el) el.textContent = value;
  };

  if (global) {
    $('#kf-min').textContent = fmtBytes(s.min.bytes);
    if (s.manual?.tokens) $('#kf-tokens').textContent = fmtInt(s.manual.tokens.artifact);
  }

  set('min-bytes', fmtInt(s.min.bytes));
  set('min-gzip', fmtInt(s.minGzip.gzip));
  set('min-brotli', fmtInt(s.minBrotli.brotli));

  if (s.tokenRatio) {
    set('token-ratio', `${fmtDec(s.tokenRatio.lo)}–${fmtDec(s.tokenRatio.hi)}`);
  }

  set('perf-spread', fmtDec(s.perfBest / s.perfWorst, 2));
  set('ops-min', fmtOps(s.perfWorst));
  set('ops-max', fmtOps(s.perfBest));

  if (s.spreads.length) {
    set('noise-min', fmtDec(Math.min(...s.spreads)));
    set('noise-max', fmtDec(Math.max(...s.spreads)));
  }

  set('samples', fmtInt(data.engines[0]?.perf.samples?.length ?? 0));

  if (s.cpp && s.cppOpt) {
    set('cpp-gain', String(Math.round((s.cppOpt.perf.opsPerSec / s.cpp.perf.opsPerSec - 1) * 100)));
    set('cpp-size', String(Math.round((s.cppOpt.bytes / s.cpp.bytes - 1) * 100)));
  }

  const cpu = data.environment?.cpu ?? 'неизвестный CPU';
  set('cpu', cpu);

  if (global) {
    const updated = dateRu(data.generatedAt);
    $('#updated').textContent = updated;
    $('#foot-updated').textContent = updated;

    const affinity = data.environment?.affinity;
    $('#results-env').textContent =
      `Node ${data.environment?.node ?? '—'} · ${data.environment?.platform ?? '—'} · ${cpu}` +
      (affinity ? ` · привязка к ядрам 0x${affinity}` : '') +
      ` · токенизатор ${data.environment?.tokenizer ?? '—'}`;
  }

  const env = prefix ? $(`#${prefix}-env`) : null;
  if (env) {
    env.textContent =
      `Node ${data.environment?.node ?? '—'} · ${cpu} · ` +
      `медиана по ${fmtInt(data.engines[0]?.perf.samples?.length ?? 0)} замерам`;
  }
}

function sourceUrl(path) {
  return `${REPO}/blob/main/${path}`;
}

function renderSetup(selector, data) {
  const body = $(selector);
  if (!body) return;
  body.innerHTML = data.engines.map((e) => `
    <tr>
      <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
      <td style="text-align:left">${e.method}</td>
      <td style="text-align:left" class="quiet">${e.toolchain}</td>
      <td><a href="${sourceUrl(e.source)}">${e.source.split('/').pop()}</a></td>
    </tr>
  `).join('');
}

function renderResults(selector, data, testAttr) {
  const body = $(selector);
  if (!body) return;
  body.innerHTML = data.engines.map((e) => {
    const gzR = e.bytes ? (e.gzip / e.bytes) * 100 : 0;
    const ss = sampleSummary(e.perf.samples) || (e.perf.stats ? { ...e.perf.stats, cv: e.perf.stats.mean ? (e.perf.stats.stddev / e.perf.stats.mean) * 100 : 0 } : null);
    const cv = ss ? fmtPct(ss.cv, 1) : '—';
    const tArt = e.tokens ? fmtInt(e.tokens.artifact) : '—';
    const tB64 = e.tokens?.base64 ? fmtInt(e.tokens.base64) : '—';
    const tPerTest = e.tokens ? fmtDec(e.tokens.artifact / e.tests.total, 1) : '—';
    return `
    <tr>
      <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
      <td class="strong">${fmtInt(e.bytes)}</td>
      <td>${fmtInt(e.gzip)}</td>
      <td>${fmtInt(e.brotli)}</td>
      <td>${fmtPct(gzR, 0)}</td>
      <td data-${testAttr}="${e.id}"><span class="pill ok">${e.tests.passed}/${e.tests.total}</span></td>
      <td>${fmtOps(e.perf.opsPerSec)}</td>
      <td>${cv}</td>
      <td>${tArt}</td>
      <td>${tB64}</td>
      <td>${tPerTest}</td>
    </tr>
  `;
  }).join('');
}

function renderChart(selector, data, metric) {
  const el = $(selector);
  if (!el) return;
  const max = Math.max(...data.engines.map((e) => e[metric]));
  el.innerHTML = data.engines.map((e) => {
    const value = e[metric];
    return `
      <div class="chart-row">
        <span class="who">${e.name}</span>
        <span class="chart-bar"><i style="width:${pct(value, max)};background:${e.tone}"></i></span>
        <span class="val">${fmtBytes(value)}</span>
      </div>
    `;
  }).join('');
}

const fmtOps = (v) => {
  const scale = v >= 1e6 ? 1e6 : 1e3;
  const unit = scale === 1e6 ? 'M' : 'k';
  const digits = scale === 1e6 && v < 2e6 ? 2 : 1;
  return `${(v / scale).toFixed(digits).replace('.', ',')}${unit}`;
};

const fmtPct = (v, digits = 1) => `${Number(v).toFixed(digits).replace('.', ',')} %`;
const fmtRatio = (v) => `${Number(v).toFixed(2).replace('.', ',')}×`;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function sampleSummary(samples) {
  if (!samples?.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = samples.reduce((s, v) => s + v, 0) / n;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const median = percentile(sorted, 50);
  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    stddev,
    cv: mean ? (stddev / mean) * 100 : 0,
    p5: percentile(sorted, 5),
    p95: percentile(sorted, 95),
    n,
  };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function bootstrapMedianCI(samples, iters = 2000, alpha = 0.05) {
  if (!samples || samples.length < 2) return null;
  const n = samples.length;
  const meds = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const draw = new Array(n);
    for (let j = 0; j < n; j++) draw[j] = samples[(Math.random() * n) | 0];
    meds[i] = median(draw);
  }
  meds.sort((a, b) => a - b);
  const lo = meds[Math.floor((alpha / 2) * iters)];
  const hi = meds[Math.floor((1 - alpha / 2) * iters)];
  return { lo, hi };
}

const TEST_COVERAGE = {
  calculator: [
    { name: 'Базовая арифметика и дроби', cases: 5, note: 'сложение, умножение, вычитание, деление, десятичные' },
    { name: 'Цепочки и повтор операций', cases: 4, note: 'левоассоциативная цепочка, повтор =, цепочка после результата' },
    { name: 'Ввод и редактирование', cases: 5, note: 'backspace, дробная часть, смена знака, ввод после neg' },
    { name: 'Ошибки и восстановление', cases: 2, note: 'деление на ноль и ввод после ошибки' },
    { name: 'Формула и операнды', cases: 1, note: 'display/leftOperand/operand после = и повтор =' },
  ],
  json: [
    { name: 'Корректные документы', cases: 13, note: 'примитивы, числа, строки, escape/unicode, массивы, объекты, вложенность, пробелы' },
    { name: 'Некорректные входы', cases: 14, note: 'обрыв, лишние токены, ошибки синтаксиса чисел/строк, нарушение структуры, глубина' },
  ],
  regex: [
    { name: 'Контракт и состояние API', cases: 4, note: 'match до компиляции, reset, пустой паттерн/текст, указатели буферов' },
    { name: 'Сопоставление (match/no-match)', cases: 39, note: 'якоря, классы, квантификаторы, группы, альтернативы, escape-последовательности' },
    { name: 'Ошибки компиляции паттерна', cases: 18, note: 'скобки, классы символов, диапазоны, escape, недопустимые квантификаторы' },
  ],
  vm: [
    { name: 'Контракт и состояние API', cases: 8, note: 'reset/load/run/step, указатели, доступ к регистрам и стеку' },
    { name: 'Корректные программы', cases: 31, note: 'арифметика, стековые операции, ветвления, циклы, вызовы, локалы, halt/result' },
    { name: 'Ошибки загрузки и выполнения', cases: 13, note: 'неизвестный опкод, адреса, локалы, under/overflow, деление на ноль, возврат' },
  ],
};

function renderSpread(selector, data) {
  const body = $(selector);
  if (!body) return;
  const rows = data.engines.filter((e) => e.perf.samples || e.perf.stats);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="quiet">Разброс не записан в данных.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((e) => {
    const s = sampleSummary(e.perf.samples) || e.perf.stats;
    if (!s) return '';
    const cv = s.cv ?? (s.mean ? (s.stddev / s.mean) * 100 : 0);
    const p5 = s.p5 ?? s.min;
    const p95 = s.p95 ?? s.max;
    return `
      <tr>
        <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
        <td>${fmtOps(s.min)}</td>
        <td>${fmtOps(p5)}</td>
        <td class="strong">${fmtOps(s.median)}</td>
        <td>${fmtOps(s.mean)}</td>
        <td>${fmtOps(p95)}</td>
        <td>${fmtOps(s.max)}</td>
        <td class="quiet">${fmtOps(s.stddev)}</td>
        <td>${fmtPct(cv, 1)}</td>
      </tr>
    `;
  }).join('');
}

function signedPct(ratio) {
  const value = (ratio - 1) * 100;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')} %`;
}

function renderPaired(selector, sets) {
  const body = $(selector);
  if (!body) return;
  if (sets.every((set) => !set)) {
    body.innerHTML = '<tr><td colspan="5" class="quiet">Парные данные недоступны — нужен локальный сервер.</td></tr>';
    return;
  }
  const order = ['manual', 'rust', 'as', 'c', 'cpp', 'cpp-opt'];
  const names = new Map();
  for (const set of sets) {
    if (!set) continue;
    for (const e of set.engines) names.set(e.id, e.name);
  }
  body.innerHTML = order.map((id) => {
    const cells = sets.map((set) => {
      if (!set) return '<td class="quiet">—</td>';
      const e = set.engines.find((x) => x.id === id);
      if (!e) return '<td class="quiet">—</td>';
      if (id === set.reference) return '<td class="quiet">—</td>';
      const r = e.ratio;
      return `<td><b>${signedPct(r.median)}</b><span class="ci">[${signedPct(r.lo)}; ${signedPct(r.hi)}] · ${r.wins}/${r.total}</span></td>`;
    }).join('');
    return `
      <tr>
        <td><b>${names.get(id) ?? id}</b></td>
        ${cells}
      </tr>
    `;
  }).join('');
}

function renderReplication(selector, data) {
  const body = $(selector);
  if (!body) return;
  if (!data?.runs?.length) {
    body.innerHTML = '<tr><td colspan="9" class="quiet">Журналы репликации недоступны — нужен локальный сервер.</td></tr>';
    return;
  }
  body.innerHTML = data.runs.map((run) => {
    const f = run.final ?? {};
    const tests = `${f.passed ?? 0}/${f.total ?? 17}`;
    const compileFails = (run.log || []).filter((r) => r.compiled === false).length;
    const testFails = (run.log || []).filter((r) => r.compiled !== false && r.passed !== r.total).length;
    const firstPass = run.iterations === 1 && run.failedIterations === 0 ? 'да' : 'нет';
    return `
      <tr>
        <td><b>${run.model}</b></td>
        <td>${fmtInt(run.iterations)}</td>
        <td>${fmtInt(run.failedIterations)}</td>
        <td>${fmtInt(compileFails)} / ${fmtInt(testFails)}</td>
        <td>${fmtInt(run.distinctDefects.length)}</td>
        <td>${firstPass}</td>
        <td>${fmtInt(run.artifactTokens)}</td>
        <td>${fmtInt(run.authoringBytes ?? 0)}</td>
        <td class="${f.passed === f.total ? 'strong' : ''}">${tests}</td>
      </tr>
    `;
  }).join('');
}

function renderReplicationDetail(selector, data) {
  const body = $(selector);
  if (!body) return;
  if (!data?.runs?.length) {
    body.innerHTML = '<tr><td colspan="6" class="quiet">Журналы репликации недоступны — нужен локальный сервер.</td></tr>';
    return;
  }
  body.innerHTML = data.runs.flatMap((run) => {
    const log = run.log || [];
    if (!log.length) return [`<tr><td><b>${run.model}</b></td><td colspan="5" class="quiet">нет записей</td></tr>`];
    return log.map((it, idx) => {
      let type = 'успех';
      if (it.compiled === false) type = 'ошибка компиляции';
      else if (it.passed !== it.total) type = 'провал тестов';
      const res = `${it.passed ?? 0}/${it.total ?? 17}`;
      const note = (it.note || '—').replace(/</g, '&lt;');
      const first = idx === 0 ? `<td rowspan="${log.length}"><b>${run.model}</b></td>` : '';
      const cls = (type === 'успех') ? '' : ' class="quiet"';
      return `
      <tr${cls}>
        ${first}
        <td>${fmtInt(it.seq ?? idx + 1)}</td>
        <td>${type}</td>
        <td class="${it.passed === it.total ? 'strong' : ''}">${res}</td>
        <td>${it.compiled === false ? 'нет' : 'да'}</td>
        <td style="text-align:left">${note}</td>
      </tr>`;
    });
  }).join('');
}

function renderTestCoverage(selector, slug, data) {
  const body = $(selector);
  if (!body) return;
  const cats = TEST_COVERAGE[slug];
  if (!cats) {
    body.innerHTML = '<tr><td colspan="3" class="quiet">Нет данных о категориях.</td></tr>';
    return;
  }
  const total = cats.reduce((s, c) => s + c.cases, 0);
  const t = data?.engines?.[0]?.tests;
  const status = t ? `${t.passed}/${t.total} у всех сборок` : '—';
  body.innerHTML = cats.map((c) => `
    <tr>
      <td><b>${c.name}</b></td>
      <td>${fmtInt(c.cases)}</td>
      <td style="text-align:left" class="quiet">${c.note}</td>
    </tr>
  `).join('') + `
    <tr>
      <td><b>Итого</b></td>
      <td class="strong">${fmtInt(total)}</td>
      <td style="text-align:left" class="quiet">${status} (в опубликованных данных)</td>
    </tr>`;
}

function renderScatter(selector, data) {
  const svg = $(selector);
  if (!svg) return;
  const W = 640;
  const H = 300;
  const pad = { l: 46, r: 18, t: 16, b: 38 };
  const points = data.engines.filter((e) => e.tokens);
  if (!points.length) return;
  const maxTokens = Math.max(...points.map((e) => e.tokens.artifact)) * 1.12;
  const maxBytes = Math.max(...points.map((e) => e.bytes)) * 1.15;
  const x = (v) => pad.l + (v / maxTokens) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / maxBytes) * (H - pad.t - pad.b);

  const grid = [0.25, 0.5, 0.75, 1].map((f) => `
    <line class="grid" x1="${x(maxTokens * f)}" y1="${pad.t}" x2="${x(maxTokens * f)}" y2="${H - pad.b}"/>
    <line class="grid" x1="${pad.l}" y1="${y(maxBytes * f)}" x2="${W - pad.r}" y2="${y(maxBytes * f)}"/>
  `).join('');

  const dots = points.map((e) => {
    const cx = x(e.tokens.artifact);
    const cy = y(e.bytes);
    const dx = e.id === 'manual' ? -8 : 9;
    const anchor = e.id === 'manual' ? 'end' : 'start';
    return `
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${e.tone}"/>
      <text class="pt-label" x="${(cx + dx).toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="${anchor}">${e.name}</text>
    `;
  }).join('');

  svg.innerHTML = `
    ${grid}
    <line class="axis" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/>
    <line class="axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}"/>
    <text x="${W - pad.r}" y="${H - 12}" text-anchor="end">токены артефакта →</text>
    <text x="14" y="${pad.t + 4}" transform="rotate(-90 14 ${pad.t + 4})">байты →</text>
    <text x="${pad.l}" y="${H - 12}" text-anchor="start">0</text>
    ${dots}
  `;
}

/* ── переключатель метрики ────────────────────────────────── */

function initMetric(segSelector, chartSelector, data) {
  const seg = $(segSelector);
  if (!seg) return;
  let metric = 'bytes';
  seg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-metric]');
    if (!btn) return;
    metric = btn.dataset.metric;
    seg.querySelectorAll('button[data-metric]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    renderChart(chartSelector, data, metric);
  });
}

/* ── проверка в браузере ──────────────────────────────────── */

async function instantiate(bytes) {
  if (!WebAssembly.validate(bytes)) throw new Error('invalid wasm');
  const mod = new WebAssembly.Module(bytes);
  const imports = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    (imports[imp.module] ||= {})[imp.name] = () => {};
  }
  const instance = await WebAssembly.instantiate(mod, imports);
  return instance.exports;
}

function initVerify({ data, dir, button, status, testAttr, missing, tests }) {
  const btn = $(button);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!data) return;
    btn.disabled = true;
    const statusEl = $(status);
    let ok = 0;
    const problems = [];

    for (const engine of data.engines) {
      const cell = $(`[data-${testAttr}="${engine.id}"]`);
      statusEl.textContent = `проверяю ${engine.name}…`;
      statusEl.classList.add('run');
      try {
        const res = await fetch(`${dir}/${engine.file}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const exports = await instantiate(new Uint8Array(await res.arrayBuffer()));
        const absent = missing(exports);
        if (absent.length) throw new Error(`нет экспортов: ${absent.join(', ')}`);
        const result = tests(exports);
        if (result.passed === result.total) {
          ok++;
          if (cell) cell.innerHTML = `<span class="pill ok">${result.passed}/${result.total}</span>`;
        } else {
          problems.push(`${engine.name}: ${result.failures.join('; ')}`);
          if (cell) cell.innerHTML = `<span class="pill bad">${result.passed}/${result.total}</span>`;
        }
      } catch (err) {
        problems.push(`${engine.name}: ${err.message}`);
        if (cell) cell.innerHTML = '<span class="pill bad">FAIL</span>';
      }
    }

    statusEl.classList.remove('run');
    statusEl.textContent = problems.length
      ? `ошибки: ${problems.join(' · ')}`
      : `все ${ok} сборок прошли ${data.engines[0].tests.total}/${data.engines[0].tests.total} тестов в браузере`;
    btn.disabled = false;
  });
}

/* ── живой бенчмарк ───────────────────────────────────────── */

function initBench({ data, dir, button, status, table, protocolUrl }) {
  const btn = $(button);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!data) return;
    btn.disabled = true;
    const statusEl = $(status);
    statusEl.textContent = 'подготовка…';
    statusEl.classList.add('run');

    const engines = data.engines.map((engine) => ({
      ...engine,
      url: `${dir}/${engine.file}`,
    }));

    const opts = {
      onProgress: ({ index, total, engine }) => {
        statusEl.textContent = `измеряю ${engine.name} (${index + 1}/${total})…`;
      },
    };
    if (protocolUrl) opts.protocolUrl = protocolUrl;

    let rows;
    try {
      rows = await benchIsolated(engines, opts);
    } catch (err) {
      statusEl.classList.remove('run');
      statusEl.textContent = `ошибка: ${err.message}`;
      btn.disabled = false;
      return;
    }

    const ok = rows.filter((r) => r.ok && r.perf);
    const best = ok.length ? Math.max(...ok.map((r) => r.perf.opsPerSec)) : 0;

    $(table).querySelector('tbody').innerHTML = rows.map((r) => {
      if (!r.ok) {
        return `<tr><td><span class="dot-key" style="background:${r.engine.tone}"></span>${r.engine.name}</td><td colspan="4" class="quiet">${r.error}</td></tr>`;
      }
      const { opsPerSec, stats } = r.perf;
      const rel = best / opsPerSec;
      return `
        <tr>
          <td><span class="dot-key" style="background:${r.engine.tone}"></span><b>${r.engine.name}</b></td>
          <td class="strong">${fmtInt(Math.round(opsPerSec))}</td>
          <td class="quiet">${fmtInt(Math.round(stats?.min ?? opsPerSec))}</td>
          <td class="quiet">${fmtInt(Math.round(stats?.max ?? opsPerSec))}</td>
          <td>${rel === 1 ? 'лучший' : '×' + rel.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    statusEl.classList.remove('run');
    statusEl.textContent =
      `готово · ${new Date().toLocaleTimeString('ru-RU')} · ` +
      `${BENCH_PROTOCOL.rounds} раундов на сборку, отдельный Worker`;
    btn.disabled = false;
  });
}

/* ── демо ─────────────────────────────────────────────────── */

function initDemo({ data, dir, tabs, frame, url }) {
  const tabsEl = $(tabs);
  const frameEl = $(frame);
  if (!tabsEl || !frameEl) return;

  tabsEl.innerHTML = data.engines.map((e) => `
    <button type="button" data-engine="${e.id}" aria-pressed="${e.id === 'manual'}">
      <span class="dot-key" style="background:${e.tone}"></span>${e.name}
    </button>
  `).join('');

  const select = (id) => {
    const engine = data.engines.find((e) => e.id === id) ?? data.engines[0];
    const target = engine.id === 'manual'
      ? `${dir}/index.html`
      : `${dir}/index.html?engine=${engine.file}`;
    frameEl.src = target;
    $(url).textContent = target;
    tabsEl.querySelectorAll('button[data-engine]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.engine === engine.id));
    });
  };

  tabsEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-engine]');
    if (btn) select(btn.dataset.engine);
  });
  select('manual');
}

/* ── проекты ──────────────────────────────────────────────── */

function renderProjects(projects) {
  const wrap = $('#projects-grid');
  wrap.innerHTML = projects.map((p) => {
    const live = p.status === 'live';
    const tags = (p.tags ?? []).map((t) => `<span>${t}</span>`).join('');
    const links = [];
    if (p.demo) links.push(`<a href="${p.demo}">демо</a>`);
    if (p.bench) links.push(`<a href="${p.bench}">бенчмарк</a>`);
    if (p.source) links.push(`<a href="${sourceUrl(p.source)}">исходники</a>`);
    return `
      <article class="project">
        <header>
          <h3>${p.name}</h3>
          <span class="pill ${live ? 'live' : 'planned'}">${live ? 'live' : 'в очереди'}</span>
        </header>
        <p>${p.summary}</p>
        <div class="meta">${tags}</div>
        ${links.length ? `<div class="links">${links.join('')}</div>` : ''}
      </article>
    `;
  }).join('');
}

/* ── оглавление ───────────────────────────────────────────── */

function initToc() {
  const links = $$('.toc a');
  const map = new Map();
  for (const link of links) {
    const id = link.getAttribute('href').slice(1);
    const section = document.getElementById(id);
    if (section) map.set(section, link);
  }
  const obs = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((l) => l.classList.remove('active'));
      map.get(entry.target)?.classList.add('active');
    }
  }, { rootMargin: '-84px 0px -68% 0px', threshold: 0 });
  map.forEach((_, section) => obs.observe(section));
}

/* ── копирование BibTeX ───────────────────────────────────── */

$('#copy-bib').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const text = $('#bibtex').textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'скопировано';
  } catch {
    btn.textContent = 'не удалось';
  }
  setTimeout(() => { btn.textContent = 'копировать'; }, 1600);
});

/* ── старт ────────────────────────────────────────────────── */

initToc();

const [calculatorResult, jsonResult, regexResult, vmResult, projectsResult] = await Promise.allSettled([
  loadJson('data/calculator.json'),
  loadJson('data/json.json'),
  loadJson('data/regex.json'),
  loadJson('data/vm.json'),
  loadJson('data/projects.json'),
]);

const pairedFiles = ['calculator', 'json', 'regex', 'vm'];
const pairedResults = await Promise.allSettled(
  pairedFiles.map((slug) => loadJson(`data/paired-${slug}.json`)),
);
const paired = Object.fromEntries(
  pairedFiles.map((slug, i) => [
    slug,
    pairedResults[i].status === 'fulfilled' ? pairedResults[i].value : null,
  ]),
);
let replication = null;
try {
  replication = await loadJson('data/replication.json');
} catch {
  replication = null;
}

const calculator = calculatorResult.status === 'fulfilled' ? calculatorResult.value : null;
const json = jsonResult.status === 'fulfilled' ? jsonResult.value : null;
const regex = regexResult.status === 'fulfilled' ? regexResult.value : null;
const vm = vmResult.status === 'fulfilled' ? vmResult.value : null;
const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : null;

if (calculator) {
  renderMeta(calculator, '', { global: true });
  renderSetup('#setup-table tbody', calculator);
  renderResults('#results-table tbody', calculator, 'engine-tests');
  renderSpread('#spread-table tbody', calculator);
  renderChart('#size-chart', calculator, 'bytes');
  renderScatter('#scatter', calculator);
  renderPaired('#paired-table tbody', [
    paired.calculator,
    paired.json,
    paired.regex,
    paired.vm,
  ]);
  renderReplication('#replication-table tbody', replication);
  renderReplicationDetail('#replication-detail-table tbody', replication);
  renderTestCoverage('#coverage-table tbody', 'calculator', calculator);
  initMetric('#calculator-metric', '#size-chart', calculator);
  initVerify({
    data: calculator,
    dir: 'projects/calculator',
    button: '#verify-btn',
    status: '#verify-status',
    testAttr: 'engine-tests',
    missing: missingExports,
    tests: runTests,
  });
  initDemo({
    data: calculator,
    dir: 'projects/calculator',
    tabs: '#engine-tabs',
    frame: '#demo-frame',
    url: '#demo-url',
  });
  initBench({
    data: calculator,
    dir: 'projects/calculator',
    button: '#bench-btn',
    status: '#bench-status',
    table: '#bench-table',
  });
} else {
  fail(`Не удалось загрузить измерения: ${calculatorResult.reason?.message ?? 'ошибка'}. Откройте статью через локальный сервер.`);
}

if (json) {
  renderMeta(json, 'json');
  const updated = $('#json-updated');
  if (updated) updated.textContent = dateRu(json.generatedAt);
  renderSetup('#json-setup-table tbody', json);
  renderResults('#json-results-table tbody', json, 'json-engine-tests');
  renderSpread('#json-spread-table tbody', json);
  renderTestCoverage('#json-coverage-table tbody', 'json', json);
  renderChart('#json-size-chart', json, 'bytes');
  renderScatter('#json-scatter', json);
  initMetric('#json-metric', '#json-size-chart', json);
  initVerify({
    data: json,
    dir: 'projects/json',
    button: '#json-verify-btn',
    status: '#json-verify-status',
    testAttr: 'json-engine-tests',
    missing: missingJsonExports,
    tests: runJsonTests,
  });
  initDemo({
    data: json,
    dir: 'projects/json',
    tabs: '#json-engine-tabs',
    frame: '#json-demo-frame',
    url: '#json-demo-url',
  });
  initBench({
    data: json,
    dir: 'projects/json',
    button: '#json-bench-btn',
    status: '#json-bench-status',
    table: '#json-bench-table',
    protocolUrl: 'assets/protocol-json.js',
  });
} else {
  const status = $('#json-verify-status');
  if (status) status.textContent = 'data/json.json недоступен — нужен локальный сервер';
}

if (regex) {
  renderMeta(regex, 'regex');
  const updated = $('#regex-updated');
  if (updated) updated.textContent = dateRu(regex.generatedAt);
  renderSetup('#regex-setup-table tbody', regex);
  renderResults('#regex-results-table tbody', regex, 'regex-engine-tests');
  renderSpread('#regex-spread-table tbody', regex);
  renderTestCoverage('#regex-coverage-table tbody', 'regex', regex);
  renderChart('#regex-size-chart', regex, 'bytes');
  renderScatter('#regex-scatter', regex);
  initMetric('#regex-metric', '#regex-size-chart', regex);
  initVerify({
    data: regex,
    dir: 'projects/regex',
    button: '#regex-verify-btn',
    status: '#regex-verify-status',
    testAttr: 'regex-engine-tests',
    missing: missingRegexExports,
    tests: runRegexTests,
  });
  initDemo({
    data: regex,
    dir: 'projects/regex',
    tabs: '#regex-engine-tabs',
    frame: '#regex-demo-frame',
    url: '#regex-demo-url',
  });
  initBench({
    data: regex,
    dir: 'projects/regex',
    button: '#regex-bench-btn',
    status: '#regex-bench-status',
    table: '#regex-bench-table',
    protocolUrl: 'assets/protocol-regex.js',
  });
} else {
  const status = $('#regex-verify-status');
  if (status) status.textContent = 'data/regex.json недоступен — нужен локальный сервер';
}

if (vm) {
  renderMeta(vm, 'vm');
  const updated = $('#vm-updated');
  if (updated) updated.textContent = dateRu(vm.generatedAt);
  renderSetup('#vm-setup-table tbody', vm);
  renderResults('#vm-results-table tbody', vm, 'vm-engine-tests');
  renderSpread('#vm-spread-table tbody', vm);
  renderTestCoverage('#vm-coverage-table tbody', 'vm', vm);
  renderChart('#vm-size-chart', vm, 'bytes');
  renderScatter('#vm-scatter', vm);
  initMetric('#vm-metric', '#vm-size-chart', vm);
  initVerify({
    data: vm,
    dir: 'projects/vm',
    button: '#vm-verify-btn',
    status: '#vm-verify-status',
    testAttr: 'vm-engine-tests',
    missing: missingVmExports,
    tests: runVmTests,
  });
  initDemo({
    data: vm,
    dir: 'projects/vm',
    tabs: '#vm-engine-tabs',
    frame: '#vm-demo-frame',
    url: '#vm-demo-url',
  });
  initBench({
    data: vm,
    dir: 'projects/vm',
    button: '#vm-bench-btn',
    status: '#vm-bench-status',
    table: '#vm-bench-table',
    protocolUrl: 'assets/protocol-vm.js',
  });
} else {
  const status = $('#vm-verify-status');
  if (status) status.textContent = 'data/vm.json недоступен — нужен локальный сервер';
}

if (projects) {
  renderProjects(projects.projects ?? projects);
}
