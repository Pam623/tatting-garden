// Checks every public pattern before publishing:  node scripts/check-patterns.mjs [folder]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPattern } from '../js/pattern.js';

const dir = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'patterns');
let failed = false;
const fail = (text) => {
  console.log(`BAD ${text}`);
  failed = true;
};

let listed = [];
try {
  listed = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  if (!Array.isArray(listed)) throw new Error('not a list');
} catch (error) {
  fail(`index.json cannot be read: ${error.message}`);
  listed = [];
}
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.json') && name !== 'index.json')
  .map((name) => name.slice(0, -'.json'.length));

files.filter((id) => !listed.includes(id)).forEach((id) => fail(`${id}.json is not listed in index.json`));
listed.filter((id) => !files.includes(id)).forEach((id) => fail(`${id} is listed in index.json but has no file`));

for (const id of files) {
  let pattern;
  try {
    pattern = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
    if (pattern === null || typeof pattern !== 'object') throw new Error('not an object');
  } catch (error) {
    fail(`${id}.json cannot be read: ${error.message}`);
    continue;
  }
  console.log(pattern.title ?? id);
  for (const check of checkPattern(pattern)) {
    console.log(`  ${check.ok ? 'ok ' : 'BAD'} ${check.label}: ${check.detail}`);
    if (!check.ok) failed = true;
  }
}

process.exit(failed ? 1 : 0);
