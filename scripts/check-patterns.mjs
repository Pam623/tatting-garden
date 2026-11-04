// Checks every pattern's numbers before publishing:  node scripts/check-patterns.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSteps, checkPattern } from '../js/pattern.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'patterns');
const ids = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let failed = false;

for (const id of ids) {
  const pattern = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  console.log(`${pattern.title} (${buildSteps(pattern).length} steps)`);
  for (const result of checkPattern(pattern)) {
    console.log(`  ${result.ok ? 'ok ' : 'BAD'} ${result.label}: ${result.detail}`);
    if (!result.ok) failed = true;
  }
}

process.exit(failed ? 1 : 0);
