// Протокол стековой VM: общий API, тесты и нагрузка для Node и браузера.
// Программа — массив 4-байтных инструкций в памяти модуля. Каждый запуск
// vm_run начинает с чистого стека и нулевых локалов главного кадра.
//
// API:
//   vm_code_ptr() -> i32   буфер программы (4096 инструкций × 4 байта)
//   vm_load(n) -> i32      0 — программа принята, иначе код ошибки
//   vm_run(limit) -> i32   0 — HALT, -1 — ошибка; limit ≤ 0 → 1 000 000 шагов
//   vm_result() -> i32     вершина стека на момент остановки (0, если пусто)
//   vm_depth() -> i32      глубина стека значений
//   vm_error() -> i32      код последней ошибки
//   vm_pc() -> i32         номер инструкции, на которой встали
//   vm_steps() -> i32      исполненных инструкций в последнем запуске
//
// ISA: PUSH POP DUP SWAP ADD SUB MUL DIV MOD NEG EQ NE LT LE GT GE AND OR NOT
//      JMP JZ JNZ LOADL STOREL CALL RET HALT. Только i32. Локалы — 8 на кадр,
//      кадров — 128, стек значений — 1024. Памяти данных и плавающих чисел нет.

import { benchmarkWorkload, describeStats } from './bench-core.js';
import { assemble, OPS } from './vm-asm.js';

export const REQUIRED_EXPORTS = [
  'vm_code_ptr', 'vm_load', 'vm_run', 'vm_result',
  'vm_depth', 'vm_error', 'vm_pc', 'vm_steps',
];

export const CODE_CAP = 4096;
export const STACK_CAP = 1024;
export const FRAME_CAP = 128;
export const LOCALS = 8;
export const STEP_CAP = 1000000;

export const ERR = {
  none: 0,
  opcode: 1,
  underflow: 2,
  overflow: 3,
  calls: 4,
  zero: 5,
  target: 6,
  steps: 7,
  codeLen: 8,
  notLoaded: 9,
  local: 10,
  ret: 11,
  empty: 12,
};

