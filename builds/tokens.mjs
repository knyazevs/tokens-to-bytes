// Считает токены артефактов: «стоимость» реализации в её естественной форме
// (исходник или WAT) и в форме base64-байткода.
//
//   node builds/tokens.mjs            калькулятор (по умолчанию)
//   node builds/tokens.mjs json       JSON-парсер
//
// Это НЕ стоимость генерации: output-токены модели нужно логировать в момент
// генерации (usage.output_tokens). См. раздел «Метод» в статье.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';
import { projectBySlug, PROJECTS } from './projects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = PROJECTS[process.argv[2]] ? process.argv[2] : 'calculator';
const project = projectBySlug(slug);
const outFile = path.join(root, project.tokens);

const engines = {};
for (const engine of project.engines) {
  const authoringPath = path.join(root, engine.authoring);
  const wasmPath = path.join(root, project.dir, engine.file);
  const authoring = fs.readFileSync(authoringPath, 'utf8');
  const binary = fs.readFileSync(wasmPath);

  engines[engine.id] = {
    authoringFile: engine.authoring,
    authoringBytes: Buffer.byteLength(authoring),
    artifactTokens: countTokens(authoring),
    binaryBase64Tokens: countTokens(binary.toString('base64')),
    binaryBytes: binary.length,
  };
}

const result = {
  tokenizer: 'o200k_base',
  generatedAt: new Date().toISOString(),
  note: 'artifactTokens — токены естественной формы артефакта (lower bound на стоимость генерации); binaryBase64Tokens — токены base64-представления wasm.',
  engines,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');

console.log('| Реализация | форма | байт | токенов | токенов base64 |');
console.log('|---|---|---:|---:|---:|');
for (const engine of project.engines) {
  const e = engines[engine.id];
  const label = path.basename(e.authoringFile);
  console.log(`| ${engine.name} | ${label} | ${e.authoringBytes} | ${e.artifactTokens} | ${e.binaryBase64Tokens} |`);
}
console.log(`\nзаписано: ${path.relative(root, outFile)}`);
