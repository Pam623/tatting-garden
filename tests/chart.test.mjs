import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { drawingShare, elementGeometry, focusBox, renderChart } from '../js/diagram.js';
import { checkPattern, readElement } from '../js/pattern.js';

const root = new URL('..', import.meta.url).pathname;
const flower = JSON.parse(readFileSync(join(root, 'patterns/little-flower.json'), 'utf8'));
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

// The base and tip of each decorative picot: the start, and the end of its first curve.
function picotTips(svg) {
  return [...svg.matchAll(/<path class="picot deco[^"]*"[^>]*d="M([-\d.]+) ([-\d.]+)C[^C]*? ([-\d.]+) ([-\d.]+)C/g)]
    .map((m) => ({ base: { x: Number(m[1]), y: Number(m[2]) }, tip: { x: Number(m[3]), y: Number(m[4]) } }));
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

test('stitch counts decide where a picot lands, a fixed offset out', () => {
  const element = ringEl(['5', 'o', '17']);
  const [picot] = picotTips(renderChart(pattern([element])));
  const edge = elementGeometry(element).pointAt(5 / 22);
  near(picot.base.x, edge.x);
  near(picot.base.y, edge.y);
  near(picot.tip.x, edge.x + edge.out.x * 11);
  near(picot.tip.y, edge.y + edge.out.y * 11);
  const later = picotTips(renderChart(pattern([ringEl(['17', 'o', '5'])])))[0];
  assert.ok(Math.hypot(later.base.x - picot.base.x, later.base.y - picot.base.y) > 10);
});

