import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  checkPattern, clampProgress, formulaGroups, groupChoice, hasStarted, handFormula, parseToken, partsInWords, readElement, structureProblems, summarize,
} from '../js/pattern.js';

const root = new URL('..', import.meta.url).pathname;
const flower = JSON.parse(readFileSync(join(root, 'patterns/little-flower.json'), 'utf8'));

function pattern(elements, extra = {}) {
  return { id: 'x', title: 'X', tier: 'sorted', rights: { kind: 'original' }, layout: { viewBox: [0, 0, 100, 100] }, elements, ...extra };
}
const place = { base: [0, 0], tip: [10, 0], width: 5, dir: 'cw' };
const ring = (id, parts, extra = {}) => ({ id, type: 'ring', place, parts, ...extra });
const bridgePlace = { from: [0, 0], to: [10, 0], bulge: 2 };
const check = (p, label, options) => {
  const found = checkPattern(p, options).find((c) => c.label === label);
  assert.ok(found, `no check called ${label}`);
  return found;
};

test('parses every part form with its source', () => {
  assert.deepEqual(parseToken('5'), { kind: 'stitch', count: 5, source: 'source' });
  assert.deepEqual(parseToken('5?'), { kind: 'stitch', count: 5, source: 'inferred' });
  assert.deepEqual(parseToken('16~'), { kind: 'stitch', count: 16, source: 'estimated' });
  assert.deepEqual(parseToken('16~3'), { kind: 'stitch', count: 16, source: 'estimated', error: 3 });
  assert.deepEqual(parseToken('o'), { kind: 'deco', source: 'source' });
  assert.deepEqual(parseToken('o~'), { kind: 'deco', source: 'estimated' });
  assert.deepEqual(parseToken('p:first'), { kind: 'leave', name: 'first', multi: false, source: 'source' });
  assert.deepEqual(parseToken('p:mid+?'), { kind: 'leave', name: 'mid', multi: true, source: 'inferred' });
  assert.deepEqual(parseToken('j:A.first?'), { kind: 'join', element: 'A', name: 'first', source: 'inferred' });
  assert.throws(() => parseToken('5x'));
  assert.throws(() => parseToken('j:A'));
});

test('an unknown part fails the structure check and names the element', () => {
  const failed = check(pattern([ring('A', ['5', 'zz', '2'])]), '结构完整');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.elements, ['A']);
  assert.match(failed.detail, /zz/);
});

test('missing fields fail instead of crashing, and name the pattern', () => {
  const noElements = checkPattern({ title: '旧文件', rings: [] });
  const failed = noElements.find((c) => c.label === '结构完整');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.elements, []);
  assert.match(failed.detail, /旧文件/);
  assert.match(failed.detail, /信任等级/);
  assert.match(failed.detail, /版权/);
  assert.equal(check(pattern([]), '结构完整').ok, false);
  assert.equal(check(pattern([{ id: 'A', type: 'ring', place }]), '结构完整').ok, false);
});

test('a malformed flip, a nameless element and a non-object element fail structure', () => {
  for (const flip of [{ value: true, source: 'estimate' }, { value: true }, true]) {
    assert.deepEqual(check(pattern([ring('A', ['5'], { flip })]), '结构完整').elements, ['A']);
  }
  assert.equal(check(pattern([{ type: 'ring', parts: ['5'] }]), '结构完整').ok, false);
  assert.equal(check(pattern([null]), '结构完整').ok, false);
});

test('pages can tell a pattern cannot be drawn before they try', () => {
  assert.deepEqual(structureProblems(flower), []);
  assert.match(structureProblems(pattern([ring('A', ['5', 'zz'])])).join(), /zz/);
  assert.equal(structureProblems({ title: '旧文件' }).length, 1);
  assert.equal(structureProblems(pattern([null])).length, 1);
});

test('an id that could carry markup or a missing layout cannot be drawn', () => {
  assert.equal(structureProblems(pattern([ring('<img src=x onerror=alert(1)>', ['5'])])).length, 1);
  assert.match(structureProblems(pattern([ring('A', ['5'])], { layout: undefined })).join(), /布局/);
});

