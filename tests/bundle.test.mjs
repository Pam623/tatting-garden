import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bundleCode, LAB_FILES } from '../scripts/lab-bundle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function importsOf(path) {
  const source = readFileSync(join(root, path), 'utf8');
  return [...source.matchAll(/^import [\s\S]*?from '(\.[^']+)';$/gm)]
    .map((m) => relative(root, join(root, dirname(path), m[1])));
}

// Every name declared at the top level of a piece of bundled code.
function topLevelNames(code) {
  const names = [];
  for (const line of code.split('\n')) {
    const fn = line.match(/^(?:async )?function\*?\s+([\w$]+)/);
    const value = line.match(/^(?:const|let|var|class)\s+([\w$]+)/);
    const destructured = line.match(/^(?:const|let|var)\s+[{[]([^}\]]+)[}\]]/);
    if (fn) names.push(fn[1]);
    if (value) names.push(value[1]);
    if (destructured) names.push(...destructured[1].split(',').map((n) => n.split(':').at(-1).trim()).filter(Boolean));
  }
  return names;
}

test('the bundle parses as one classic script', () => {
  const code = bundleCode();
  assert.doesNotMatch(code, /^import /m);
  assert.doesNotMatch(code, /^export /m);
  new vm.Script(code);
});

test('no top-level name is declared twice across the bundled files', () => {
  const owners = new Map();
  for (const path of LAB_FILES) {
    const local = readFileSync(join(root, path), 'utf8').replace(/^export /gm, '');
    for (const name of topLevelNames(local)) {
      assert.equal(owners.get(name), undefined, `${name} is in both ${owners.get(name)} and ${path}`);
      owners.set(name, path);
    }
  }
  assert.ok(owners.size > 20, 'the scan found the declarations');
});

test('the bundle has every file the page imports, each after what it imports', () => {
  const seen = new Set();
  const walk = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    importsOf(path).forEach(walk);
  };
  walk('js/app.js');
  assert.deepEqual([...seen].sort(), [...LAB_FILES].sort());
  LAB_FILES.forEach((path, i) => {
    for (const dep of importsOf(path)) {
      assert.ok(LAB_FILES.indexOf(dep) < i, `${path} must come after ${dep}`);
    }
  });
});

test('pdf.js is a fixed version from cdnjs, fetched only from inside a function', () => {
  const source = readFileSync(join(root, 'js/pdf-reader.js'), 'utf8');
  assert.match(source, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/\d+\.\d+\.\d+'/);
  assert.doesNotMatch(source, /^\S.*\bimport\(/m, 'no import() at the top level');
  const code = bundleCode();
  assert.equal(code.match(/cdnjs/g).length, 1, 'only one place names the CDN');
  // The artifact host refuses a page that embeds a PDF, so the page must not carry that marker.
  assert.ok(!code.includes('%' + 'PDF'));
});

// A small stand-in for the browser, enough to run the bundle's first page.
function runBundle(patterns) {
  const app = { innerHTML: '', addEventListener() {} };
  const context = {
    console,
    setTimeout,
    fetch: async () => { throw new Error('the lab page must not fetch'); },
    location: { hash: '' },
    document: {
      title: '',
      body: { classList: { toggle() {} } },
      getElementById: () => app,
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
  };
  context.window = { TATTING_PATTERNS: patterns, addEventListener() {}, scrollTo() {} };
  vm.runInNewContext(bundleCode(), context);
  return app;
}

test('the bundled page runs and draws the home page without any upload entry', async () => {
  const pattern = JSON.parse(readFileSync(join(root, 'patterns/leaf-braid.json'), 'utf8'));
  const app = runBundle([pattern]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(app.innerHTML.includes(pattern.title), app.innerHTML);
  assert.ok(!app.innerHTML.includes('#/upload'), 'no upload link without the artifact capabilities');
  assert.ok(!app.innerHTML.includes('#/draw'), 'no drawing link without the artifact capabilities');
});