test('each stitch segment is one cord path, with no ticks or doubled edge', () => {
  const svg = renderChart(pattern([ringEl(['5', 'o', '5', 'p:x', '5'])]));
  assert.equal(count(svg, /<path class="cord"/g), 3);
  assert.doesNotMatch(svg, /tick|cord-edge|cord-core|cord-uncertain/);
  assert.match(css, /\.cord \{[^}]*stroke-width: calc\(1\.8px/);
});

test('a decorative picot is a small path of class picot deco, not a circle', () => {
  const svg = renderChart(pattern([ringEl(['5', 'o', '5'])]));
  assert.equal(count(svg, /<path class="picot deco"/g), 1);
  assert.doesNotMatch(svg, /<circle class="picot deco/);
  const { base, tip } = picotTips(svg)[0];
  assert.ok(Math.hypot(tip.x - base.x, tip.y - base.y) < 12);
});

test('numbers show on the first of each group, or on every ungrouped element', () => {
  const grouped = [
    { ...ringEl(['5']), id: 'A', group: 'g' }, { ...ringEl(['6']), id: 'B', group: 'g' },
    { ...ringEl(['7']), id: 'C', group: 'h' }, { ...ringEl(['8']), id: 'D' },
  ];
  const svg = renderChart(pattern(grouped));
  const labelled = [...svg.matchAll(/class="count[^"]*" data-el="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(labelled, ['A', 'C', 'D']);
  assert.equal(count(renderChart(pattern(grouped), { highlight: ['B'] }), /class="count/g), 0);
  assert.equal(count(renderChart(pattern(grouped), { current: 'A' }), /class="count/g), 0);
  assert.equal(count(renderChart(pattern(grouped), { counts: 'all' }), /class="count/g), 4);
});

test('a dashed thread joins ring bases that differ, and not shared ones or bridges', () => {
  const a = ringEl(['5']);
  const b = { ...ringEl(['5'], { base: [50, 80], tip: [150, 80] }), id: 'B' };
  assert.equal(count(renderChart(pattern([a, b])), /<line class="thread"/g), 1);
  const same = { ...ringEl(['5'], { tip: [0, 90] }), id: 'B' };
  assert.equal(count(renderChart(pattern([a, same])), /<line class="thread/g), 0);
  const bridge = { ...bridgeEl(['5'], { from: [0, 0], to: [50, 80] }), id: 'B' };
  assert.equal(count(renderChart(pattern([a, bridge, { ...b, id: 'C' }])), /<line class="thread/g), 0);
  assert.match(css, /\.thread \{[^}]*stroke-dasharray/);
});

test('numbers can be asked for by element', () => {
  const element = ringEl(['5', 'o', '5']);
  assert.equal(count(renderChart(pattern([element]), { counts: 'all' }), /class="count/g), 2);
  assert.equal(count(renderChart(pattern([element]), { counts: ['A'] }), /class="count/g), 2);
  assert.equal(count(renderChart(pattern([element]), { counts: ['Z'] }), /class="count/g), 0);
});

test('join picots are solid dots and joins are thin links', () => {
  const left = ringEl(['5', 'p:x', '5', 'o', '5']);
  const svg = renderChart(pattern([left, { ...ringEl(['5', 'j:A.x', '5']), id: 'B' }]));
  assert.equal(count(svg, /<circle class="picot join/g), 2);
  assert.equal(count(svg, /<path class="picot deco/g), 1);
  assert.equal(count(svg, /<line class="link"/g), 1);
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

test('no uncertainty is drawn, even for marked parts', () => {
  const svg = renderChart(pattern([ringEl(['5?', 'o~', '5~2', 'p:x?', '5'])]), { counts: 'all' });
  assert.doesNotMatch(svg, /uncertain|mark-q|>\?<|≈/);
  assert.doesNotMatch(css, /uncertain|part-unsure|mark-unsure/);
});

test('a flip with value true is marked 翻, whatever its source', () => {
  const withFlip = (flip) => renderChart(pattern([{ ...ringEl(['5']), flip }]));
  assert.match(withFlip({ value: true, source: 'source' }), /class="flip-mark"[^]*>翻</);
  assert.match(withFlip({ value: true, source: 'inferred' }), /class="flip-mark"[^]*>翻</);
  assert.doesNotMatch(withFlip({ value: false, source: 'inferred' }), /flip-mark/);
  assert.doesNotMatch(renderChart(pattern([ringEl(['5'])])), /flip-mark/);
});

test('highlight and current fade the right elements', () => {
  const elements = [ringEl(['5']), { ...ringEl(['5']), id: 'B' }, { ...ringEl(['5']), id: 'C' }];
  const faint = (svg, id) => new RegExp(`cord is-faint" data-el="${id}"`).test(svg);
  const plain = renderChart(pattern(elements));
  assert.doesNotMatch(plain, /is-faint/);
  const lit = renderChart(pattern(elements), { highlight: ['B'] });
  assert.equal(faint(lit, 'A'), true);
  assert.equal(faint(lit, 'B'), false);
  const everything = renderChart(pattern([
    ringEl(['5', 'p:x', '5', 'o', '5']),
    { ...ringEl(['5', 'j:A.x', '5']), id: 'B', flip: { value: true, source: 'source' } },
  ]), { highlight: ['Z'], counts: 'all' });
  const marks = [...everything.matchAll(/<(?:path|line|circle|text|g) class="([^"]*)"[^>]*data-el="\w+"/g)];
  assert.ok(marks.length > 10);
  marks.forEach((mark) => assert.match(mark[1], /is-faint/, mark[0]));
  const working = renderChart(pattern(elements), { current: 'B', done: ['A'], highlight: ['C'] });
  assert.equal(faint(working, 'A'), false);
  assert.equal(faint(working, 'B'), false);
  assert.equal(faint(working, 'C'), true);
});

test('reached colours progress on the current element', () => {
  const element = ringEl(['10']);
  const svg = renderChart(pattern([element]), { current: 'A', reached: 5 });
  assert.match(svg, /class="cord-reached"/);
  const path = svg.match(/class="cord-reached"[^>]*d="([^"]+)"/)[1];
  const [lastX, lastY] = path.split('L').at(-1).split(' ').map(Number);
  near(lastX, elementGeometry(element).pointAt(0.5).x);
  near(lastY, elementGeometry(element).pointAt(0.5).y);
  assert.doesNotMatch(renderChart(pattern([ringEl(['10'])]), { current: 'A' }), /cord-reached/);
});

test('the current element is always marked, before any part is chosen', () => {
  const svg = renderChart(pattern([ringEl(['5']), { ...ringEl(['5']), id: 'B' }]), { current: 'A', done: ['B'] });
  assert.match(svg, /class="cord is-current" data-el="A"/);
  assert.doesNotMatch(svg, /is-current" data-el="B"/);
  assert.match(css, /\.cord\.is-current \{[^}]*--mark-current/);
});

test('a view can frame chosen elements, and marks scale to it', () => {
  const far = { ...ringEl(['5'], { base: [500, 500], tip: [600, 500] }), id: 'Z' };
  const all = pattern([ringEl(['5']), far]);
  const box = focusBox(all, ['A']);
  near(box[0], -34, 1);
  assert.ok(box[0] + box[2] < 200, 'the far element is left out');
  const svg = renderChart(all, { viewBox: [0, 0, 185, 185] });
  assert.match(svg, /viewBox="0 0 185 185"/);
  assert.match(svg, /--s:0\.5"/);
});

test('the title is escaped once', () => {
  assert.match(renderChart(pattern([ringEl(['5'])]), { title: 'a"<b' }), /aria-label="a&quot;&lt;b"/);
});

test('marks scale with the viewBox', () => {
  const big = { ...pattern([ringEl(['5'])]), layout: { viewBox: [0, 0, 740, 740] } };
  assert.match(renderChart(big), /--s:2"/);
});

test('a bridge letter sits on its outside when nothing is in the way, with its number on the same side', () => {
  const element = bridgeEl(['5']);
  const svg = renderChart(pattern([element]));
  const mid = elementGeometry(element).pointAt(0.5);
  const sideOf = (y) => Math.sign((y - mid.y) * mid.out.y);
  const letter = Number(svg.match(/class="letter"[^>]*y="([-\d.]+)"/)[1]);
  const number = Number(svg.match(/class="count"[^>]*y="([-\d.]+)"/)[1]);
  assert.equal(sideOf(letter), 1);
  assert.equal(sideOf(number), 1);
});

test('the first element shows where to start', () => {
  const svg = renderChart(pattern([ringEl(['5']), { ...ringEl(['5']), id: 'B' }]));
  assert.equal(count(svg, /class="start-arrow"/g), 1);
  assert.match(svg, />起点</);
  const working = renderChart(pattern([ringEl(['5']), { ...ringEl(['5']), id: 'B' }]), { current: 'B' });
  assert.equal(count(working, /class="start-arrow"/g), 2, 'the current element shows its direction too');
});

test('a motif with ten rings, six bridges and joins renders whole', () => {
  const ids = 'ABCDEFGHIJKLMNOP'.split('');
  const bridges = new Set(['B', 'D', 'H', 'J', 'L', 'P']);
  const elements = ids.map((id, i) => {
    const angle = (i / ids.length) * 2 * Math.PI;
    const point = [Math.cos(angle) * 100, Math.sin(angle) * 100];
    if (bridges.has(id)) return { id, type: 'bridge', parts: ['9'], place: { from: point, to: [point[0] + 20, point[1]], bulge: 10 } };
    if (id === 'C') return { id, type: 'ring', parts: ['4', 'p:x', '4'], place: { base: point, tip: [point[0] * 1.5, point[1] * 1.5], width: 20, dir: 'cw' } };
    if (id === 'E') return { id, type: 'ring', parts: ['4', 'j:C.x', '4'], place: { base: point, tip: [point[0] * 1.5, point[1] * 1.5], width: 20, dir: 'cw' } };
    return { id, type: 'ring', parts: ['4', 'o', '4'], place: { base: point, tip: [point[0] * 1.5, point[1] * 1.5], width: 20, dir: i % 2 ? 'cw' : 'ccw' } };
  });
  const svg = renderChart(pattern(elements), { counts: 'all' });
  assert.doesNotMatch(svg, /NaN/);
  assert.equal(count(svg, /<line class="link"/g), 1);
  ids.forEach((id) => assert.match(svg, new RegExp(`>${id}</text>`)));
  assert.equal(new Set([...svg.matchAll(/class="cord[^"]*" data-el="(\w+)"/g)].map((m) => m[1])).size, 16);
});

test('the flower draws only its own numbers, marks and letters', () => {
  const svg = renderChart(flower);
  assert.doesNotMatch(svg, /NaN/);
  assert.doesNotMatch(svg, /tick|uncertain/);
  assert.equal(count(svg, /<path class="picot deco/g), 25);
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

test('the edging covers little of a phone chart frame, a round motif covers much of it', () => {
  const share = (id) => {
    const pattern = JSON.parse(readFileSync(join(root, `patterns/${id}.json`), 'utf8'));
    return drawingShare(pattern.layout.viewBox, focusBox(pattern, pattern.elements.map((e) => e.id), 0), 359, 330);
  };
  assert.ok(share('arch-edging') < 0.35);
  assert.ok(share('little-flower') > 0.5);
  assert.ok(share('leaf-braid') >= 0.35);
  assert.equal(drawingShare([0, 0, 100, 100], [0, 0, 100, 100], 200, 200), 1);
  assert.equal(drawingShare([0, 0, 100, 100], [0, 0, 50, 50], 0, 0), 1);
});