test('a pattern with no drawable place or stitch cannot be drawn', () => {
  assert.equal(structureProblems(pattern([{ id: 'A', type: 'ring', parts: ['5'] }])).length, 1);
  const bad = [
    { ...place, dir: 'cc' }, { ...place, width: 0 }, { ...place, tip: place.base }, { base: [0], tip: [1, 1], width: 1, dir: 'cw' },
  ];
  bad.forEach((p) => assert.match(structureProblems(pattern([ring('A', ['5'], { place: p })])).join(), /A 的位置/));
  assert.match(structureProblems(pattern([{ id: 'B', type: 'bridge', place: { from: [0, 0], to: [0, 0], bulge: 0 }, parts: ['5'] }])).join(), /B 的位置/);
  assert.match(structureProblems(pattern([{ id: 'B', type: 'bridge', place: { from: [0, 0], to: [1, 0], bulge: 'x' }, parts: ['5'] }])).join(), /B 的位置/);
  assert.match(structureProblems(pattern([ring('A', ['o'])])).join(), /A 没有针数/);
  assert.match(structureProblems(pattern([ring('A', ['5'])], { layout: { viewBox: [0, 0, 0, 10] } })).join(), /布局/);
  assert.match(structureProblems(pattern([ring('A', ['5'])], { layout: { viewBox: [0, 0, 9, 9], closed: 'yes' } })).join(), /布局/);
  assert.equal(check(pattern([ring('A', ['0', '5'])]), '每段针数都是正数').ok, false);
});

test('bridges must meet neighbouring ring bases; other neighbours are not compared', () => {
  const r1 = ring('A', ['5'], { place: { ...place, base: [0, 0] } });
  const r2 = ring('C', ['5'], { place: { ...place, base: [10, 0], tip: [20, 0] } });
  const good = { id: 'B', type: 'bridge', place: bridgePlace, parts: ['5'] };
  assert.equal(check(pattern([r1, good, r2]), '桥两端接上了').ok, true);
  const off = { ...good, place: { ...bridgePlace, to: [15, 0] } };
  assert.deepEqual(check(pattern([r1, off, r2]), '桥两端接上了').elements, ['B']);
  const offStart = { ...good, place: { ...bridgePlace, from: [5, 5] } };
  assert.deepEqual(check(pattern([r1, offStart, r2]), '桥两端接上了').elements, ['B']);
  const wrapStart = pattern([offStart, r2, r1], { layout: { viewBox: [0, 0, 9, 9], closed: true } });
  assert.deepEqual(check(wrapStart, '桥两端接上了').elements, ['B']);
  assert.equal(check(pattern([good, good]), '桥两端接上了').ok, true);
  const last = { ...good, place: { from: [0, 0], to: [50, 50], bulge: 0 } };
  const open = pattern([r1, last]);
  assert.equal(check(open, '桥两端接上了').ok, true);
  const closed = { ...open, layout: { viewBox: [0, 0, 9, 9], closed: true } };
  assert.deepEqual(check(closed, '桥两端接上了').elements, ['B']);
});

test('rejects duplicate ids and unknown types', () => {
  const failed = check(pattern([ring('A', ['5']), ring('A', ['5'])]), '结构完整');
  assert.deepEqual(failed.elements, ['A']);
  const badType = check(pattern([{ id: 'B', type: 'knot', place, parts: ['5'] }]), '结构完整');
  assert.deepEqual(badType.elements, ['B']);
});

test('stitch counts must be positive and present', () => {
  const zero = check(pattern([ring('A', ['0'])]), '每段针数都是正数');
  assert.equal(zero.ok, false);
  assert.deepEqual(zero.elements, ['A']);
  assert.deepEqual(check(pattern([ring('B', ['o'])]), '每段针数都是正数').elements, ['B']);
  assert.equal(check(pattern([ring('A', ['5'])]), '每段针数都是正数').ok, true);
});

test('a join must land on a picot left earlier', () => {
  const early = check(pattern([ring('A', ['5', 'j:B.x', '5']), ring('B', ['5', 'p:x', '5'])]), '每个接耳都接上了');
  assert.equal(early.ok, false);
  assert.ok(early.elements.includes('A'));
  const forwardInElement = check(pattern([ring('A', ['5', 'j:A.x', '5', 'p:x', '5'])]), '每个接耳都接上了');
  assert.equal(forwardInElement.ok, false);
  const sameElement = check(pattern([ring('A', ['5', 'p:x', '5', 'j:A.x', '5'])]), '每个接耳都接上了');
  assert.equal(sameElement.ok, true);
});

