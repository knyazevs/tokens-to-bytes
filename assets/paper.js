import { missingExports, runTests } from './protocol.js';
import { benchIsolated, BENCH_PROTOCOL } from './bench-client.js';

const REPO = 'https://github.com/knyazevs/tokens-to-bytes';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const fmtInt = (n) => Number(n).toLocaleString('ru-RU');
const fmtBytes = (n) => `${fmtInt(n)} Б`;
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

let DATA = null;
let PROJECTS = null;

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
  const tables = { '#setup-table tbody': 4, '#results-table tbody': 7, '#spread-table tbody': 6 };
  for (const [sel, cols] of Object.entries(tables)) {
    const body = $(sel);
    if (body) body.innerHTML = `<tr><td colspan="${cols}" class="quiet">${message}</td></tr>`;
  }
  $('#size-chart').innerHTML = `<p class="quiet" style="margin:0">${message}</p>`;
  $('#verify-status').textContent = message;
  $('#bench-status').textContent = 'данные недоступны';
}

/* ── рендер ───────────────────────────────────────────────── */

function renderMeta(data) {
  const engines = data.engines;
  const min = engines.reduce((a, b) => (a.bytes <= b.bytes ? a : b));
  const manual = engines.find((e) => e.id === 'manual');
  const compiled = engines.filter((e) => e.id !== 'manual' && e.tokens);

  $('#kf-min').textContent = fmtBytes(min.bytes);
  if (manual?.tokens) $('#kf-tokens').textContent = fmtInt(manual.tokens.artifact);

  const statMin = $('[data-stat="min-bytes"]');
  if (statMin) statMin.textContent = fmtInt(min.bytes);

  const minGzip = engines.reduce((a, b) => (a.gzip <= b.gzip ? a : b));
  const statGzip = $('[data-stat="min-gzip"]');
  if (statGzip) statGzip.textContent = fmtInt(minGzip.gzip);

  const minBrotli = engines.reduce((a, b) => (a.brotli <= b.brotli ? a : b));
  const statBrotli = $('[data-stat="min-brotli"]');
  if (statBrotli) statBrotli.textContent = fmtInt(minBrotli.brotli);

  if (manual?.tokens && compiled.length) {
    const ratios = compiled.map((e) => manual.tokens.artifact / e.tokens.artifact);
    const lo = Math.min(...ratios);
    const hi = Math.max(...ratios);
    const stat = $('[data-stat="token-ratio"]');
    if (stat) stat.textContent = `${lo.toFixed(1).replace('.', ',')}–${hi.toFixed(1).replace('.', ',')}`;
  }

  const perfValues = engines.map((e) => e.perf.opsPerSec);
  const perfBest = Math.max(...perfValues);
  const perfWorst = Math.min(...perfValues);

  const spread = $('[data-stat="perf-spread"]');
  if (spread) spread.textContent = (perfBest / perfWorst).toFixed(2).replace('.', ',');

  const opsMin = $('[data-stat="ops-min"]');
  if (opsMin) opsMin.textContent = (perfWorst / 1e6).toFixed(1).replace('.', ',');

  const opsMax = $('[data-stat="ops-max"]');
  if (opsMax) opsMax.textContent = (perfBest / 1e6).toFixed(1).replace('.', ',');

  const spreads = engines
    .filter((e) => e.perf.stats?.median)
    .map((e) => (e.perf.stats.stddev / e.perf.stats.median) * 100);
  if (spreads.length) {
    const noiseMin = $('[data-stat="noise-min"]');
    if (noiseMin) noiseMin.textContent = Math.min(...spreads).toFixed(1).replace('.', ',');
    const noiseMax = $('[data-stat="noise-max"]');
    if (noiseMax) noiseMax.textContent = Math.max(...spreads).toFixed(1).replace('.', ',');
  }

  const samples = $('[data-stat="samples"]');
  if (samples) samples.textContent = fmtInt(engines[0]?.perf.samples?.length ?? 0);

  const cpp = engines.find((e) => e.id === 'cpp');
  const cppOpt = engines.find((e) => e.id === 'cpp-opt');
  if (cpp && cppOpt) {
    const gain = $('[data-stat="cpp-gain"]');
    if (gain) {
      gain.textContent = Math.round((cppOpt.perf.opsPerSec / cpp.perf.opsPerSec - 1) * 100);
    }
    const size = $('[data-stat="cpp-size"]');
    if (size) {
      size.textContent = Math.round((cppOpt.bytes / cpp.bytes - 1) * 100);
    }
  }

  const cpu = data.environment?.cpu ?? 'неизвестный CPU';
  const statCpu = $('[data-stat="cpu"]');
  if (statCpu) statCpu.textContent = cpu;

  const updated = dateRu(data.generatedAt);
  $('#updated').textContent = updated;
  $('#foot-updated').textContent = updated;

  const affinity = data.environment?.affinity;
  $('#results-env').textContent =
    `Node ${data.environment?.node ?? '—'} · ${data.environment?.platform ?? '—'} · ${cpu}` +
    (affinity ? ` · привязка к ядрам 0x${affinity}` : '') +
    ` · токенизатор ${data.environment?.tokenizer ?? '—'}`;
}

