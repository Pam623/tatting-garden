import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { elementGeometry, renderChart } from '../js/diagram.js';
import { checkPattern, readElement } from '../js/pattern.js';

const root = new URL('..', import.meta.url).pathname;
const flower = JSON.parse(readFileSync(join(root, 'patterns/little-flower.json'), 'utf8'));
const v1 = JSON.parse(readFileSync(join(root, 'tests/fixtures/little-flower-v1.json'), 'utf8'));
const css = readFileSync(join(root, 'style.css'), 'utf8');

const near = (a, b, tolerance = 0.5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not near ${b}`);
const ringEl = (parts, place = {}) => ({
  id: 'A', type: 'ring', parts, place: { base: [0, 0], tip: [100, 0], width: 60, dir: 'cw', ...place },
});
const bridgeEl = (parts, place = {}) => ({
  id: 'B', type: 'bridge', parts, place: { from: [0, 0], to: [100, 0], bulge: 40, ...place },
});
const pattern = (elements, extra = {}) => ({
  id: 'x', title: 'X', tier: 'sorted', rights: { kind: 'original' }, layout: { viewBox: [-100, -100, 370, 370] }, elements, ...extra,
});
const count = (svg, pattern_) => (svg.match(pattern_) ?? []).length;

function circles(svg, className) {
  return [...svg.matchAll(new RegExp(`<circle class="[^"]*${className}[^"]*"[^>]*?cx="([-\\d.]+)" cy="([-\\d.]+)"`, 'g'))]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

test('a ring starts at its base, reaches its tip halfway, and returns', () => {
  const g = elementGeometry(ringEl(['10']));
  near(g.pointAt(0).x, 0);
  near(g.pointAt(0).y, 0);
  near(g.pointAt(0.5).x, 100);
  near(g.pointAt(0.5).y, 0);
  near(g.pointAt(1).x, 0);
});

test('a ring has the width it declares', () => {
  const g = elementGeometry(ringEl(['10']));
  let top = 0;
  let bottom = 0;
  for (let f = 0; f <= 1; f += 0.002) {
    top = Math.max(top, g.pointAt(f).y);
    bottom = Math.min(bottom, g.pointAt(f).y);
  }
  near(top - bottom, 60, 1);
});

test('a counter-clockwise ring is the mirror of a clockwise one', () => {
  const cw = elementGeometry(ringEl(['10']));
  const ccw = elementGeometry(ringEl(['10'], { dir: 'ccw' }));
  for (const f of [0.1, 0.25, 0.4, 0.7]) {
    near(ccw.pointAt(f).x, cw.pointAt(1 - f).x);
    near(ccw.pointAt(f).y, cw.pointAt(1 - f).y);
  }
  assert.ok(cw.pointAt(0.25).y < 0, 'clockwise leaves the base on the upper side when heading right');
  assert.ok(ccw.pointAt(0.25).y > 0);
});

test('a ring\'s outside points away from its centre', () => {
  for (const dir of ['cw', 'ccw']) {
    const g = elementGeometry(ringEl(['10'], { dir }));
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = g.pointAt(f);
      const fromCentre = (p.x - 50) * p.out.x + p.y * p.out.y;
      assert.ok(fromCentre > 0, `${dir} at ${f}`);
    }
  }
});

test('a bridge runs between its ends and bulges by half its offset', () => {
  const g = elementGeometry(bridgeEl(['10']));
  near(g.pointAt(0).x, 0);
  near(g.pointAt(1).x, 100);
  near(g.pointAt(0.5).x, 50);
  near(g.pointAt(0.5).y, -20);
  assert.ok(g.pointAt(0.5).out.y < 0, 'outside is the bulge side');
  const other = elementGeometry(bridgeEl(['10'], { bulge: -40 }));
  near(other.pointAt(0.5).y, 20);
  assert.ok(other.pointAt(0.5).out.y > 0);
  assert.ok(elementGeometry(bridgeEl(['10'], { bulge: 0 })).pointAt(0.5).out.y < 0, 'a straight bridge uses its left');
});

test('stitch counts decide where a picot lands', () => {
  const element = ringEl(['5', 'o', '17']);
  const [picot] = circles(renderChart(pattern([element])), 'deco');
  const g = elementGeometry(element);
  const edge = g.pointAt(5 / 22);
  near(picot.x, edge.x + edge.out.x * 5.5);
  near(picot.y, edge.y + edge.out.y * 5.5);
  const later = circles(renderChart(pattern([ringEl(['17', 'o', '5'])])), 'deco')[0];
  assert.ok(Math.hypot(later.x - picot.x, later.y - picot.y) > 10);
});

test('the flower keeps its v1 picots, which pins each ring\'s direction', () => {
  const old = circles(v1.diagramDone, 'deco');
  const now = circles(renderChart(flower), 'deco');
  assert.equal(old.length, 25);
  assert.equal(now.length, 25);
  old.forEach((point, i) => {
    near(now[i].x, point.x, 1.5);
    near(now[i].y, point.y, 1.5);
  });
});

test('one tick per confirmed stitch, at stitch centres', () => {
  const element = ringEl(['5', 'o', '5']);
  const svg = renderChart(pattern([element]));
  assert.equal(count(svg, /class="tick/g), 10);
  const first = svg.match(/class="tick[^"]*"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/);
  const expected = elementGeometry(element).pointAt(0.5 / 10);
  near((Number(first[1]) + Number(first[3])) / 2, expected.x);
  near((Number(first[2]) + Number(first[4])) / 2, expected.y);
});

test('an estimated segment has no ticks and always shows its number with the error', () => {
  const svg = renderChart(pattern([ringEl(['16~3', 'o~', '5'])]));
  assert.equal(count(svg, /class="tick/g), 5);
  assert.match(svg, /≈16±3/);
  assert.match(svg, /cord-edge cord-uncertain/);
});

test('an inferred segment is dashed and shows its mark without being asked', () => {
  const svg = renderChart(pattern([ringEl(['5?', 'o', '5'])]));
  assert.match(svg, />5\?</);
  assert.equal(count(svg, /cord-uncertain/g), 1);
  assert.doesNotMatch(renderChart(pattern([ringEl(['5', 'o', '5'])])), /cord-uncertain/);
});

test('a dense element drops its ticks and shows its numbers', () => {
  const svg = renderChart(pattern([ringEl(['200'], { tip: [10, 0], width: 5 })]));
  assert.equal(count(svg, /class="tick/g), 0);
  assert.match(svg, />200</);
});

test('numbers appear only when asked, for confirmed parts', () => {
  const element = ringEl(['5', 'o', '5']);
  assert.equal(count(renderChart(pattern([element])), /class="count/g), 0);
  assert.equal(count(renderChart(pattern([element]), { counts: 'all' }), /class="count/g), 2);
  assert.equal(count(renderChart(pattern([element]), { counts: ['A'] }), /class="count/g), 2);
  assert.equal(count(renderChart(pattern([element]), { counts: ['Z'] }), /class="count/g), 0);
});

test('join picots, decorative picots and uncertain joins have different shapes', () => {
  const left = ringEl(['5', 'p:x', '5', 'o', '5']);
  const svg = renderChart(pattern([left, { ...ringEl(['5', 'j:A.x', '5']), id: 'B' }]));
  assert.equal(count(svg, /<circle class="picot join/g), 2);
  assert.equal(count(svg, /<circle class="picot deco/g), 1);
  assert.equal(count(svg, /join-uncertain/g), 0);
  assert.match(svg, /<line class="link" /);

  const unsure = renderChart(pattern([left, { ...ringEl(['5', 'j:A.x?', '5']), id: 'B' }]));
  assert.match(unsure, /<path class="picot join-uncertain/);
  assert.match(unsure, /<line class="link uncertain/);
  assert.match(unsure, />\?</);
});

test('a join link connects the two picot positions', () => {
  const left = ringEl(['5', 'p:x', '5']);
  const right = { ...ringEl(['5', 'j:A.x', '5'], { base: [50, 100], tip: [150, 100] }), id: 'B' };
  const svg = renderChart(pattern([left, right]));
  const link = svg.match(/<line class="link"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/);
  const [fromA, fromB] = circles(svg, 'join');
  near(Number(link[3]), fromA.x);
  near(Number(link[4]), fromA.y);
  near(Number(link[1]), fromB.x);
  near(Number(link[2]), fromB.y);
});

test('every uncertainty class has a dash rule, and confirmed links are solid', () => {
  for (const name of ['\\.cord-uncertain', '\\.picot\\.uncertain', '\\.picot\\.join-uncertain', '\\.link\\.uncertain', '\\.flip-mark\\.uncertain rect']) {
    assert.match(css, new RegExp(`${name} \\{[^}]*stroke-dasharray`), name);
  }
  assert.doesNotMatch(css, /\.link \{[^}]*stroke-dasharray/);
});

test('flip marks follow value and source', () => {
  const withFlip = (flip) => renderChart(pattern([{ ...ringEl(['5']), flip }]));
  assert.match(withFlip({ value: true, source: 'source' }), /class="flip-mark"[^]*>翻</);
  assert.match(withFlip({ value: true, source: 'inferred' }), /class="flip-mark uncertain"[^]*>翻\?</);
  assert.match(withFlip({ value: true, source: 'estimated' }), /class="flip-mark uncertain"[^]*>翻≈</);
  assert.doesNotMatch(withFlip({ value: false, source: 'inferred' }), /flip-mark/);
  assert.doesNotMatch(renderChart(pattern([ringEl(['5'])])), /flip-mark/);
});

test('highlight and current fade the right elements', () => {
  const elements = [ringEl(['5']), { ...ringEl(['5']), id: 'B' }, { ...ringEl(['5']), id: 'C' }];
  const faint = (svg, id) => new RegExp(`cord-core is-faint" data-el="${id}"`).test(svg);
  const plain = renderChart(pattern(elements));
  assert.doesNotMatch(plain, /is-faint/);
  const lit = renderChart(pattern(elements), { highlight: ['B'] });
  assert.equal(faint(lit, 'A'), true);
  assert.equal(faint(lit, 'B'), false);
  const working = renderChart(pattern(elements), { current: 'B', done: ['A'], highlight: ['C'] });
  assert.equal(faint(working, 'A'), false);
  assert.equal(faint(working, 'B'), false);
  assert.equal(faint(working, 'C'), true);
});

