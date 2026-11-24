// A chart far taller than wide is shown in windows on the pattern page, so its numbers stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  elementGeometry, overviewWindows, renderChart, TALL_OVERVIEW, windowFor,
} from '../js/diagram.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const fishbone = read('patterns/fishbone.json');

// The pattern page chart on a 375-wide phone is a 349 by 349 frame (see style.css and chart.test.mjs).
const PHONE = 349;
// How tall a full-size number (13 units at a 370-wide chart) shows, in px, for this part of the chart.
const numberPx = (pattern, [, , w, h]) => {
  const s = pattern.layout.viewBox[2] / 370;
  return 13 * s * Math.min(PHONE / w, PHONE / h);
};

test('only a chart taller than it is wide by more than the limit gets windows', () => {
  for (const id of read('patterns/index.json')) {
    const pattern = read(`patterns/${id}.json`);
    const [, , w, h] = pattern.layout.viewBox;
    assert.equal(overviewWindows(pattern).length > 0, h > w * TALL_OVERVIEW, id);
  }
});

test('the fishbone windows run the full width, top to bottom with no gap, and keep numbers readable on a phone', () => {
  const [x, y, w, h] = fishbone.layout.viewBox;
  const windows = overviewWindows(fishbone);
  assert.ok(windows.length >= 3);
  assert.equal(windows[0][1], y);
  const last = windows.at(-1);
  assert.ok(Math.abs(last[1] + last[3] - (y + h)) < 1e-6);
  windows.forEach((box, i) => {
    assert.equal(box[0], x);
    assert.equal(box[2], w);
    assert.ok(box[3] <= w * 1.3 + 1e-6, `window ${i + 1} is ${box[3] / w} times as tall as wide`);
    if (i > 0) assert.ok(box[1] <= windows[i - 1][1] + windows[i - 1][3] + 1e-6, `a gap before window ${i + 1}`);
    assert.ok(numberPx(fishbone, box) >= 9.5, `window ${i + 1}: ${numberPx(fishbone, box).toFixed(1)}px`);
  });
  // Whole, the same chart shows its numbers at about 3px.
  assert.ok(numberPx(fishbone, fishbone.layout.viewBox) < 4);
});

test('a window ends in a gap of the drawing when there is one near, so the head stays in one window', () => {
  const [head] = overviewWindows(fishbone);
  const bottom = head[1] + head[3];
  const firstSpine = fishbone.elements.findIndex((e) => e.id === 'S1');
  fishbone.elements.forEach((element, index) => {
    const geometry = elementGeometry(element);
    const ys = Array.from({ length: 41 }, (_, i) => geometry.pointAt(i / 40).y);
    if (index < firstSpine) assert.ok(Math.max(...ys) < bottom, `${element.id} crosses out of the head window`);
    else assert.ok(Math.min(...ys) > bottom, `${element.id} reaches into the head window`);
  });
});

test('a tall chart of two motifs a window apart is cut in the empty band between them', () => {
  const ring = (id, y) => ({ id, type: 'ring', parts: ['8'], place: { base: [50, y], tip: [50, y - 60], width: 40, dir: 'cw' } });
  const pattern = { layout: { viewBox: [0, -70, 100, 260] }, elements: [ring('A', 0), ring('B', 180)] };
  const windows = overviewWindows(pattern);
  assert.equal(windows.length, 2);
  // The rings cover y -60 to 0 and 120 to 180; the cut is the middle of the band between them.
  assert.equal(windows[0][1] + windows[0][3], 60);
  assert.equal(windows[1][1], 60);
});

test('a frame shows part of the chart with every mark where the whole chart puts it', () => {
  const [, second] = overviewWindows(fishbone);
  const whole = renderChart(fishbone, { title: 't' });
  const framed = renderChart(fishbone, { title: 't', frame: second });
  assert.match(framed, new RegExp(`viewBox="${second.map((v) => v.toFixed(1)).join(' ')}"`));
  const body = (svg) => svg.slice(svg.indexOf('>') + 1);
  assert.equal(body(framed), body(whole));
});

test('a highlighted row brings up the window that holds it', () => {
  const windows = overviewWindows(fishbone);
  assert.equal(windowFor(fishbone, windows, ['A', 'B1']), 0);
  assert.equal(windowFor(fishbone, windows, ['T6', 'T13']), windows.length - 1);
  const spine = windowFor(fishbone, windows, ['R3', 'L3']);
  assert.ok(spine > 0 && spine < windows.length - 1);
});