test('a left picot must be used, once unless marked multi', () => {
  const unused = check(pattern([ring('A', ['5', 'p:x', '5'])]), '每个接耳都接上了');
  assert.deepEqual(unused.elements, ['A']);
  const twice = check(pattern([
    ring('A', ['5', 'p:x', '5']), ring('B', ['5', 'j:A.x', '5']), ring('C', ['5', 'j:A.x', '5']),
  ]), '每个接耳都接上了');
  assert.equal(twice.ok, false);
  assert.ok(twice.elements.includes('C'));
  const multi = check(pattern([
    ring('A', ['5', 'p:x+', '5']), ring('B', ['5', 'j:A.x', '5']), ring('C', ['5', 'j:A.x', '5']),
  ]), '每个接耳都接上了');
  assert.equal(multi.ok, true);
});

test('duplicate picot names in one element fail', () => {
  const failed = check(pattern([
    ring('A', ['5', 'p:x', '5', 'p:x', '5']), ring('B', ['5', 'j:A.x', '5']),
  ]), '每个接耳都接上了');
  assert.equal(failed.ok, false);
  assert.ok(failed.elements.includes('A'));
});

test('group members must match on stitches, decorative picots and all picots', () => {
  const stitches = check(pattern([ring('A', ['5'], { group: 'g' }), ring('B', ['6'], { group: 'g' })]), '同组元素一致');
  assert.deepEqual(stitches.elements, ['A', 'B']);
  const decos = check(pattern([
    ring('L', ['5', 'p:x', '5']),
    ring('A', ['5', 'o'], { group: 'g' }),
    ring('B', ['5', 'j:L.x'], { group: 'g' }),
  ]), '同组元素一致');
  assert.equal(decos.ok, false);
  assert.match(decos.detail, /装饰耳/);
  const droppedJoin = check(pattern([
    ring('L', ['5', 'p:x', '5']),
    ring('A', ['5', 'j:L.x', '5'], { group: 'g' }),
    ring('B', ['10'], { group: 'g' }),
  ]), '同组元素一致');
  assert.equal(droppedJoin.ok, false);
  assert.equal(check(pattern([ring('A', ['5']), ring('B', ['6'])]), '同组元素一致').ok, true);
});

test('only a reconstruction may carry estimates', () => {
  for (const tier of ['sorted', 'checked', 'made']) {
    const failed = check(pattern([ring('A', ['5~1'])], { tier, reviewedBy: ['x'] }), '信任等级和内容相符');
    assert.equal(failed.ok, false, tier);
    assert.deepEqual(failed.elements, ['A']);
  }
  const flip = check(pattern([ring('A', ['5'], { flip: { value: true, source: 'estimated' } })]), '信任等级和内容相符');
  assert.deepEqual(flip.elements, ['A']);
});

test('checked and made need a review record', () => {
  for (const tier of ['checked', 'made']) {
    assert.equal(check(pattern([ring('A', ['5'])], { tier }), '信任等级和内容相符').ok, false, tier);
    assert.equal(check(pattern([ring('A', ['5'])], { tier, reviewedBy: ['Kimi'] }), '信任等级和内容相符').ok, true, tier);
  }
});

test('a blank review entry does not count', () => {
  assert.equal(check(pattern([ring('A', ['5'])], { tier: 'checked', reviewedBy: [' '] }), '信任等级和内容相符').ok, false);
});

test('made fails with anything still unconfirmed', () => {
  const base = { tier: 'made', reviewedBy: ['Kimi'] };
  assert.equal(check(pattern([ring('A', ['5'])], { ...base, toConfirm: ['x'] }), '信任等级和内容相符').ok, false);
  assert.deepEqual(check(pattern([ring('A', ['5?'])], base), '信任等级和内容相符').elements, ['A']);
  assert.equal(check(pattern([ring('A', ['5?'])], { tier: 'checked', reviewedBy: ['Kimi'] }), '信任等级和内容相符').ok, true);
});

