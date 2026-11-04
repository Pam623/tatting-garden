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

const listed = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.json') && name !== 'index.json')
  .map((name) => name.slice(0, -'.json'.length));

files.filter((id) => !listed.includes(id)).forEach((id) => fail(`${id}.json is not listed in index.json`));
listed.filter((id) => !files.includes(id)).forEach((id) => fail(`${id} is listed in index.json but has no file`));

for (const id of files) {
  let pattern;
  try {
    pattern = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  } catch (error) {
    fail(`${id}.json cannot be read: ${error.message}`);
    continue;
  }
  console.log(pattern.title ?? id);
  for (const check of checkPattern(pattern, { public: true })) {
    console.log(`  ${check.ok ? 'ok ' : 'BAD'} ${check.label}: ${check.detail}`);
    if (!check.ok) failed = true;
  }
}

process.exit(failed ? 1 : 0);