function sourceUrl(path) {
  return `${REPO}/blob/main/${path}`;
}

function renderSetup(data) {
  const body = $('#setup-table tbody');
  body.innerHTML = data.engines.map((e) => `
    <tr>
      <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
      <td style="text-align:left">${e.method}</td>
      <td style="text-align:left" class="quiet">${e.toolchain}</td>
      <td><a href="${sourceUrl(e.source)}">${e.source.split('/').pop()}</a></td>
    </tr>
  `).join('');
}

function metricValue(engine, metric) {
  return engine[metric];
}

function renderChart(data, metric) {
  const max = Math.max(...data.engines.map((e) => metricValue(e, metric)));
  $('#size-chart').innerHTML = data.engines.map((e) => {
    const value = metricValue(e, metric);
    return `
      <div class="chart-row">
        <span class="who">${e.name}</span>
        <span class="chart-bar"><i style="width:${pct(value, max)};background:${e.tone}"></i></span>
        <span class="val">${fmtBytes(value)}</span>
      </div>
    `;
  }).join('');
}

function renderResults(data) {
  const body = $('#results-table tbody');
  body.innerHTML = data.engines.map((e) => `
    <tr>
      <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
      <td class="strong">${fmtInt(e.bytes)}</td>
      <td>${fmtInt(e.gzip)}</td>
      <td>${fmtInt(e.brotli)}</td>
      <td data-engine-tests="${e.id}"><span class="pill ok">${e.tests.passed}/${e.tests.total}</span></td>
      <td>${fmtInt(e.perf.opsPerSec)}</td>
      <td>${e.tokens ? fmtInt(e.tokens.artifact) : '—'}</td>
    </tr>
  `).join('');
}

const fmtOps = (v) => `${(v / 1e6).toFixed(1).replace('.', ',')}M`;

function renderSpread(data) {
  const body = $('#spread-table tbody');
  if (!body) return;
  const rows = data.engines.filter((e) => e.perf.stats);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="quiet">Разброс не записан в данных.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((e) => {
    const s = e.perf.stats;
    return `
      <tr>
        <td><span class="dot-key" style="background:${e.tone}"></span><b>${e.name}</b></td>
        <td>${fmtOps(s.min)}</td>
        <td>${fmtOps(s.mean)}</td>
        <td class="strong">${fmtOps(s.median)}</td>
        <td>${fmtOps(s.max)}</td>
        <td class="quiet">${fmtOps(s.stddev)}</td>
      </tr>
    `;
  }).join('');
}