test('an uncertain element stays dashed while current', () => {
  const svg = renderChart(pattern([ringEl(['5?'])]), { current: 'A' });
  assert.match(svg, /cord-uncertain/);
});

test('reached colours progress on the current element', () => {
  const svg = renderChart(pattern([ringEl(['10'])]), { current: 'A', reached: 5 });
  assert.match(svg, /class="cord-reached"/);
  assert.doesNotMatch(renderChart(pattern([ringEl(['10'])]), { current: 'A' }), /cord-reached/);
});

test('the title is escaped once', () => {
  assert.match(renderChart(pattern([ringEl(['5'])]), { title: 'a"<b' }), /aria-label="a&quot;&lt;b"/);
});

test('the first element shows where to start', () => {
  const svg = renderChart(pattern([ringEl(['5']), { ...ringEl(['5']), id: 'B' }]));
  assert.equal(count(svg, /class="start-arrow"/g), 1);
});

test('a motif with ten rings, six bridges and joins renders whole', () => {
  const ids = 'ABCDEFGHIJKLMNOP'.split('');
  const bridges = new Set(['B', 'D', 'H', 'J', 'L', 'P']);
  const elements = ids.map((id, i) => {
    const angle = (i / ids.length) * 2 * Math.PI;
    const point = [Math.cos(angle) * 100, Math.sin(angle) * 100];
    if (bridges.has(id)) return { id, type: 'bridge', parts: ['9'], place: { from: point, to: [point[0] + 20, point[1]], bulge: 10 } };
    return { id, type: 'ring', parts: ['4', 'o', '4'], place: { base: point, tip: [point[0] * 1.5, point[1] * 1.5], width: 20, dir: i % 2 ? 'cw' : 'ccw' } };
  });
  const svg = renderChart(pattern(elements), { counts: 'all' });
  assert.doesNotMatch(svg, /NaN/);
  ids.forEach((id) => assert.match(svg, new RegExp(`>${id}</text>`)));
  assert.equal(new Set([...svg.matchAll(/cord-core[^"]*" data-el="(\w+)"/g)].map((m) => m[1])).size, 16);
});

test('the flower draws only its own numbers, marks and letters', () => {
  const svg = renderChart(flower);
  assert.doesNotMatch(svg, /NaN/);
  assert.equal(count(svg, /class="tick/g), 110);
  assert.doesNotMatch(svg, /flip-mark/);
  assert.equal(count(svg, /join-uncertain/g), 1);
  assert.equal(readElement(flower.elements[0]).stitches, 22);
});

const labFile = join(root, 'lab/letter-motif.json');
test('the private letter motif passes checks and renders', { skip: !existsSync(labFile) && 'lab/letter-motif.json is not here' }, () => {
  const motif = JSON.parse(readFileSync(labFile, 'utf8'));
  for (const result of checkPattern(motif)) assert.equal(result.ok, true, `${result.label}: ${result.detail}`);
  assert.equal(motif.tier, 'sorted');
  assert.equal(motif.elements.filter((e) => e.type === 'ring').length, 10);
  assert.equal(motif.elements.filter((e) => e.type === 'bridge').length, 6);
  assert.doesNotMatch(JSON.stringify(motif), /~/);
  assert.doesNotMatch(renderChart(motif, { counts: 'all' }), /NaN/);
});
