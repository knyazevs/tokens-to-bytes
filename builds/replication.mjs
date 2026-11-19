// Контролируемая репликация: один и тот же контракт калькулятора,
// который генерируют разные модели с логированием итераций и дефектов.
//
//   node builds/replication.mjs setup  <каталог>            песочница для модели
//   node builds/replication.mjs verify <каталог>            независимая проверка
//   node builds/replication.mjs collect <каталог> [...]     data/replication.json
//
// Песочница содержит только спецификацию, протокол тестов и помощник сборки.
// Исходный эталонный код в неё не копируется.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clang = process.env.CLANG || path.join(
  root,
  '.tools/node_modules/@lasm/emscripten-win32-x64/tools/emscripten-6.0.9-win32-x64-tools/bin/clang.exe',
);
const MODEL_NAMES = {
  'repl-deepseek': 'deepseek-v4.1-flash-free',
  'repl-flint': 'flint-40b-free',
  'repl-mimo': 'mimo-v2.6-flash-free',
};

const SPEC = `# Задача: реализовать калькулятор на C как WebAssembly-модуль

Напишите один файл \`calc.c\` в ЭТОМ каталоге. Не читайте файлы вне этого каталога
(кроме системных утилит и toolchain) и не ищите готовую реализацию в репозитории.

## Что нужно экспортировать

\`clear\`, \`ce\`, \`digit\`, \`dot\`, \`back\`, \`neg\`, \`op\`, \`equals\`,
\`display\`, \`acc\`, \`cur\`, \`opCode\`, \`error\`, \`fresh\`, \`lastOp\`,
\`operand\`, \`leftOperand\` и память. Сигнатуры:

- \`void clear(void)\`, \`void ce(void)\`, \`void digit(int)\`, \`void dot(void)\`
- \`void back(void)\`, \`void neg(void)\`, \`void op(int)\`, \`void equals(void)\`
- \`double display(void)\`, \`double acc(void)\`, \`double cur(void)\`
- \`int opCode(void)\`, \`int error(void)\`, \`int fresh(void)\`, \`int lastOp(void)\`
- \`double operand(void)\`, \`double leftOperand(void)\`

Коды операции: 1 = сложение, 2 = вычитание, 3 = умножение, 4 = деление.

## Поведение

- Состояние: аккумулятор \`acc\`, текущий ввод \`cur\`, отложенная операция \`opCode\`,
  последняя применённая операция \`lastOp\`, флаг ошибки, флаг «ожидаем новый ввод»
  и два последних операнда \`leftOperand\`/\`operand\`.
- \`clear\` сбрасывает всё, включая \`lastOp\` и операнды.
- \`digit(n)\` добавляет цифру к текущему вводу. Если ввод только что начат или была
  ошибка, ввод начинается заново. Цифры после точки увеличивают дробную часть;
  знак текущего ввода сохраняется.
- \`dot\` включает дробный режим; повторная точка ничего не меняет.
- \`back\` удаляет последнюю цифру, корректно обрабатывая дробную часть и одиночную
  точку. После ошибки \`back\` сбрасывает всё.
- \`neg\` меняет знак текущего ввода. Если ввод ожидается после операции, меняется
  знак аккумулятора.
- \`op(code)\`: если отложенная операция уже есть и пользователь успел ввести число,
  она применяется к аккумулятору и текущему вводу; затем сохраняется новая операция
  и ввод начинается заново. Если отложенной операции нет, аккумулятор принимает
  текущий ввод.
- \`equals\`: применяет отложенную операцию, запоминает \`leftOperand\` (аккумулятор до
  операции) и \`operand\` (правый операнд), сбрасывает отложенную операцию и готовит
  новый ввод. Повторное \`equals\` сразу после результата повторяет последнюю
  операцию с последним правым операндом.
- Деление на ноль устанавливает \`error = 1\` и обнуляет аккумулятор. Любой следующий
  \`digit\`, \`dot\` или \`op\` сбрасывает состояние.
- \`display\`: если операция отложена и ввод ещё не начат, показывает аккумулятор,
  иначе текущий ввод.
- \`fresh\` = 1, когда ожидается новый ввод.
- Сравнение чисел в тестах — с точностью 1e-9.

## Как работать

После КАЖДОГО изменения файла запускайте:

\`node build-test.mjs "краткая заметка, что исправлено"\`

Помощник компилирует \`calc.c\`, прогоняет 17 тестов из \`protocol.js\` и дописывает
запись в \`dev-log.json\`. Если тесты падают, в записи будут номера упавших сценариев.
Ваша цель — добиться 17/17 минимальным числом итераций и записать в заметках,
какой именно дефект был исправлен. Не редактируйте \`protocol.js\`, \`build-test.mjs\`
и \`dev-log.json\` вручную.
`;