function renderScatter(data) {
  const svg = $('#scatter');
  const W = 640;
  const H = 300;
  const pad = { l: 46, r: 18, t: 16, b: 38 };
  const points = data.engines.filter((e) => e.tokens);
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
    <text x="${W - pad.r}" y="${H - 12}" text-anchor="end"></text>
    ${dots}
  `;
}

/* ── переключатель метрики ────────────────────────────────── */

let metric = 'bytes';
$$('.seg [data-metric]').forEach((btn) => {
  btn.addEventListener('click', () => {
    metric = btn.dataset.metric;
    $$('.seg [data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    if (DATA) renderChart(DATA, metric);
  });
});

/* ── проверка в браузере ──────────────────────────────────── */

async function loadEngineBytes(engine) {
  const res = await fetch(`projects/calculator/${engine.file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

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

$('#verify-btn').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  if (!DATA) return;
  btn.disabled = true;
  const status = $('#verify-status');
  let ok = 0;
  const problems = [];

  for (const engine of DATA.engines) {
    const cell = $(`[data-engine-tests="${engine.id}"]`);
    status.textContent = `проверяю ${engine.name}…`;
    status.classList.add('run');
    try {
      const exports = await instantiate(await loadEngineBytes(engine));
      const missing = missingExports(exports);
      if (missing.length) throw new Error(`нет экспортов: ${missing.join(', ')}`);
      const tests = runTests(exports);
      if (tests.passed === tests.total) {
        ok++;
        if (cell) cell.innerHTML = `<span class="pill ok">${tests.passed}/${tests.total}</span>`;
      } else {
        problems.push(`${engine.name}: ${tests.failures.join('; ')}`);
        if (cell) cell.innerHTML = `<span class="pill bad">${tests.passed}/${tests.total}</span>`;
      }
    } catch (err) {
      problems.push(`${engine.name}: ${err.message}`);
      if (cell) cell.innerHTML = `<span class="pill bad">FAIL</span>`;
    }
  }

  status.classList.remove('run');
  status.textContent = problems.length
    ? `ошибки: ${problems.join(' · ')}`
    : `все ${ok} сборок прошли ${DATA.engines[0].tests.total}/${DATA.engines[0].tests.total} тестов в браузере`;
  btn.disabled = false;
});

/* ── живой бенчмарк ───────────────────────────────────────── */

$('#bench-btn').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  if (!DATA) return;
  btn.disabled = true;
  const status = $('#bench-status');
  status.classList.add('run');

  const engines = DATA.engines.map((engine) => ({
    ...engine,
    url: `projects/calculator/${engine.file}`,
  }));

  const rows = await benchIsolated(engines, {
    onProgress: ({ index, total, engine }) => {
      status.textContent = `измеряю ${engine.name} (${index + 1}/${total})…`;
    },
  });

  const ok = rows.filter((r) => r.ok && r.perf);
  const best = ok.length ? Math.max(...ok.map((r) => r.perf.opsPerSec)) : 0;

  $('#bench-table tbody').innerHTML = rows.map((r) => {
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

  status.classList.remove('run');
  status.textContent = `готово · ${new Date().toLocaleTimeString('ru-RU')} · ${BENCH_PROTOCOL.rounds} раундов на сборку, отдельный Worker`;
  btn.disabled = false;
});

/* ── демо ─────────────────────────────────────────────────── */

function selectEngine(engines, id) {
  const engine = engines.find((e) => e.id === id) ?? engines[0];
  const frame = $('#demo-frame');
  const url = engine.id === 'manual'
    ? 'projects/calculator/index.html'
    : `projects/calculator/index.html?engine=${engine.file}`;
  frame.src = url;
  $('#demo-url').textContent = url;
  $$('#engine-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.engine === engine.id)));
}

function renderDemo(data) {
  const tabs = $('#engine-tabs');
  tabs.innerHTML = data.engines.map((e) => `
    <button type="button" data-engine="${e.id}" aria-pressed="${e.id === 'manual'}">
      <span class="dot-key" style="background:${e.tone}"></span>${e.name}
    </button>
  `).join('');
  tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-engine]');
    if (btn) selectEngine(data.engines, btn.dataset.engine);
  });
  selectEngine(data.engines, 'manual');
}

/* ── проекты ──────────────────────────────────────────────── */

function renderProjects(projects) {
  const wrap = $('#projects');
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

try {
  const [calculator, projects] = await Promise.all([
    loadJson('data/calculator.json'),
    loadJson('data/projects.json'),
  ]);
  DATA = calculator;
  PROJECTS = projects;
  renderMeta(calculator);
  renderSetup(calculator);
  renderResults(calculator);
  renderSpread(calculator);
  renderChart(calculator, metric);
  renderScatter(calculator);
  renderDemo(calculator);
  renderProjects(projects.projects ?? projects);
} catch (err) {
  fail(`Не удалось загрузить измерения: ${err.message}. Откройте статью через локальный сервер.`);
}
