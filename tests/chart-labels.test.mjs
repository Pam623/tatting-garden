import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chartLabels, leftPicotSpots, readChartElements, renderChart } from '../js/diagram.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

function labelsOf(pattern) {
  const [minX, minY, width, height] = pattern.layout.viewBox;
  const s = width / 370;
  const elements = readChartElements(pattern);
  const labels = chartLabels(elements, leftPicotSpots(elements, s), s, { minX, minY, width, height });
  const named = [];
  labels.flip.forEach((box, id) => named.push({ ...box, name: `翻 ${id}`, own: id, bead: true }));
  labels.letter.forEach((box, id) => named.push({ ...box, name: `字母 ${id}`, own: null }));
  labels.count.forEach((box, key) => named.push({ ...box, name: `数字 ${key}`, own: null }));
  named.push({ ...labels.start, name: '起点', own: null });
  return { elements, named };
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
function labelsOnLines({ elements, named }) {
  const hits = [];
  named.forEach((label) => {
    elements.forEach((element) => {
      if (label.own === element.id) return;
      for (let i = 0; i <= 300; i++) {
        const p = element.geometry.pointAt(i / 300);
        if (Math.abs(p.x - label.x) < label.w / 2 && Math.abs(p.y - label.y) < label.h / 2) {
          hits.push(`${label.name} 压在 ${element.id} 上`);
          break;
        }
      }
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

test('a label stays put whichever numbers are showing', () => {
  const pattern = read('patterns/little-flower.json');
  const letters = (options) => [...renderChart(pattern, options).matchAll(/class="letter[^"]*"[^>]*x="[^"]+" y="[^"]+"/g)].map((m) => m[0]);
  assert.deepEqual(letters({ counts: [] }), letters({ counts: 'all' }));
});
