// Проверяет, что встроенная в демо копия ассемблера совпадает с общей
// assets/vm-asm.js на всех программах протокола и на примерах страницы.
//
//   node builds/check-vm-asm.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, disassemble } from '../assets/vm-asm.js';
import { PROGRAMS } from '../assets/protocol-vm.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(root, 'projects/vm/index.html');
const html = fs.readFileSync(pagePath, 'utf8');

const start = html.indexOf('    const OPS = {');
const end = html.indexOf('    const SAMPLES = [', start > 0 ? start : 0);
if (start < 0 || end < 0) {
  throw new Error(`не найден встроенный ассемблер в ${pagePath}`);
}

const snippet = html.slice(start, end);
let inline;
try {
  inline = new Function(`${snippet}\nreturn { assemble, disassemble };`)();
} catch (err) {
  throw new Error(`встроенный ассемблер не исполняется: ${err.message}`);
}

function sameCode(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const sources = PROGRAMS.map((p) => ({ label: `program: ${p.name}`, asm: p.asm }));

let checked = 0;
for (const item of sources) {
  const shared = assemble(item.asm);
  const local = inline.assemble(item.asm);

  if (shared.instructions !== local.instructions) {
    throw new Error(`${item.label}: инструкций ${local.instructions}, ожидалось ${shared.instructions}`);
  }
  if (!sameCode(shared.code, local.code)) {
    throw new Error(`${item.label}: байткод отличается от assets/vm-asm.js`);
  }

  const dShared = disassemble(shared.code, shared.instructions);
  const dLocal = inline.disassemble(local.code, local.instructions);
  if (dShared.join('\n') !== dLocal.join('\n')) {
    throw new Error(`${item.label}: дизассемблер расходится с assets/vm-asm.js`);
  }
  checked++;
}

// Примеры на странице тоже должны собираться встроенной копией.
const sampleBlock = html.slice(end, html.indexOf('    const ERROR_TEXT = {', end));
const sampleTexts = [...sampleBlock.matchAll(/text: `([\s\S]*?)`,\n/g)].map((m) => m[1]);
if (!sampleTexts.length) throw new Error('примеры на странице не найдены');
for (const [i, text] of sampleTexts.entries()) {
  try {
    inline.assemble(text);
  } catch (err) {
    throw new Error(`пример #${i + 1} не собирается: ${err.message}`);
  }
}

console.log(`ok: ${checked} программ протокола и ${sampleTexts.length} примеров совпали с assets/vm-asm.js`);
