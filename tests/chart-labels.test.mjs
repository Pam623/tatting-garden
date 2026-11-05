import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyLayout, fitLayout } from '../js/fit-layout.js';
import { chartLabels, leftPicotSpots, readChartElements, renderChart } from '../js/diagram.js';
import { traceDesign } from '../js/trace-design.js';
import { SKETCHES } from './fixtures/sketches.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function labelsOf(pattern, shows) {
  const [minX, minY, width, height] = pattern.layout.viewBox;
  const s = width / 370;
  const elements = readChartElements(pattern);
  const labels = chartLabels(elements, leftPicotSpots(elements, s), s, { minX, minY, width, height }, shows);
  const named = [];
  labels.flip.forEach((box, id) => named.push({ ...box, name: `翻 ${id}`, own: id, bead: true }));
  labels.letter.forEach((box, id) => named.push({ ...box, name: `字母 ${id}`, own: null }));
  labels.count.forEach((box, key) => named.push({ ...box, name: `数字 ${key}`, own: null }));
  named.push({ ...labels.start, name: '起点', own: null });
  return { elements, named, scale: s };
}

// Checked with its own overlap test, so a slip in the placement code can't hide here.
function labelsTouching({ named }) {
  const touching = [];
  named.forEach((a, i) => named.slice(i + 1).forEach((b) => {
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) touching.push(`${a.name} / ${b.name}`);
  }));
  return touching;
}

// Letters and numbers stay off every line; a flip mark is a bead on its own cord and stays off the others.
function labelsOnLines({ elements, named, scale }) {
  const hits = [];
  named.forEach((label) => {
    elements.forEach((element) => {
      if (label.own !== element.id) {
        for (let i = 0; i <= 300; i++) {
          const p = element.geometry.pointAt(i / 300);
          if (Math.abs(p.x - label.x) < label.w / 2 && Math.abs(p.y - label.y) < label.h / 2) {
            hits.push(`${label.name} 压在 ${element.id} 上`);
            break;
          }
        }
      }
      // The picots and decorative ears stand out from the line, and a label must not cover them either.
      element.items.filter((item) => item.kind !== 'stitch').forEach((item) => {
        const p = element.geometry.pointAt(item.from / element.stitches);
        const reach = item.kind === 'deco' ? 9 : 5.5;
        const x = p.x + p.out.x * reach * scale;
        const y = p.y + p.out.y * reach * scale;
        if (Math.abs(x - label.x) < label.w / 2 && Math.abs(y - label.y) < label.h / 2) hits.push(`${label.name} 压在 ${element.id} 的耳上`);
      });
    });
  });
  return hits;
}

for (const path of ['patterns/leaf-braid.json', 'patterns/little-flower.json', 'patterns/letter-motif.json']) {
  test(`${path}: no label touches another or lies on a line`, () => {
    const layout = labelsOf(read(path));
    assert.deepEqual(labelsTouching(layout), []);
    assert.deepEqual(labelsOnLines(layout), []);
  });
}

for (const name of ['sketch-heart', 'sketch-butterfly']) {
  test(`${name}, laid out by the fitter: as shown by default, no label touches another or lies on a line`, () => {
    const pattern = read(`tests/fixtures/${name}.json`);
    // The chart numbers one of each group by default, which is the left half of a mirrored design.
    const seen = new Set();
    const firstOfGroup = (element) => {
      if (element.group === undefined) return true;
      if (seen.has(element.group)) return false;
      seen.add(element.group);
      return true;
    };
    const layout = labelsOf(applyLayout(pattern, fitLayout(pattern, { aspect: 1 })), firstOfGroup);
    assert.deepEqual(labelsTouching(layout), []);
    assert.deepEqual(labelsOnLines(layout), []);
  });
}

// The most air, in the units marks are designed at, between a label and the line it describes.
const MOST_AIR = 6;
// In the tightest corners a neighbour's line may come this much nearer than the label's own.
const CLOSER_ALLOWED = 2;

// Measured from the data, not from the placement code: every label against its own stretch of line.
function pointsBetween(element, from, to) {
  return Array.from({ length: 61 }, (_, i) => element.geometry.pointAt(from + ((to - from) * i) / 60));
}

function airTo(box, points) {
  return Math.min(...points.map((p) => Math.hypot(Math.max(Math.abs(p.x - box.x) - box.w / 2, 0), Math.max(Math.abs(p.y - box.y) - box.h / 2, 0))));
}

