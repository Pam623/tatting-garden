// A chart far taller than wide is shown in windows on the pattern page, so its numbers stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  elementGeometry, overviewWindows, renderChart, TALL_OVERVIEW, windowFor,
} from '../js/diagram.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const fishbone = read('patterns/fishbone.json');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// The pattern page chart frame on a phone, from style.css: as wide as the page less the plate's
// and paper's padding and the outline, and as tall as the share of the screen the chart is given.
const phoneCss = css.slice(css.indexOf('@media (max-width: 820px)'));
const platePad = Number(phoneCss.match(/\.pattern-plate \{[^}]*padding: \d+px (\d+)px;/)[1]);
const paperPad = Number(phoneCss.match(/\.pattern-plate \.paper \{ padding: (\d+)px;/)[1]);
const chartShare = Number(phoneCss.match(/\.pattern-plate \.diagram \{ height: (\d+)dvh;/)[1]) / 100;
const phoneFrame = (screenWidth, screenHeight) => ({
  width: screenWidth - 2 * platePad - 2 * paperPad - 2,
  height: screenHeight * chartShare,
});
const PHONES = [[375, 812], [375, 667], [360, 640]];

// How tall a full-size number (13 units at a 370-wide chart) shows, in px, for this part of the chart.
const numberPx = (pattern, [, , w, h], frame) => {
  const s = pattern.layout.viewBox[2] / 370;
  return 13 * s * Math.min(frame.width / w, frame.height / h);
};
const windowsFor = (pattern, frame) => overviewWindows(pattern, { aspect: frame.height / frame.width });

test('only a chart taller than it is wide by more than the limit gets windows', () => {
  for (const id of read('patterns/index.json')) {
    const pattern = read(`patterns/${id}.json`);
    const [, , w, h] = pattern.layout.viewBox;
    assert.equal(overviewWindows(pattern).length > 0, h > w * TALL_OVERVIEW, id);
  }
});

for (const [screenWidth, screenHeight] of PHONES) {
  test(`on a ${screenWidth} by ${screenHeight} phone every fishbone window shows numbers at 9.5px or more`, () => {
    const frame = phoneFrame(screenWidth, screenHeight);
    const [x, y, w, h] = fishbone.layout.viewBox;
    const windows = windowsFor(fishbone, frame);
    assert.ok(windows.length >= 3);
    assert.equal(windows[0][1], y);
    const last = windows.at(-1);
    assert.ok(Math.abs(last[1] + last[3] - (y + h)) < 1e-6);
    windows.forEach((box, i) => {
      assert.equal(box[0], x);
      assert.equal(box[2], w);
      if (i > 0) assert.ok(box[1] <= windows[i - 1][1] + windows[i - 1][3] + 1e-6, `a gap before window ${i + 1}`);
      const px = numberPx(fishbone, box, frame);
      assert.ok(px >= 9.5, `window ${i + 1}: ${px.toFixed(2)}px`);
    });
    // Whole, the same chart shows its numbers at about 3px.
    assert.ok(numberPx(fishbone, fishbone.layout.viewBox, frame) < 4);
  });
}

test('in a frame about as tall as wide, the head window ends in the gap before the spine', () => {
  const [head] = overviewWindows(fishbone, { aspect: 1 });
  const bottom = head[1] + head[3];
  const firstSpine = fishbone.elements.findIndex((e) => e.id === 'S1');
  fishbone.elements.forEach((element, index) => {
    const geometry = elementGeometry(element);
    const ys = Array.from({ length: 41 }, (_, i) => geometry.pointAt(i / 40).y);
    if (index < firstSpine) assert.ok(Math.max(...ys) < bottom, `${element.id} crosses out of the head window`);
    else assert.ok(Math.min(...ys) > bottom, `${element.id} reaches into the head window`);
  });
});

const ring = (id, y, extra = {}) => ({ id, type: 'ring', parts: ['8'], place: { base: [50, y], tip: [50, y - 60], width: 40, dir: 'cw' }, ...extra });
const twoMotifs = (second) => ({ layout: { viewBox: [0, -65, 100, 250] }, elements: [ring('A', 0, { parts: ['4', 'p:top', '4'] }), second] });

test('a tall chart of two motifs a window apart is cut in the empty band between them', () => {
  // Ring B starts new thread, so nothing is drawn between y 0 and 120.
  const windows = overviewWindows(twoMotifs(ring('B', 180, { round: 2 })));
  assert.equal(windows.length, 2);
  assert.equal(windows[0][1] + windows[0][3], 60);
  assert.equal(windows[1][1], 60);
});

test('the thread between two rings and the line of a join count as drawn, so no cut goes through them', () => {
  const cutsThrough = (pattern) => {
    const windows = overviewWindows(pattern);
    // Overlapping windows mean the cut found no empty band.
    return windows.slice(1).every((box, i) => box[1] < windows[i][1] + windows[i][3]);
  };
  // Thread runs from ring A's base (y 0) to ring B's (y 180).
  assert.ok(cutsThrough(twoMotifs(ring('B', 180))));
  // New thread, but B joins A's picot: the join's line crosses the band.
  assert.ok(cutsThrough(twoMotifs(ring('B', 180, { round: 2, parts: ['4', 'j:A.top', '4'] }))));
});

test('the last window is never a sliver: the last two share what is left', () => {
  const bridge = { id: 'A', type: 'bridge', parts: ['30'], place: { from: [50, 0], to: [50, 231], bulge: 0 } };
  const pattern = { layout: { viewBox: [0, 0, 100, 231] }, elements: [bridge] };
  const heights = overviewWindows(pattern).map((box) => box[3]);
  assert.ok(heights.length >= 2);
  assert.ok(Math.min(...heights) >= 55, `heights ${heights.map((h) => h.toFixed(1)).join(', ')}`);
  assert.ok(Math.max(...heights) <= 125 + 1e-6);
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

test('the window buttons scroll sideways when there are many, so none is cut off', () => {
  const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';
  assert.match(rule('.chart-windows'), /overflow-x: auto/);
  assert.doesNotMatch(rule('.chart-windows'), /overflow: hidden/);
  assert.match(rule('.chart-windows button'), /flex: 1 0 auto/);
  assert.match(rule('.chart-windows button'), /min-width: \d+px/);
});
