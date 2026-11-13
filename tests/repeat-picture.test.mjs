import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_DRAWN_GROUPS, renderFinished } from '../js/finished.js';
import { checkPattern, expandRepeats, repeatShift, summarize } from '../js/pattern.js';

const read = (id) => JSON.parse(readFileSync(new URL(`../patterns/${id}.json`, import.meta.url), 'utf8'));
const nodes = (svg) => (svg.match(/<(path|circle|rect)\b/g) ?? []).length;

test('the edging summary counts every group', () => {
  const edging = read('arch-edging');
  assert.equal(summarize(edging, { repeats: 8 }), '18 环 · 9 桥 · 每环 16 针 · 起头 A–C，D–F 重复 8 组');
  assert.equal(summarize(edging, { repeats: 3 }), '8 环 · 4 桥 · 每环 16 针 · 起头 A–C，D–F 重复 3 组');
  assert.equal(summarize(edging), '4 环 · 2 桥 · 每环 16 针');
  const clover = read('clover-medallion');
  assert.equal(summarize(clover, { repeats: 8 }), summarize(clover));
});

test('a repeat steps along by one group', () => {
  assert.deepEqual(repeatShift(read('arch-edging')), [-170, 0]);
  const [dx, dy] = repeatShift(read('leaf-braid'));
  assert.ok(Math.abs(dx - 156.6) < 0.01 && Math.abs(dy - 3.3) < 0.01);
});

['arch-edging', 'leaf-braid'].forEach((id) => {
  test(`${id}: worked-out repeats still join and connect`, () => {
    const pattern = read(id);
    const before = JSON.stringify(pattern);
    const size = pattern.repeat.elements.length;
    [3, 8].forEach((times) => {
      const whole = expandRepeats(pattern, times);
      assert.equal(whole.elements.length, pattern.elements.length + (times - 1) * size);
      assert.equal(new Set(whole.elements.map((e) => e.id)).size, whole.elements.length);
      const results = checkPattern(whole);
      ['结构完整', '每个接耳都接上了', '桥两端接上了', '每段针数都是正数'].forEach((label) => {
        const found = results.find((r) => r.label === label);
        assert.ok(found?.ok, `${id} × ${times}: ${label}: ${found?.detail}`);
      });
    });
    // The pattern file itself is untouched: same stitches, joins and flips.
    assert.equal(JSON.stringify(pattern), before);
    assert.equal(expandRepeats(pattern, 1), pattern);
  });
});

test('the finished picture follows the repeat count and stays light', () => {
  const edging = read('arch-edging');
  const three = nodes(renderFinished(edging, { repeats: 3 }));
  const eight = nodes(renderFinished(edging, { repeats: 8 }));
  assert.ok(eight > three);
  const capped = nodes(renderFinished(edging, { repeats: 200 }));
  assert.equal(capped, nodes(renderFinished(edging, { repeats: MAX_DRAWN_GROUPS })));
  assert.ok(capped < 1500, `${capped} nodes`);
  const clover = read('clover-medallion');
  assert.equal(renderFinished(clover, { repeats: 8 }), renderFinished(clover));
});
