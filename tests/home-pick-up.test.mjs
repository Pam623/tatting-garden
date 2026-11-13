import assert from 'node:assert/strict';
import { test } from 'node:test';

// home.js reaches the page when loaded, so it gets a bare stand-in first.
globalThis.document = { title: '', getElementById: () => ({ innerHTML: '', addEventListener() {} }) };
globalThis.window = {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null };
const { pickUpSection, withoutPattern } = await import('../js/home.js');

const resume = (id, title) => ({ pattern: { id, title }, index: 2, total: 6, at: 1 });
const wish = { id: 'gs-sleeves', title: '星花装饰的袖子' };

test('a deleted drawing leaves the resume list, and an empty list takes its heading with it', () => {
  const lists = { resumes: [resume('draw-abc', '爱心'), resume('arch-edging', '拱形手帕花边')], wished: [wish] };
  const before = pickUpSection(lists.resumes, lists.wished);
  assert.match(before, /draw-abc\/work/);

  const one = withoutPattern(lists, 'draw-abc');
  const after = pickUpSection(one.resumes, one.wished);
  assert.doesNotMatch(after, /draw-abc/);
  assert.match(after, /arch-edging\/work/);
  assert.match(after, /接着编/);

  const none = withoutPattern(one, 'arch-edging');
  const empty = pickUpSection(none.resumes, none.wished);
  assert.doesNotMatch(empty, /接着编/);
  assert.match(empty, /想编的/);

  assert.equal(pickUpSection(none.resumes, []), '');
});

test('removing a pattern that is not listed changes nothing', () => {
  const lists = { resumes: [resume('arch-edging', '拱形手帕花边')], wished: [] };
  assert.deepEqual(withoutPattern(lists, 'draw-zzz'), lists);
});
