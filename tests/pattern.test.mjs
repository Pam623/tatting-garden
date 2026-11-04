import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildSteps, checkPattern, describeStep, elementFormula, formulaGroups, parseToken, readElement, structureProblems,
} from '../js/pattern.js';
import { renderDiagram } from '../js/diagram.js';

const root = new URL('..', import.meta.url).pathname;
const flower = JSON.parse(readFileSync(join(root, 'patterns/little-flower.json'), 'utf8'));
const snapshot = JSON.parse(readFileSync(join(root, 'tests/fixtures/little-flower-v1.json'), 'utf8'));

function pattern(elements, extra = {}) {
  return { id: 'x', title: 'X', tier: 'sorted', rights: { kind: 'original' }, elements, ...extra };
}
const ring = (id, parts, extra = {}) => ({ id, type: 'ring', parts, ...extra });
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
  assert.equal(check(pattern([{ id: 'A', type: 'ring' }]), '结构完整').ok, false);
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

test('rejects duplicate ids and unknown types', () => {
  const failed = check(pattern([ring('A', ['5']), ring('A', ['5'])]), '结构完整');
  assert.deepEqual(failed.elements, ['A']);
  const badType = check(pattern([{ id: 'B', type: 'knot', parts: ['5'] }]), '结构完整');
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

test('public patterns need open rights and cannot be reconstructions', () => {
  const options = { public: true };
  assert.equal(check(pattern([ring('A', ['5'])]), '可以公开', options).ok, true);
  assert.equal(check(pattern([ring('A', ['5'])], { rights: { kind: 'public-domain' } }), '可以公开', options).ok, true);
  const privateOne = check(pattern([ring('A', ['5'])], { rights: { kind: 'private' } }), '可以公开', options);
  assert.equal(privateOne.ok, false);
  assert.match(privateOne.detail, /X/);
  assert.equal(check(pattern([ring('A', ['5~1'])], { tier: 'reconstruction' }), '可以公开', options).ok, false);
  assert.equal(checkPattern(pattern([ring('A', ['5'])])).some((c) => c.label === '可以公开'), false);
});

test('bridges have no closing step; rings do', () => {
  const mixed = pattern([ring('A', ['5']), { id: 'B', type: 'bridge', parts: ['10'] }]);
  const steps = buildSteps(mixed);
  assert.deepEqual(steps.map((s) => s.item.kind), ['stitch', 'close', 'stitch']);
  assert.match(describeStep(mixed, steps[2]).detail, /这个桥/);
});

test('step text names bridges and picot names correctly', () => {
  const mixed = pattern([
    { id: 'A', type: 'bridge', parts: ['5', 'p:mid', '5'] },
    ring('B', ['5', 'j:A.mid', '5']),
  ]);
  const steps = buildSteps(mixed);
  assert.match(describeStep(mixed, steps[1]).detail, /B 环/);
  assert.deepEqual(describeStep(mixed, steps[4]), { title: '接到 A 桥', detail: '接在 A 桥的mid 耳上' });
});

test('reads positions along an element', () => {
  const read = readElement(ring('A', ['5', 'o', '2']));
  assert.equal(read.stitches, 7);
  assert.equal(read.items[1].from, 5);
  assert.equal(elementFormula(ring('A', ['5', 'p:x', '2', 'o', '3'])), '5 ● 2 ○ 3');
});

test('the flower passes every check as a public pattern', () => {
  for (const result of checkPattern(flower, { public: true })) {
    assert.equal(result.ok, true, `${result.label}: ${result.detail}`);
  }
});

test('the flower has the numbers read from the chart', () => {
  assert.equal(flower.schema, 2);
  assert.equal(flower.tier, 'sorted');
  const read = flower.elements.map(readElement);
  assert.deepEqual(read.map((e) => e.id), ['A', 'B', 'C', 'D', 'E']);
  read.forEach((element) => {
    assert.equal(element.stitches, 22);
    assert.equal(element.items.filter((i) => i.kind === 'deco').length, 5);
  });
});

test('the flower keeps its unconfirmed points marked', () => {
  const closing = readElement(flower.elements[4]).items.find((i) => i.kind === 'join' && i.element === 'A');
  assert.equal(closing.source, 'inferred');
  flower.elements.forEach((element) => assert.deepEqual(element.flip, { value: false, source: 'inferred' }));
  assert.deepEqual(flower.toConfirm, [
    '五个环按顺时针依次编（A 右上，B 右下，然后一路转回左上）',
    '最后一个环 E 接回 A 环的第一个耳，整朵花合上',
    '全程不用翻面',
    '收尾方式是线头打结',
  ]);
});

test('migration leaves step text, stitch table and chart unchanged', () => {
  const steps = buildSteps(flower);
  assert.deepEqual(steps.map((step) => describeStep(flower, step)), snapshot.steps);
  assert.deepEqual(formulaGroups(flower), snapshot.groups);
  assert.equal(renderDiagram(flower, { title: 't' }), snapshot.diagramDone);
  assert.equal(renderDiagram(flower, { step: steps[20], labelRing: steps[20].elementIndex, title: 't' }), snapshot.diagramStep20);
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
