import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the reference picture is a separate image and never touches the canvas or the saved data', () => {
  const source = read('js/pad-reference.js');
  assert.ok(!/getContext|toDataURL|drawImage|saveDrawing|traceDesign/.test(source));
  assert.match(read('js/draw.js'), /setupPadReference\(/);
  assert.ok(!/pad-ref|reference/.test(read('js/sketch-pad.js')), 'the pad knows nothing about it');
});

// Just enough of the page for the reference panel.
function fakePage() {
  const listeners = {};
  const parts = new Map();
  const part = (selector) => {
    if (!parts.has(selector)) {
      parts.set(selector, {
        hidden: false, value: '', files: [], inserted: [],
        setAttribute() {},
        insertAdjacentHTML(_where, html) { this.inserted.push(html); },
        addEventListener(type, fn) { listeners[`${selector}:${type}`] = fn; },
      });
    }
    return parts.get(selector);
  };
  const slot = {
    html: '',
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
    querySelector(selector) {
      if (selector === '#ref-card' && !this.html.includes('ref-card')) return null;
      return part(selector);
    },
  };
  globalThis.document = { createElement: () => ({}), getElementById: () => ({}) };
  globalThis.window = {};
  return { slot, wrap: { insertBefore() {} }, listeners, part };
}

test('the lab page shows only the local picker and never loads the library', async () => {
  const page = fakePage();
  const { setupPadReference } = await import('../js/pad-reference.js');
  let loads = 0;
  setupPadReference(page.slot, page.wrap, { library: false, load: async () => { loads += 1; return []; } });
  assert.ok(!page.slot.html.includes('灵感库'));
  assert.ok(page.slot.html.includes('从本机选图'));
  await page.listeners['#ref-open:click']();
  assert.equal(loads, 0);
  assert.match(read('js/draw.js'), /library: !embedded/);
});

test('opening the panel again while the library loads does not repeat the options', async () => {
  const page = fakePage();
  const { setupPadReference } = await import('../js/pad-reference.js');
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  setupPadReference(page.slot, page.wrap, {
    library: true,
    load: async () => { loads += 1; await gate; return [{ image: 'a.jpg', title: 'A' }]; },
  });
  const click = page.listeners['#ref-open:click'];
  click();
  click();
  click();
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(loads, 1);
  assert.equal(page.part('#ref-card').inserted.length, 1);
});