// Программы: ассемблерный текст и ожидаемый результат. Одна и та же запись
// компилируется для тестов, нагрузки и демо-страницы.
export const PROGRAMS = [
  {
    name: 'одно число',
    asm: `
      PUSH 42
      HALT
    `,
    result: 42,
  },
  {
    name: 'сложение и умножение',
    asm: `
      PUSH 2
      PUSH 3
      PUSH 4
      MUL
      ADD
      HALT
    `,
    result: 14,
  },
  {
    name: 'вычитание',
    asm: `
      PUSH 3
      PUSH 10
      SUB
      HALT
    `,
    result: -7,
  },
  {
    name: 'деление',
    asm: `
      PUSH 17
      PUSH 5
      DIV
      HALT
    `,
    result: 3,
  },
  {
    name: 'остаток',
    asm: `
      PUSH 17
      PUSH 5
      MOD
      HALT
    `,
    result: 2,
  },
  {
    name: 'знаковое деление',
    asm: `
      PUSH -7
      PUSH 2
      DIV
      HALT
    `,
    result: -3,
  },
  {
    name: 'знаковый остаток',
    asm: `
      PUSH -7
      PUSH 2
      MOD
      HALT
    `,
    result: -1,
  },
  {
    name: 'смена знака',
    asm: `
      PUSH 5
      NEG
      HALT
    `,
    result: -5,
  },
  {
    name: 'шесть сравнений',
    asm: `
      PUSH 3
      PUSH 5
      LT
      PUSH 5
      PUSH 5
      LE
      PUSH 5
      PUSH 3
      GT
      PUSH 3
      PUSH 3
      GE
      PUSH 4
      PUSH 4
      EQ
      PUSH 4
      PUSH 5
      NE
      ADD
      ADD
      ADD
      ADD
      ADD
      HALT
    `,
    result: 6,
  },
  {
    name: 'swap',
    asm: `
      PUSH 1
      PUSH 2
      SWAP
      SUB
      HALT
    `,
    result: 1,
  },
  {
    name: 'dup',
    asm: `
      PUSH 7
      DUP
      MUL
      HALT
    `,
    result: 49,
  },
  {
    name: 'локалы',
    asm: `
      PUSH 7
      STOREL 0
      LOADL 0
      PUSH 3
      MUL
      HALT
    `,
    result: 21,
  },
  {
    name: 'сумма 1…10',
    asm: `
      PUSH 0
      STOREL 0
      PUSH 1
      STOREL 1
    loop:
      LOADL 1
      PUSH 11
      LT
      JZ done
      LOADL 0
      LOADL 1
      ADD
      STOREL 0
      LOADL 1
      PUSH 1
      ADD
      STOREL 1
      JMP loop
    done:
      LOADL 0
      HALT
    `,
    result: 55,
  },
  {
    name: '10!',
    asm: `
      PUSH 1
      STOREL 0
      PUSH 10
      STOREL 1
    loop:
      LOADL 1
      PUSH 1
      GT
      JZ done
      LOADL 0
      LOADL 1
      MUL
      STOREL 0
      LOADL 1
      PUSH 1
      SUB
      STOREL 1
      JMP loop
    done:
      LOADL 0
      HALT
    `,
    result: 3628800,
  },
  {
    name: '5!',
    asm: `
      PUSH 1
      STOREL 0
      PUSH 5
      STOREL 1
    loop:
      LOADL 1
      PUSH 1
      GT
      JZ done
      LOADL 0
      LOADL 1
      MUL
      STOREL 0
      LOADL 1
      PUSH 1
      SUB
      STOREL 1
      JMP loop
    done:
      LOADL 0
      HALT
    `,
    result: 120,
  },
  {
    name: 'fib(18) рекурсией',
    asm: `
      PUSH 18
      CALL fib
      HALT
    fib:
      STOREL 0
      LOADL 0
      PUSH 2
      LT
      JZ rec
      LOADL 0
      RET
    rec:
      LOADL 0
      PUSH 1
      SUB
      CALL fib
      LOADL 0
      PUSH 2
      SUB
      CALL fib
      ADD
      RET
    `,
    result: 2584,
  },
  {
    name: 'НОД(1071, 462)',
    asm: `
      PUSH 1071
      PUSH 462
      CALL gcd
      HALT
    gcd:
      STOREL 1
      STOREL 0
      LOADL 1
      JZ base
      LOADL 1
      LOADL 0
      LOADL 1
      MOD
      CALL gcd
      RET
    base:
      LOADL 0
      RET
    `,
    result: 21,
  },
  {
    name: 'сумма квадратов 1…100',
    asm: `
      PUSH 0
      STOREL 0
      PUSH 1
      STOREL 1
    loop:
      LOADL 1
      PUSH 101
      LT
      JZ done
      LOADL 0
      LOADL 1
      LOADL 1
      MUL
      ADD
      STOREL 0
      LOADL 1
      PUSH 1
      ADD
      STOREL 1
      JMP loop
    done:
      LOADL 0
      HALT
    `,
    result: 338350,
  },
  {
    name: '3^13',
    asm: `
      PUSH 1
      STOREL 0
      PUSH 13
      STOREL 1
    loop:
      LOADL 1
      JZ done
      LOADL 0
      PUSH 3
      MUL
      STOREL 0
      LOADL 1
      PUSH 1
      SUB
      STOREL 1
      JMP loop
    done:
      LOADL 0
      HALT
    `,
    result: 1594323,
  },
  {
    name: 'Коллатц(27)',
    asm: `
      PUSH 0
      STOREL 1
      PUSH 27
      STOREL 0
    loop:
      LOADL 0
      PUSH 1
      EQ
      JNZ done
      LOADL 0
      PUSH 2
      MOD
      JZ even
      LOADL 0
      PUSH 3
      MUL
      PUSH 1
      ADD
      STOREL 0
      JMP inc
    even:
      LOADL 0
      PUSH 2
      DIV
      STOREL 0
    inc:
      LOADL 1
      PUSH 1
      ADD
      STOREL 1
      JMP loop
    done:
      LOADL 1
      HALT
    `,
    result: 111,
  },
  {
    name: 'простые до 200',
    asm: `
      PUSH 0
      STOREL 0
      PUSH 2
      STOREL 1
    outer:
      LOADL 1
      PUSH 201
      LT
      JZ done
      PUSH 1
      STOREL 2
      PUSH 2
      STOREL 3
    inner:
      LOADL 3
      LOADL 1
      LT
      JZ inner_done
      LOADL 1
      LOADL 3
      MOD
      JNZ next_d
      PUSH 0
      STOREL 2
      JMP inner_done
    next_d:
      LOADL 3
      PUSH 1
      ADD
      STOREL 3
      JMP inner
    inner_done:
      LOADL 2
      JZ skip
      LOADL 0
      PUSH 1
      ADD
      STOREL 0
    skip:
      LOADL 1
      PUSH 1
      ADD
      STOREL 1
      JMP outer
    done:
      LOADL 0
      HALT
    `,
    result: 46,
  },
  {
    name: 'Аккерман(2, 3)',
    asm: `
      PUSH 2
      PUSH 3
      CALL ack
      HALT
    ack:
      STOREL 1
      STOREL 0
      LOADL 0
      JZ m_zero
      LOADL 1
      JZ n_zero
      LOADL 0
      PUSH 1
      SUB
      LOADL 0
      LOADL 1
      PUSH 1
      SUB
      CALL ack
      CALL ack
      RET
    n_zero:
      LOADL 0
      PUSH 1
      SUB
      PUSH 1
      CALL ack
      RET
    m_zero:
      LOADL 1
      PUSH 1
      ADD
      RET
    `,
    result: 9,
  },
  {
    name: 'логика',
    asm: `
      PUSH 1
      PUSH 0
      AND
      PUSH 1
      PUSH 0
      OR
      PUSH 0
      NOT
      ADD
      ADD
      HALT
    `,
    result: 2,
  },
  {
    name: 'два вызова подряд',
    asm: `
      PUSH 41
      CALL inc
      CALL inc
      HALT
    inc:
      STOREL 0
      LOADL 0
      PUSH 1
      ADD
      RET
    `,
    result: 43,
  },
  {
    name: 'глубина 100',
    asm: `
      PUSH 100
      CALL sum
      HALT
    sum:
      STOREL 0
      LOADL 0
      JZ base
      LOADL 0
      LOADL 0
      PUSH 1
      SUB
      CALL sum
      ADD
      RET
    base:
      PUSH 0
      RET
    `,
    result: 5050,
  },
  {
    name: 'локалы кадра изолированы',
    asm: `
      PUSH 5
      STOREL 0
      PUSH 9
      CALL setlocal
      LOADL 0
      HALT
    setlocal:
      STOREL 0
      PUSH 100
      STOREL 0
      RET
    `,
    result: 5,
  },
  {
    name: 'JZ пропускает ветку',
    asm: `
      PUSH 0
      JZ yes
      PUSH 1
      HALT
    yes:
      PUSH 2
      HALT
    `,
    result: 2,
  },
  {
    name: 'биты 2026',
    asm: `
      PUSH 2026
      STOREL 0
      PUSH 0
      STOREL 1
    loop:
      LOADL 0
      JZ done
      LOADL 0
      PUSH 2
      MOD
      LOADL 1
      ADD
      STOREL 1
      LOADL 0
      PUSH 2
      DIV
      STOREL 0
      JMP loop
    done:
      LOADL 1
      HALT
    `,
    result: 8,
  },
  {
    name: 'сумма цифр 987654',
    asm: `
      PUSH 987654
      STOREL 0
      PUSH 0
      STOREL 1
    loop:
      LOADL 0
      JZ done
      LOADL 0
      PUSH 10
      MOD
      LOADL 1
      ADD
      STOREL 1
      LOADL 0
      PUSH 10
      DIV
      STOREL 0
      JMP loop
    done:
      LOADL 1
      HALT
    `,
    result: 39,
  },
  {
    name: 'INT_MIN / −1',
    asm: `
      PUSH -8388608
      PUSH 256
      MUL
      PUSH -1
      DIV
      HALT
    `,
    result: -2147483648,
  },
  {
    name: 'максимум из двух',
    asm: `
      PUSH 17
      STOREL 0
      PUSH 42
      STOREL 1
      LOADL 0
      LOADL 1
      LT
      JZ else
      LOADL 1
      HALT
    else:
      LOADL 0
      HALT
    `,
    result: 42,
  },
];

