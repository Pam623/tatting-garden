// Joins the page modules into the one script the private lab page runs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Order matters: a file must come after everything it imports, because top-level
// constants are only ready once the code above them has run.
export const LAB_FILES = [
  'js/pattern.js',
  'js/materials.js',
  'js/diagram.js',
  'js/convert.js',
  'js/saved.js',
  'js/upload-file.js',
  'js/picture.js',
  'js/shared.js',
  'js/studio.js',
  'js/home.js',
  'js/pattern-page.js',
  'js/work.js',
  'js/app.js',
];

export function bundleCode() {
  return LAB_FILES
    .map((path) => readFileSync(join(root, path), 'utf8'))
    .join('\n')
    .replace(/^import [\s\S]*?;$/gm, '')
    .replace(/^export /gm, '');
}
