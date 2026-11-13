import assert from 'node:assert/strict';
import { test } from 'node:test';

// home.js reaches the page when loaded, so it gets a bare stand-in first.
globalThis.document = { title: '', getElementById: () => ({ innerHTML: '', addEventListener() {} }) };
globalThis.window = {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null };
const { pickUpSection, withRenamed, withoutPattern } = await import('../js/home.js');

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

test('more than one piece in progress folds behind a 还有 N 个 button until opened', () => {
  const resumes = [resume('draw-a', '爱心'), resume('draw-b', '蝴蝶'), resume('arch-edging', '拱形手帕花边')];
  const folded = pickUpSection(resumes, []);
  assert.match(folded, /class="resume-list is-folded"/);
  assert.match(folded, /data-more>还有 2 个</);
  assert.equal((folded.match(/class="resume-more"/g) ?? []).length, 2);
  const open = pickUpSection(resumes, [], { expanded: true });
  assert.doesNotMatch(open, /is-folded|data-more/);
  const single = pickUpSection([resume('draw-a', '爱心')], []);
  assert.doesNotMatch(single, /is-folded|data-more|resume-more/);
});

test('a renamed drawing shows its new name in the resume list', () => {
  const lists = { resumes: [resume('draw-a', '手绘花片'), resume('arch-edging', '拱形手帕花边')], wished: [] };
  const renamed = withRenamed(lists, { id: 'draw-a', title: '给妈妈的蝴蝶' });
  const html = pickUpSection(renamed.resumes, renamed.wished);
  assert.match(html, /继续编 · 给妈妈的蝴蝶 · 第 3 个/);
  assert.doesNotMatch(html, /手绘花片/);
  assert.equal(renamed.resumes[1], lists.resumes[1]);
});