const HELPER = `// Сборка и тест одной итерации. Вызов:
//   node build-test.mjs ["заметка"]
// Результат (успех/падение и номер теста) дописывается в dev-log.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests, REQUIRED_EXPORTS } from './protocol.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'calc.c');
const wasm = path.join(dir, 'calc.wasm');
const logFile = path.join(dir, 'dev-log.json');
const note = process.argv[2] ?? '';
const clang = ${JSON.stringify(clang)};

let record = { note, compiled: false, passed: 0, total: 17, failures: [], error: null };
try {
  if (!fs.existsSync(src)) throw new Error('calc.c не создан');
  const args = [
    '--target=wasm32', '-nostdlib', '-Wl,--no-entry', '-Wl,--strip-all',
    '-Wl,--export-memory', '-Oz',
    ...REQUIRED_EXPORTS.map((name) => \`-Wl,--export=\${name}\`),
    '-o', wasm, src,
  ];
  const build = spawnSync(clang, args, { encoding: 'utf8' });
  if (build.status !== 0) throw new Error((build.stderr || build.stdout || 'clang failed').trim().slice(0, 1200));
  record.compiled = true;
  const bytes = fs.readFileSync(wasm);
  if (!WebAssembly.validate(bytes)) throw new Error('invalid wasm');
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const tests = runTests(instance.exports);
  record.passed = tests.passed;
  record.total = tests.total;
  record.failures = tests.failures ?? [];
} catch (err) {
  record.error = String(err.message ?? err).slice(0, 1200);
}

const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : { iterations: [] };
record.seq = log.iterations.length + 1;
record.time = new Date().toISOString();
log.iterations.push(record);
fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\\n');

console.log(JSON.stringify(record));
if (!record.compiled || record.passed !== record.total) process.exitCode = 1;
`;

function setup(dir) {
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(root, 'assets', 'protocol.js'), path.join(target, 'protocol.js'));
  fs.writeFileSync(path.join(target, 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(target, 'build-test.mjs'), HELPER);
  fs.writeFileSync(path.join(target, 'dev-log.json'), JSON.stringify({ iterations: [] }, null, 2) + '\n');
  console.log(`песочница: ${target}`);
}

function verify(dir) {
  const target = path.resolve(dir);
  const result = spawnSync(process.execPath, [path.join(target, 'build-test.mjs'), 'проверка репликации'], {
    cwd: target,
    encoding: 'utf8',
  });
  // Проверка не должна портить журнал модели: убираем последнюю запись.
  const logFile = path.join(target, 'dev-log.json');
  if (fs.existsSync(logFile)) {
    const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    log.iterations = log.iterations.filter((r) => r.note !== 'проверка репликации');
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
  }
  const text = (result.stdout || '').trim().split('\n').at(-1) ?? '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
  console.log(JSON.stringify({
    compiled: parsed.compiled ?? false,
    passed: parsed.passed ?? 0,
    total: parsed.total ?? 17,
    failures: parsed.failures ?? [],
    error: parsed.error ?? null,
    bytes: fs.existsSync(path.join(target, 'calc.wasm')) ? fs.statSync(path.join(target, 'calc.wasm')).size : 0,
  }));
  if (result.status !== 0 && !parsed.compiled) process.exitCode = 1;
}

function collect(dirs) {
  const runs = dirs.map((dir) => {
    const target = path.resolve(dir);
    const name = path.basename(target);
    const source = path.join(target, 'calc.c');
    const log = JSON.parse(fs.readFileSync(path.join(target, 'dev-log.json'), 'utf8'));
    const iterations = log.iterations;
    const code = fs.readFileSync(source, 'utf8');
    const failed = iterations.filter((r) => !r.compiled || r.passed !== r.total);
    return {
      model: MODEL_NAMES[name] ?? name,
      artifactTokens: countTokens(code),
      authoringBytes: Buffer.byteLength(code),
      iterations: iterations.length,
      failedIterations: failed.length,
      distinctDefects: [...new Set(failed.map((r) => {
        if (r.error) return 'ошибка компиляции';
        const detail = (r.failures ?? []).join(' | ');
        return detail || r.note || 'недокументированный провал';
      }))],
      final: iterations.at(-1) ?? null,
      log: iterations,
    };
  });
  const outFile = path.join(root, 'data', 'replication.json');
  const result = {
    generatedAt: new Date().toISOString(),
    task: 'calculator in C, 17 shared tests, isolated sandbox without the reference source',
    tokenizer: 'o200k_base',
    runs,
  };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  console.log(`записано: ${path.relative(root, outFile)}`);
  for (const r of runs) {
    console.log(`${r.model}: итераций ${r.iterations}, провалов ${r.failedIterations}, токенов ${r.artifactTokens}, финал ${r.final?.passed ?? 0}/${r.final?.total ?? 17}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'setup') setup(args[0]);
else if (cmd === 'verify') verify(args[0]);
else if (cmd === 'collect') collect(args);
else throw new Error('нужна команда: setup | verify | collect');