function insideOutline(point, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Which side of a bridge a label is on: +1 for the side its out points to.
function sideOfBridge(element, box) {
  const points = pointsBetween(element, 0, 1);
  const p = points.reduce((a, b) => (Math.hypot(b.x - box.x, b.y - box.y) < Math.hypot(a.x - box.x, a.y - box.y) ? b : a));
  return Math.sign((box.x - p.x) * p.out.x + (box.y - p.y) * p.out.y);
}

function labelFaults(pattern, shows = () => true) {
  const [minX, minY, width, height] = pattern.layout.viewBox;
  const s = width / 370;
  const elements = readChartElements(pattern);
  const labels = chartLabels(elements, leftPicotSpots(elements, s), s, { minX, minY, width, height }, shows);
  const faults = [];
  const inFrame = (box) => box.x - box.w / 2 >= minX && box.x + box.w / 2 <= minX + width && box.y - box.h / 2 >= minY && box.y + box.h / 2 <= minY + height;
  elements.forEach((element) => {
    const letter = labels.letter.get(element.id);
    const whole = pointsBetween(element, 0, 1);
    const inOwnRing = element.type === 'ring' && insideOutline(letter, whole);
    if (!inOwnRing && airTo(letter, whole) > MOST_AIR * s) faults.push(`字母 ${element.id} 离自己 ${(airTo(letter, whole) / s).toFixed(1)}`);
    if (!inFrame(letter)) faults.push(`字母 ${element.id} 出了外框`);
    const sides = new Set(element.type === 'bridge' ? [sideOfBridge(element, letter)] : []);
    element.items.forEach((item, index) => {
      const box = labels.count.get(`${element.id}:${index}`);
      if (!box) return;
      const name = `${element.id} 的第 ${index + 1} 段`;
      const air = airTo(box, pointsBetween(element, item.from / element.stitches, item.to / element.stitches));
      if (air > MOST_AIR * s) faults.push(`${name} 的数字离自己 ${(air / s).toFixed(1)}`);
      if (!inFrame(box)) faults.push(`${name} 的数字出了外框`);
      if (element.type === 'bridge') sides.add(sideOfBridge(element, box));
      elements.filter((other) => other !== element).forEach((other) => {
        const toOther = airTo(box, pointsBetween(other, 0, 1));
        if (toOther + CLOSER_ALLOWED * s < air) faults.push(`${name} 的数字离 ${other.id} 比离自己还近`);
      });
    });
    if (sides.size > 1) faults.push(`${element.id} 桥的字母和数字不在同一侧`);
  });
  return faults;
}

const firstOfEachGroup = () => {
  const seen = new Set();
  return (element) => {
    if (element.group === undefined) return true;
    if (seen.has(element.group)) return false;
    seen.add(element.group);
    return true;
  };
};

const fittedFixture = (name) => {
  const pattern = read(`tests/fixtures/${name}.json`);
  return applyLayout(pattern, fitLayout(pattern, { aspect: 1 }));
};

for (const path of ['patterns/leaf-braid.json', 'patterns/little-flower.json', 'patterns/letter-motif.json']) {
  test(`${path}: every number and letter sits right beside what it describes`, () => {
    const pattern = read(path);
    assert.deepEqual(labelFaults(pattern, firstOfEachGroup()), []);
    assert.deepEqual(labelFaults(pattern), []);
  });
}

for (const name of ['sketch-heart', 'sketch-butterfly']) {
  test(`${name}, laid out by the fitter: every number and letter sits right beside what it describes`, () => {
    const pattern = fittedFixture(name);
    assert.deepEqual(labelFaults(pattern, firstOfEachGroup()), []);
    assert.deepEqual(labelFaults(pattern), []);
  });
}

for (const [name, strokes] of Object.entries(SKETCHES)) {
  test(`${name}, traced from the drawing: no label touches or crowds anything`, () => {
    const { pattern } = traceDesign({ strokes });
    const [minX, minY, width, height] = pattern.layout.viewBox;
    assert.ok(minX < 0 && minY < 1e9 && width > 0 && height > 0);
    for (const shows of [firstOfEachGroup(), () => true]) {
      const layout = labelsOf(pattern, shows);
      assert.deepEqual(labelsTouching(layout), []);
      assert.deepEqual(labelsOnLines(layout), []);
    }
    assert.deepEqual(labelFaults(pattern, firstOfEachGroup()), []);
    assert.deepEqual(labelFaults(pattern), []);
  });
}

test('a label pushed far from its line would be caught', () => {
  const pattern = read('patterns/little-flower.json');
  const [minX, minY, width, height] = pattern.layout.viewBox;
  const s = width / 370;
  const element = readChartElements(pattern)[0];
  const p = element.geometry.pointAt(0.1);
  const far = { x: p.x + p.out.x * 40 * s, y: p.y + p.out.y * 40 * s, w: 10 * s, h: 13 * s };
  assert.ok(airTo(far, pointsBetween(element, 0, 0.2)) > MOST_AIR * s);
  assert.ok(minX < far.x && minY < far.y && far.x < minX + width && far.y < minY + height);
});

test('a label stays put whichever numbers are showing', () => {
  const pattern = read('patterns/little-flower.json');
  const letters = (options) => [...renderChart(pattern, options).matchAll(/class="letter[^"]*"[^>]*x="[^"]+" y="[^"]+"/g)].map((m) => m[0]);
  assert.deepEqual(letters({ counts: [] }), letters({ counts: 'all' }));
});
