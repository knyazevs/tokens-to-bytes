// Ассемблер стековой VM: текстовый исходник → байткод.
//
// Формат инструкции — 4 байта: [op, x, y, z].
//   PUSH imm            imm — знаковое 24-битное число в x,y,z (старший байт первый)
//   JMP/JZ/JNZ/CALL t   t — номер инструкции в x | y<<8 (0..65535)
//   LOADL/STOREL n      n — индекс локала 0..7 в x
//
// Синтаксис: по одной инструкции на строку, метки вида `name:`, комментарии
// после `;`. Регистр команд не важен. Ассемблер общий для тестов, нагрузки и
// демо-страницы: он не входит в измеряемую операцию.

export const OPS = {
  PUSH: 1,
  POP: 2,
  DUP: 3,
  SWAP: 4,
  ADD: 5,
  SUB: 6,
  MUL: 7,
  DIV: 8,
  MOD: 9,
  NEG: 10,
  EQ: 11,
  NE: 12,
  LT: 13,
  LE: 14,
  GT: 15,
  GE: 16,
  AND: 17,
  OR: 18,
  NOT: 19,
  JMP: 20,
  JZ: 21,
  JNZ: 22,
  LOADL: 23,
  STOREL: 24,
  CALL: 25,
  RET: 26,
  HALT: 27,
};

export const OP_NAMES = Object.fromEntries(Object.entries(OPS).map(([name, code]) => [code, name]));

const NO_ARG = new Set(['POP', 'DUP', 'SWAP', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NEG',
  'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'AND', 'OR', 'NOT', 'RET', 'HALT']);
const JUMP = new Set(['JMP', 'JZ', 'JNZ', 'CALL']);
const LOCAL = new Set(['LOADL', 'STOREL']);

const LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

export function assemble(source) {
  const labels = new Map();
  const items = [];
  const lines = String(source).split(/\r?\n/);

  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].replace(/;.*$/, '').trim();
    if (!line) continue;

    let label;
    while ((label = line.match(LABEL_RE))) {
      const name = label[1];
      if (labels.has(name)) throw new Error(`строка ${n + 1}: метка «${name}» уже определена`);
      labels.set(name, items.length);
      line = line.slice(label[0].length).trim();
    }
    if (!line) continue;

    const [rawOp, ...rest] = line.split(/\s+/);
    const op = rawOp.toUpperCase();
    if (!(op in OPS)) throw new Error(`строка ${n + 1}: неизвестная команда «${rawOp}»`);

    let arg = null;
    if (NO_ARG.has(op)) {
      if (rest.length) throw new Error(`строка ${n + 1}: у ${op} не должно быть аргумента`);
    } else {
      if (rest.length !== 1) throw new Error(`строка ${n + 1}: ${op} требует ровно один аргумент`);
      arg = rest[0];
    }
    items.push({ op, arg, line: n + 1 });
  }

  if (!items.length) throw new Error('пустая программа');
  if (items.length > 4096) throw new Error(`программа длиннее 4096 инструкций: ${items.length}`);

  const code = new Uint8Array(items.length * 4);

  for (let i = 0; i < items.length; i++) {
    const { op, arg, line } = items[i];
    const base = i * 4;
    code[base] = OPS[op];

    if (op === 'PUSH') {
      const value = Number(arg);
      if (!Number.isInteger(value) || value < -0x800000 || value > 0x7fffff) {
        throw new Error(`строка ${line}: PUSH ждёт целое в диапазоне −8 388 608…8 388 607`);
      }
      const bits = value & 0xffffff;
      code[base + 1] = (bits >> 16) & 0xff;
      code[base + 2] = (bits >> 8) & 0xff;
      code[base + 3] = bits & 0xff;
    } else if (JUMP.has(op)) {
      let target;
      if (/^-?\d+$/.test(arg)) target = Number(arg);
      else if (labels.has(arg)) target = labels.get(arg);
      else throw new Error(`строка ${line}: неизвестная метка «${arg}»`);
      if (!Number.isInteger(target) || target < 0 || target > 0xffff) {
        throw new Error(`строка ${line}: адрес перехода вне диапазона 0…65535`);
      }
      code[base + 1] = target & 0xff;
      code[base + 2] = (target >> 8) & 0xff;
    } else if (LOCAL.has(op)) {
      const index = Number(arg);
      if (!Number.isInteger(index) || index < 0 || index > 7) {
        throw new Error(`строка ${line}: локал должен быть 0…7`);
      }
      code[base + 1] = index;
    }
  }

  return { code, instructions: items.length, labels };
}

// Обратная операция для демо и отладки: инструкция → мнемоника.
export function disassemble(code, instructions) {
  const out = [];
  for (let i = 0; i < instructions; i++) {
    const base = i * 4;
    const op = code[base];
    const name = OP_NAMES[op] ?? `OP${op}`;
    if (op === OPS.PUSH) {
      let value = (code[base + 1] << 16) | (code[base + 2] << 8) | code[base + 3];
      if (value & 0x800000) value -= 0x1000000;
      out.push(`${name} ${value}`);
    } else if (op === OPS.JMP || op === OPS.JZ || op === OPS.JNZ || op === OPS.CALL) {
      out.push(`${name} ${code[base + 1] | (code[base + 2] << 8)}`);
    } else if (op === OPS.LOADL || op === OPS.STOREL) {
      out.push(`${name} ${code[base + 1]}`);
    } else {
      out.push(name);
    }
  }
  return out;
}