for (const program of PROGRAMS) {
  const { code, instructions } = assemble(program.asm);
  program.code = code;
  program.instructions = instructions;
}

const PUSH = OPS.PUSH;
const encode = (op, x = 0, y = 0, z = 0) => [op, x, y, z];

// Некорректные программы: (байткод, код ошибки, pc). Часть ошибок ловится
// vm_load (неизвестный опкод, адрес перехода, локал), часть — во время vm_run.
export const INVALID = [
  { name: 'неизвестный опкод', bytes: [encode(99)], code: ERR.opcode, pc: 0, phase: 'load' },
  { name: 'неизвестный опкод в середине', bytes: [encode(PUSH, 0, 0, 1), encode(99), encode(27)], code: ERR.opcode, pc: 1, phase: 'load' },
  { name: 'переход за программу', bytes: [encode(20, 99), encode(27)], code: ERR.target, pc: 0, phase: 'load' },
  { name: 'вызов за программу', bytes: [encode(PUSH, 0, 0, 1), encode(25, 5), encode(27)], code: ERR.target, pc: 1, phase: 'load' },
  { name: 'ветка за программу', bytes: [encode(22, 9), encode(27)], code: ERR.target, pc: 0, phase: 'load' },
  { name: 'локал 8', bytes: [encode(23, 8), encode(27)], code: ERR.local, pc: 0, phase: 'load' },
  { name: 'запись в локал 9', bytes: [encode(PUSH, 0, 0, 1), encode(24, 9), encode(27)], code: ERR.local, pc: 1, phase: 'load' },
  { name: 'пустой стек', bytes: [encode(2), encode(27)], code: ERR.underflow, pc: 0, phase: 'run' },
  { name: 'запись без значения', bytes: [encode(24, 0), encode(27)], code: ERR.underflow, pc: 0, phase: 'run' },
  { name: 'деление на ноль', bytes: [encode(PUSH, 0, 0, 1), encode(PUSH, 0, 0, 0), encode(8), encode(27)], code: ERR.zero, pc: 2, phase: 'run' },
  { name: 'RET без CALL', bytes: [encode(26)], code: ERR.ret, pc: 0, phase: 'run' },
  { name: 'переполнение кадров', bytes: [encode(25, 0), encode(27)], code: ERR.calls, pc: 0, phase: 'run' },
  {
    name: 'переполнение стека',
    bytes: Array.from({ length: STACK_CAP + 1 }, () => encode(PUSH, 0, 0, 1)).concat([encode(27, 0, 0, 0)]),
    code: ERR.overflow,
    pc: STACK_CAP,
    phase: 'run',
  },
];