test('a reconstruction marks everything and states its errors', () => {
  const tier = { tier: 'reconstruction' };
  assert.deepEqual(check(pattern([ring('A', ['5'])], tier), '信任等级和内容相符').elements, ['A']);
  assert.deepEqual(check(pattern([ring('A', ['5~'])], tier), '信任等级和内容相符').elements, ['A']);
  assert.deepEqual(check(pattern([ring('A', ['5~1'], { flip: { value: true, source: 'source' } })], tier), '信任等级和内容相符').elements, ['A']);
  assert.equal(check(pattern([ring('A', ['5~1', 'o~'])], tier), '信任等级和内容相符').ok, true);
  assert.equal(check(pattern([ring('A', ['5?', 'o~'], { flip: { value: true, source: 'estimated' } })], tier), '信任等级和内容相符').ok, true);
});

test('the public check is gone, and no rights kind is rejected', () => {
  const labels = checkPattern(pattern([ring('A', ['5'])], { rights: { kind: 'private' } })).map((c) => c.label);
  assert.equal(labels.includes('可以公开'), false);
  assert.equal(checkPattern(pattern([ring('A', ['5'])], { rights: { kind: 'private' } })).every((c) => c.ok), true);
  assert.equal(check(pattern([ring('A', ['5'])], { rights: { kind: 'odd' } }), '结构完整').ok, false);
});

test('a group with repeat elements may trade a decorative picot for a join', () => {
  const elements = [
    ring('L', ['5', 'p:x', '5']),
    ring('A', ['5', 'o', '5'], { group: 'g' }),
    ring('B', ['5', 'j:L.x', '5'], { group: 'g' }),
  ];
  assert.equal(check(pattern(elements), '同组元素一致').ok, false);
  assert.equal(check(pattern(elements, { repeat: { elements: ['B'], defaultTimes: 2, open: [] } }), '同组元素一致').ok, true);
});

test('left picots named in repeat.open may stay unused; others still fail', () => {
  const elements = [ring('F', ['5', 'p:tip', '5']), ring('G', ['5', 'p:other', '5'])];
  const open = check(pattern(elements, { repeat: { elements: ['F', 'G'], defaultTimes: 2, open: ['F.tip'] } }), '每个接耳都接上了');
  assert.equal(open.ok, false);
  assert.deepEqual(open.elements, ['G']);
  assert.equal(check(pattern(elements, { repeat: { elements: ['F', 'G'], defaultTimes: 2, open: ['F.tip', 'G.other'] } }), '每个接耳都接上了').ok, true);
  assert.equal(check(pattern(elements), '每个接耳都接上了').ok, false);
});

test('the notation follows the founder: comma for join, middle dot for decorative', () => {
  assert.equal(handFormula(flower.elements[0]), '5,2·2·2·2·2·2,5');
  assert.equal(handFormula(ring('A', ['2', 'p:n', '4', 'o', '2'])), '2,4·2');
  assert.equal(handFormula(ring('A', ['12'])), '12');
});

test('table rows group by type and plain formula', () => {
  const rows = formulaGroups(flower);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].formula, '5,2·2·2·2·2·2,5');
  assert.equal(rows[0].stitches, 22);
  assert.deepEqual(rows[0].members.map((m) => m.id), ['A', 'B', 'C', 'D', 'E']);
  const mixed = pattern([
    ring('A', ['5']), ring('C', ['5?']),
    { id: 'B', type: 'bridge', place: bridgePlace, parts: ['5'] },
  ]);
  const mixedRows = formulaGroups(mixed);
  assert.equal(mixedRows.length, 2);
  assert.deepEqual(mixedRows[0].members, [{ id: 'A' }, { id: 'C' }]);
  assert.equal(mixedRows[1].type, 'bridge');
});

test('the summary gives ring stitches only when the rings all match', () => {
  assert.equal(summarize(flower), '5 环 · 0 桥 · 每环 22 针');
  const mixed = pattern([ring('A', ['5']), ring('C', ['6']), { id: 'B', type: 'bridge', place: bridgePlace, parts: ['5'] }]);
  assert.equal(summarize(mixed), '2 环 · 1 桥');
});

