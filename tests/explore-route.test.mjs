import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;

test('showExplore draws nothing when the route is no longer current', async () => {
  const app = { innerHTML: '', addEventListener() {}, querySelector: () => ({ addEventListener() {} }) };
  globalThis.document = { title: '', getElementById: () => app, body: { classList: { toggle() {} } } };
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(join(root, url), 'utf8')),
  });
  const { showExplore } = await import('../js/explore.js');
  await showExplore(() => false);
  assert.equal(app.innerHTML, '', 'a stale route must not draw');
  await showExplore(() => true);
  assert.ok(app.innerHTML.includes('灵感库'), 'the current route draws');
  assert.match(app.innerHTML, /data-filter="doable"[^>]*>能照着编的（\d+）/);
});

test('cards that can be worked come first, in library order', async () => {
  const { doableFirst } = await import('../js/explore.js');
  const cards = JSON.parse(readFileSync(join(root, 'explore/index.json'), 'utf8'));
  const sorted = doableFirst(cards);
  const doable = cards.filter((c) => c.patterns?.length);
  assert.equal(sorted.length, cards.length);
  assert.deepEqual(sorted.slice(0, doable.length).map((c) => c.id), doable.map((c) => c.id));
  assert.ok(sorted.slice(doable.length).every((c) => !c.patterns?.length));
});
