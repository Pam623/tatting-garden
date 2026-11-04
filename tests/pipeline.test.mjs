import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareTranscriptions } from '../js/compare.js';

const root = new URL('..', import.meta.url).pathname;
const ring = (id, parts, extra = {}) => ({ id, type: 'ring', parts, ...extra });
const doc = (...elements) => ({ elements });
const base = () => doc(ring('A', ['2', 'p:n', '4', 'o', '2']), ring('B', ['5', 'j:A.n', '5']));

function differs(a, b, pattern) {
  const report = compareTranscriptions(a, b);
  assert.equal(report.match, false);
  assert.match(report.differences.map((d) => d.text).join(), pattern);
  return report;
}

test('identical readings match', () => {
  const report = compareTranscriptions(base(), base());
  assert.equal(report.match, true);
  assert.equal(report.compared, 2);
});

test('a changed stitch count is reported on its element', () => {
  const other = doc(ring('A', ['2', 'p:n', '5', 'o', '2']), ring('B', ['5', 'j:A.n', '5']));
  const report = differs(base(), other, /A：内容不同/);
  assert.deepEqual(report.differences.map((d) => d.id), ['A']);
});

test('a missing element is reported on the right side', () => {
  differs(base(), doc(base().elements[0]), /B：只有第一份有/);
  differs(doc(base().elements[0]), base(), /B：只有第二份有/);
});

test('a different type is reported', () => {
  differs(base(), doc(base().elements[0], { ...base().elements[1], type: 'bridge' }), /B：类型不同/);
});

test('a join to a different picot is reported', () => {
  const two = (target) => doc(ring('A', ['2', 'p:x', '2', 'p:y', '2']), ring('B', ['5', `j:A.${target}`, '5']), ring('C', ['5', `j:A.${target === 'x' ? 'y' : 'x'}`, '5']));
  differs(two('x'), two('y'), /B：内容不同/);
});

test('a join to a different element is reported', () => {
  const left = doc(ring('A', ['2', 'p:x']), ring('C', ['2', 'p:x']), ring('B', ['5', 'j:A.x']));
  const right = doc(ring('A', ['2', 'p:x']), ring('C', ['2', 'p:x']), ring('B', ['5', 'j:C.x']));
  differs(left, right, /B：内容不同/);
});

test('a different order is reported', () => {
  const swapped = doc(base().elements[1], base().elements[0]);
  differs(base(), swapped, /顺序不同/);
});

test('a flip disagreement is a difference; one reader not stating it is a note', () => {
  const withFlip = (value) => doc(ring('A', ['2', 'p:n', '4', 'o', '2'], { flip: { value, source: 'inferred' } }), base().elements[1]);
  differs(withFlip(true), withFlip(false), /A：翻面不同/);
  const report = compareTranscriptions(base(), withFlip(true));
  assert.equal(report.match, true);
  assert.match(report.notes[0], /A：只有一份说了翻面/);
});

test('picot names are private to each reader', () => {
  const renamed = doc(ring('A', ['2', 'p:zz', '4', 'o', '2']), ring('B', ['5', 'j:A.zz', '5']));
  assert.equal(compareTranscriptions(base(), renamed).match, true);
});

test('source marks alone are a note, not a difference', () => {
  const unsure = doc(ring('A', ['2?', 'p:n', '4', 'o', '2']), ring('B', ['5', 'j:A.n', '5']));
  const report = compareTranscriptions(base(), unsure);
  assert.equal(report.match, true);
  assert.equal(report.notes.length, 1);
  assert.match(report.notes[0], /A 第 1 段/);
});

function runCompare(a, b) {
  const dir = mkdtempSync(join(tmpdir(), 'compare-'));
  writeFileSync(join(dir, 'a.json'), typeof a === 'string' ? a : JSON.stringify(a));
  writeFileSync(join(dir, 'b.json'), typeof b === 'string' ? b : JSON.stringify(b));
  return spawnSync(process.execPath, [join(root, 'scripts/compare-transcriptions.mjs'), join(dir, 'a.json'), join(dir, 'b.json')], { encoding: 'utf8' });
}

test('the script exits by result', () => {
  assert.equal(runCompare(base(), base()).status, 0);
  const differing = runCompare(base(), doc(base().elements[0]));
  assert.equal(differing.status, 1);
  assert.match(differing.stdout, /1 处不同/);
});

test('the script exits 2 on malformed input', () => {
  assert.equal(runCompare('{nope', base()).status, 2);
  assert.equal(runCompare({ elements: [ring('A', ['zz'])] }, base()).status, 2);
  assert.equal(runCompare({}, base()).status, 2);
  assert.equal(spawnSync(process.execPath, [join(root, 'scripts/compare-transcriptions.mjs')], { encoding: 'utf8' }).status, 2);
});

test('the bundle holds every lab pattern, with no local fetches in effect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lab-'));
  const pattern = { id: 'x', title: '测试</script>花样', elements: [] };
  writeFileSync(join(dir, 'x.json'), JSON.stringify(pattern));
  const run = spawnSync(process.execPath, [join(root, 'scripts/build-lab.mjs'), dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const html = readFileSync(join(dir, 'dist/index.html'), 'utf8');
  assert.match(html, /window\.TATTING_PATTERNS = /);
  assert.doesNotMatch(html, /测试<\/script>/, 'pattern text cannot end the script');
  assert.doesNotMatch(html, /^import /m);
  assert.doesNotMatch(html, /^export /m);
  assert.doesNotMatch(html, /src="js\//);
});

test('lab content stays out of the public repo', () => {
  const ignored = spawnSync('git', ['check-ignore', 'lab/x.json'], { cwd: root });
  assert.equal(ignored.status, 0);
  const tracked = spawnSync('git', ['ls-files', 'lab'], { cwd: root, encoding: 'utf8' });
  assert.equal(tracked.stdout, '');
});