test('words name which picot to join and who joins here', () => {
  const left = ring('A', ['2', 'p:n', '4', 'p:k', '3']);
  const later = ring('B', ['5', 'j:A.k', '5']);
  const later2 = ring('C', ['5', 'j:A.n', '5']);
  const all = pattern([left, later, later2]);
  const a = partsInWords(all, left);
  assert.equal(a[0].words, '编 2 针');
  assert.equal(a[1].words, '留一个接耳，等下 C 环接到这里');
  assert.equal(a[3].words, '留一个接耳，等下 B 环接到这里');
  assert.equal(partsInWords(all, later)[1].words, '接到 A 环的第 2 个接耳');
  assert.equal(partsInWords(all, later)[1].target, 'A');
  assert.equal(partsInWords(all, later2)[1].words, '接到 A 环的第 1 个接耳');
  assert.equal(partsInWords(all, ring('Z', ['3', 'o']))[1].words, '留一个装饰耳');
});

test('later passes of a repeat name the first join only', () => {
  const left = ring('A', ['5', 'p:x', '5']);
  const first = ring('B', ['5', 'j:A.x', '5', 'j:A.x', '5']);
  const all = pattern([left, first], { repeat: { elements: ['B'], defaultTimes: 2, open: [] } });
  const note = '，再来时接上一组对应的耳';
  assert.doesNotMatch(partsInWords(all, first)[1].words, /再来时/);
  const second = partsInWords(all, first, { pass: 2 });
  assert.equal(second[1].words, `接到 A 环的第 1 个接耳${note}`);
  assert.doesNotMatch(second[3].words, /再来时/);
  assert.doesNotMatch(partsInWords(all, left, { pass: 2 }).map((p) => p.words).join(''), /再来时/);
});

test('words name bridges, and a join with no target does not throw', () => {
  const span = { id: 'A', type: 'bridge', place: bridgePlace, parts: ['5', 'p:mid', '5'] };
  const joiner = ring('B', ['5', 'j:A.mid', '5']);
  const all = pattern([span, joiner]);
  assert.equal(partsInWords(all, span)[1].words, '留一个接耳，等下 B 环接到这里');
  assert.equal(partsInWords(all, joiner)[1].words, '接到 A 桥的第 1 个接耳');
  assert.equal(partsInWords(all, ring('C', ['5', 'j:Z.x', '5']))[1].words, '接到 Z 环的接耳');
});

test('a saved position outside the pattern is ignored', () => {
  const blank = { index: 0, part: null, finished: false, pass: 1, asking: false };
  assert.deepEqual(clampProgress(null, 5), blank);
  assert.deepEqual(clampProgress('3', 5), blank);
  assert.deepEqual(clampProgress({ index: 5 }, 5), blank);
  assert.deepEqual(clampProgress({ index: -1 }, 5), blank);
  assert.deepEqual(clampProgress({ index: 1.5 }, 5), blank);
  assert.deepEqual(clampProgress({ index: 2, part: 1, finished: true }, 5), { index: 2, part: 1, finished: true, pass: 1, asking: false });
  assert.deepEqual(clampProgress({ index: 2, pass: 3, asking: true }, 5), { index: 2, part: null, finished: false, pass: 3, asking: true });
  assert.equal(clampProgress({ index: 2, pass: 0 }, 5).pass, 1);
  assert.equal(clampProgress({ index: 2, pass: 2.5 }, 5).pass, 1);
  assert.deepEqual(clampProgress({ index: 2, part: -1 }, 5), { index: 2, part: null, finished: false, pass: 1, asking: false });
});

test('the end of a repeat offers another group until all are done', () => {
  const first = groupChoice(1, 8);
  assert.equal(first.more, true);
  assert.equal(first.again, '再来一组（第 2/8 组）');
  assert.match(first.status, /第 1 组，共 8 组/);
  assert.equal(groupChoice(7, 8).more, true);
  assert.equal(groupChoice(7, 8).again, '再来一组（第 8/8 组）');
  assert.equal(groupChoice(8, 8).more, false);
  assert.equal(groupChoice(9, 8).more, false);
  assert.equal(groupChoice(8, 8).status, '8 组都编完了。');
  assert.equal(groupChoice(9, 8).status, '9 组都编完了。');
});

test('reads positions along an element', () => {
  const read = readElement(ring('A', ['5', 'o', '2']));
  assert.equal(read.stitches, 7);
  assert.equal(read.items[1].from, 5);
});

test('the flower passes every check', () => {
  for (const result of checkPattern(flower)) {
    assert.equal(result.ok, true, `${result.label}: ${result.detail}`);
  }
});

