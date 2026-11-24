// Cutting a tall chart into windows always ends, with finite windows that move down and cover it,
// whatever the drawing: labels or arrows may reach past the chart's edge, and nothing may be clear.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_WINDOWS, overviewWindows } from '../js/diagram.js';
import { structureProblems } from '../js/pattern.js';

function assertWindows(pattern, aspect, label) {
  const [, minY, , height] = pattern.layout.viewBox;
  const windows = overviewWindows(pattern, { aspect });
  assert.ok(windows.length >= 1 && windows.length <= MAX_WINDOWS, `${label}: ${windows.length} windows`);
  windows.forEach((box, i) => {
    assert.ok(box.every(Number.isFinite), `${label}: window ${i + 1} is ${box}`);
    assert.ok(box[3] > 0, `${label}: window ${i + 1} has no height`);
    if (i > 0) {
      assert.ok(box[1] > windows[i - 1][1], `${label}: window ${i + 1} does not move on`);
      assert.ok(box[1] <= windows[i - 1][1] + windows[i - 1][3] + 1e-6, `${label}: a gap before window ${i + 1}`);
    }
  });
  assert.equal(windows[0][1], minY, `${label}: does not start at the top`);
  const last = windows.at(-1);
  assert.ok(Math.abs(last[1] + last[3] - (minY + height)) < 1e-6, `${label}: does not reach the bottom`);
}

const ring = (id, base, extra = {}) => ({
  id, type: 'ring', parts: ['6', 'o', '6'], place: { base: [185, base], tip: [185, base - 30], width: 24, dir: 'cw' }, ...extra,
});

test('Kimi\'s seven rings, whose last start arrow reaches past the bottom, end in finite windows', { timeout: 20000 }, () => {
  const bases = [82.21, 197.36, 285.29, 387.63, 421.94, 474.81, 511.99];
  const pattern = {
    id: 'seven', title: '七个环', tier: 'sorted', rights: { kind: 'original' },
    layout: { viewBox: [0, -80, 370, 592.1039] },
    elements: bases.map((base, i) => ring(String.fromCharCode(65 + i), base, i > 0 ? { round: i + 1 } : {})),
  };
  assert.deepEqual(structureProblems(pattern), []);
  for (let step = 30; step <= 160; step += 1) assertWindows(pattern, step / 100, `aspect ${step / 100}`);
  assertWindows(pattern, 0.332, 'aspect 0.332');
});

// A small fixed-seed generator, so a failure can be run again.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// A tall chart of rings and bridges, laid out top to bottom with random gaps, sizes and rounds;
// its view box hugs the drawing, so labels and arrows can reach past it.
function tallPattern(next, index) {
  const count = 3 + Math.floor(next() * 9);
  const width = 120 + next() * 400;
  const elements = [];
  let y = 0;
  let ring = 0;
  for (let i = 0; i < count; i++) {
    y += 15 + next() * 140;
    const x = 30 + next() * (width - 60);
    const round = elements.length > 0 && next() < 0.3 ? { round: 2 + elements.filter((e) => e.round !== undefined).length } : {};
    const id = `E${i}`;
    if (next() < 0.6) {
      ring += 1;
      elements.push({
        id, type: 'ring', parts: [String(2 + Math.floor(next() * 8)), 'o', String(2 + Math.floor(next() * 8))], ...round,
        place: { base: [x, y], tip: [x + (next() - 0.5) * 60, y - 20 - next() * 60], width: 10 + next() * 40, dir: next() < 0.5 ? 'cw' : 'ccw' },
      });
    } else {
      const to = [30 + next() * (width - 60), y + 10 + next() * 80];
      // A bridge after a ring starts at its base; before the next ring it is kept apart by a round.
      const before = elements.at(-1);
      const from = before?.type === 'ring' && round.round === undefined ? before.place.base : [x, y];
      elements.push({ id, type: 'bridge', parts: [String(3 + Math.floor(next() * 12))], ...round, place: { from, to, bulge: (next() - 0.5) * 120 } });
      y = Math.max(y, to[1]);
    }
  }
  // A ring right after a bridge must start where the bridge ended, unless it starts new thread.
  elements.forEach((element, i) => {
    const before = elements[i - 1];
    if (element.type === 'ring' && before?.type === 'bridge' && element.round === undefined) {
      const [bx, by] = before.place.to;
      element.place = { ...element.place, base: [bx, by], tip: [bx, by - 40] };
    }
  });
  const ys = elements.flatMap((e) => (e.type === 'ring' ? [e.place.base[1], e.place.tip[1]] : [e.place.from[1], e.place.to[1]]));
  const top = Math.min(...ys) - 10;
  const height = Math.max(Math.max(...ys) - top + 10, width * 1.7);
  return { id: `random-${index}`, title: `随机 ${index}`, tier: 'sorted', rights: { kind: 'original' }, layout: { viewBox: [0, top, width, height] }, elements };
}

test('many random tall charts end in finite windows that move down and cover the chart, in every frame', { timeout: 120000 }, () => {
  const next = random(20261125);
  let checked = 0;
  for (let index = 0; index < 60; index++) {
    const pattern = tallPattern(next, index);
    if (structureProblems(pattern).length) continue;
    checked += 1;
    for (let step = 30; step <= 160; step += 5) assertWindows(pattern, step / 100, `${pattern.id} aspect ${step / 100}`);
    // Frames too flat or not numbers at all are taken as the flattest frame or a square one.
    [0, -2, 0.01, Number.NaN, Number.POSITIVE_INFINITY].forEach((aspect) => assertWindows(pattern, aspect, `${pattern.id} aspect ${aspect}`));
  }
  assert.ok(checked >= 40, `only ${checked} of the random charts were valid`);
});