export function missingExports(w) {
  const missing = REQUIRED_EXPORTS.filter((name) => typeof w[name] !== 'function');
  if (!(w.memory instanceof WebAssembly.Memory)) missing.push('memory');
  return missing;
}

function writeCode(w, bytes, instructions) {
  const mem = new Uint8Array(w.memory.buffer);
  const ptr = w.vm_code_ptr();
  if (ptr < 0 || ptr + instructions * 4 > mem.length) throw new Error('code buffer does not fit');
  mem.set(bytes, ptr);
}

function loadProgram(w, program) {
  writeCode(w, program.code, program.instructions);
  return w.vm_load(program.instructions);
}

export function runTests(w) {
  const failures = [];
  let passed = 0;

  // 1. Запуск до загрузки: ошибка 9.
  try {
    const result = w.vm_run(STEP_CAP);
    if (result !== -1 || w.vm_error() !== ERR.notLoaded) {
      failures.push(`not-loaded: run ${result}, error ${w.vm_error()} (expected -1/9)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`not-loaded: ${err.message}`);
  }

  // 2. Пустая программа: ошибка 12.
  try {
    const code = w.vm_load(0);
    if (code !== ERR.empty || w.vm_error() !== ERR.empty) {
      failures.push(`empty: load ${code}, error ${w.vm_error()} (expected 12)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`empty: ${err.message}`);
  }

  // 3. Программа длиннее буфера: ошибка 8 без чтения байтов.
  try {
    const code = w.vm_load(CODE_CAP + 1);
    if (code !== ERR.codeLen || w.vm_error() !== ERR.codeLen || w.vm_pc() !== 0) {
      failures.push(`code-too-long: ${code}/${w.vm_error()}/${w.vm_pc()} (expected 8/8/0)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`code-too-long: ${err.message}`);
  }

  // 4. Корректные программы: результат, глубина, шаги.
  for (let i = 0; i < PROGRAMS.length; i++) {
    const program = PROGRAMS[i];
    let problem = '';
    try {
      const code = loadProgram(w, program);
      if (code !== 0) problem = `load returned ${code} at ${w.vm_pc()}`;
      else {
        const result = w.vm_run(STEP_CAP);
        if (result !== 0) problem = `run ${result}, error ${w.vm_error()} at ${w.vm_pc()}`;
        else if (w.vm_result() !== program.result) problem = `result ${w.vm_result()} != ${program.result}`;
        else if (w.vm_depth() !== 1) problem = `depth ${w.vm_depth()} != 1`;
        else if (w.vm_steps() <= 0) problem = `steps ${w.vm_steps()}`;
        else if (w.vm_error() !== 0) problem = `error ${w.vm_error()}`;
      }
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`program #${i + 1} (${program.name}): ${problem}`);
    else passed++;
  }

  // 5. Некорректные программы: код ошибки и позиция.
  for (let i = 0; i < INVALID.length; i++) {
    const item = INVALID[i];
    let problem = '';
    try {
      writeCode(w, new Uint8Array(item.bytes.flat()), item.bytes.length);
      if (item.phase === 'load') {
        const code = w.vm_load(item.bytes.length);
        if (code !== item.code) problem = `load ${code} != ${item.code}`;
        else if (w.vm_error() !== item.code) problem = `error ${w.vm_error()} != ${item.code}`;
        else if (w.vm_pc() !== item.pc) problem = `pc ${w.vm_pc()} != ${item.pc}`;
      } else {
        const code = w.vm_load(item.bytes.length);
        if (code !== 0) problem = `load ${code}, expected a runtime error`;
        else {
          const result = w.vm_run(STEP_CAP);
          if (result !== -1) problem = `run ${result}, expected -1`;
          else if (w.vm_error() !== item.code) problem = `error ${w.vm_error()} != ${item.code}`;
          else if (w.vm_pc() !== item.pc) problem = `pc ${w.vm_pc()} != ${item.pc}`;
        }
      }
    } catch (err) {
      problem = err.message;
    }
    if (problem) failures.push(`invalid #${i + 1} (${item.name}): ${problem}`);
    else passed++;
  }

  // 6. Лимит шагов: бесконечный JMP 0 останавливается на cap, а не зависает.
  try {
    const program = { code: new Uint8Array([OPS.JMP, 0, 0, 0]), instructions: 1 };
    const code = loadProgram(w, program);
    const result = code === 0 ? w.vm_run(1000) : code;
    if (result !== -1 || w.vm_error() !== ERR.steps || w.vm_steps() !== 1000 || w.vm_pc() !== 0) {
      failures.push(`step-cap: ${result}/${w.vm_error()}/${w.vm_steps()}/${w.vm_pc()} (expected -1/7/1000/0)`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`step-cap: ${err.message}`);
  }

  // 7. Лимит по умолчанию: limit ≤ 0 — это 1 000 000 шагов.
  try {
    const code = loadProgram(w, PROGRAMS[0]);
    const result = code === 0 ? w.vm_run(0) : code;
    if (result !== 0 || w.vm_result() !== PROGRAMS[0].result || w.vm_steps() !== PROGRAMS[0].instructions) {
      failures.push(`default-cap: ${result}/${w.vm_result()}/${w.vm_steps()}`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`default-cap: ${err.message}`);
  }

  // 8. После ошибки загрузки модуль принимает новую программу.
  try {
    writeCode(w, new Uint8Array([99, 0, 0, 0]), 1);
    const bad = w.vm_load(1);
    const good = loadProgram(w, PROGRAMS[0]);
    const result = good === 0 ? w.vm_run(STEP_CAP) : good;
    if (bad !== ERR.opcode || result !== 0 || w.vm_result() !== PROGRAMS[0].result) {
      failures.push(`reload: ${bad}/${result}/${w.vm_result()}`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`reload: ${err.message}`);
  }

  // 9. После HALT pc стоит за последней инструкцией.
  try {
    const program = PROGRAMS[0];
    const code = loadProgram(w, program);
    const result = code === 0 ? w.vm_run(STEP_CAP) : code;
    if (result !== 0 || w.vm_pc() !== program.instructions) {
      failures.push(`pc-after-halt: ${result}/${w.vm_pc()}/${program.instructions}`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`pc-after-halt: ${err.message}`);
  }

  // 10. Повторный запуск той же программы: стек и локалы начинаются заново.
  try {
    const program = PROGRAMS.find((item) => item.name === '10!');
    const code = loadProgram(w, program);
    const first = code === 0 ? w.vm_run(STEP_CAP) : code;
    const firstResult = w.vm_result();
    const firstSteps = w.vm_steps();
    const second = w.vm_run(STEP_CAP);
    if (first !== 0 || second !== 0 || w.vm_result() !== firstResult || w.vm_steps() !== firstSteps) {
      failures.push(`repeat: ${first}/${second}/${firstResult}/${w.vm_result()}/${firstSteps}/${w.vm_steps()}`);
    } else {
      passed++;
    }
  } catch (err) {
    failures.push(`repeat: ${err.message}`);
  }

  return { passed, total: 8 + PROGRAMS.length + INVALID.length, failures };}

// Нагрузка: десять программ разного профиля — циклы, рекурсия, ветвления.
export const WORKLOAD = PROGRAMS.filter((program) => [
  '10!', 'fib(18) рекурсией', 'НОД(1071, 462)', 'сумма квадратов 1…100',
  '3^13', 'Коллатц(27)', 'простые до 200', 'Аккерман(2, 3)',
  'глубина 100', 'сумма цифр 987654',
].includes(program.name));

export const WORKLOAD_OPS = WORKLOAD.length;

let sink = 0;

export function runWorkload(w) {
  for (const program of WORKLOAD) {
    writeCode(w, program.code, program.instructions);
    const loaded = w.vm_load(program.instructions);
    const result = loaded === 0 ? w.vm_run(STEP_CAP) : -1;
    sink ^= result + w.vm_result() + w.vm_steps() + w.vm_error();
  }
}

export function benchmark(w, config) {
  return benchmarkWorkload(() => runWorkload(w), { ...config, opsPerPass: WORKLOAD_OPS });
}

export { describeStats };