test('the flower has the numbers read from the chart', () => {
  assert.equal(flower.schema, 2);
  const read = flower.elements.map(readElement);
  assert.deepEqual(read.map((e) => e.id), ['A', 'B', 'C', 'D', 'E']);
  read.forEach((element) => {
    assert.equal(element.stitches, 22);
    assert.equal(element.items.filter((i) => i.kind === 'deco').length, 5);
  });
});

function runScript(files) {
  const dir = mkdtempSync(join(tmpdir(), 'patterns-'));
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(dir, name), content));
  return spawnSync(process.execPath, [join(root, 'scripts/check-patterns.mjs'), dir], { encoding: 'utf8' });
}

test('the script passes a good folder', () => {
  const run = runScript({ 'index.json': '["x"]', 'x.json': JSON.stringify(pattern([ring('A', ['5'])])) });
  assert.equal(run.status, 0, run.stdout);
});

test('the script fails an unlisted file and a missing file', () => {
  const unlisted = runScript({ 'index.json': '[]', 'x.json': JSON.stringify(pattern([ring('A', ['5'])])) });
  assert.equal(unlisted.status, 1);
  assert.match(unlisted.stdout, /x\.json is not listed/);
  const missing = runScript({ 'index.json': '["y"]' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /y is listed/);
});

test('the script reports a bad index or a null pattern without crashing', () => {
  const badIndex = runScript({ 'index.json': '{nope' });
  assert.equal(badIndex.status, 1);
  assert.match(badIndex.stdout, /index\.json cannot be read/);
  assert.equal(badIndex.stderr, '');
  const nullPattern = runScript({ 'index.json': '["x"]', 'x.json': 'null' });
  assert.equal(nullPattern.status, 1);
  assert.equal(nullPattern.stderr, '');
});

test('the script reports a bad part or bad JSON without crashing', () => {
  const badPart = runScript({ 'index.json': '["x"]', 'x.json': JSON.stringify(pattern([ring('A', ['zz'])])) });
  assert.equal(badPart.status, 1);
  assert.match(badPart.stdout, /zz/);
  assert.equal(badPart.stderr, '');
  const badJson = runScript({ 'index.json': '["x"]', 'x.json': '{nope' });
  assert.equal(badJson.status, 1);
  assert.match(badJson.stdout, /cannot be read/);
  assert.equal(badJson.stderr, '');
});

test('a malformed repeat cannot make the checks throw', () => {
  for (const repeat of [{ elements: 5, open: 5 }, { elements: 'EF', open: 'x' }]) {
    assert.doesNotThrow(() => checkPattern(pattern([ring('A', ['5'])], { repeat })));
  }
});

test('a repeat join to a ring from the same group does not point at the previous group', () => {
  const pattern = JSON.parse(readFileSync(new URL('../patterns/arch-edging.json', import.meta.url), 'utf8'));
  const last = pattern.elements.find((element) => element.id === 'F');
  const words = partsInWords(pattern, last, { pass: 2 }).map((part) => part.words).join('');
  assert.match(words, /接到 D/);
  assert.doesNotMatch(words, /再来时/);
});

test('a repeat join to a later ring still points at the previous group', () => {
  const pattern = JSON.parse(readFileSync(new URL('../patterns/leaf-braid.json', import.meta.url), 'utf8'));
  const annotated = pattern.elements
    .filter((element) => pattern.repeat.elements.includes(element.id))
    .some((element) => partsInWords(pattern, element, { pass: 2 }).some((part) => /再来时/.test(part.words)));
  assert.ok(annotated);
});

test('a later repeat group counts as started even back at the first element', () => {
  const fresh = clampProgress(null, 4);
  assert.equal(hasStarted(fresh), false);
  assert.equal(hasStarted(clampProgress({ index: 0, pass: 2 }, 4)), true);
  assert.equal(hasStarted(clampProgress({ index: 0, asking: true }, 4)), true);
  assert.equal(hasStarted(clampProgress({ index: 1 }, 4)), true);
  assert.equal(hasStarted(clampProgress({ index: 0, part: 0 }, 4)), true);
  assert.equal(hasStarted(clampProgress({ index: 0, finished: true }, 4)), true);
});
