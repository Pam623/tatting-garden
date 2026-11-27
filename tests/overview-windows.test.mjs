// A chart far taller than wide is shown in windows on the pattern page, so its numbers stay readable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  elementGeometry, FLATTEST_FRAME, overviewWindows, renderChart, TALL_OVERVIEW, windowAfterRefit, windowFor,
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

test('in a desktop frame, the head is whole in the first window and the spine starts whole in the second', () => {
  const [head, next] = overviewWindows(fishbone, { aspect: 1.46 });
  const firstSpine = fishbone.elements.findIndex((e) => e.id === 'S1');
  fishbone.elements.forEach((element, index) => {
    const geometry = elementGeometry(element);
    const ys = Array.from({ length: 41 }, (_, i) => geometry.pointAt(i / 40).y);
    if (index < firstSpine) assert.ok(Math.max(...ys) < head[1] + head[3], `${element.id} crosses out of the head window`);
    else if (element.id === 'S1') assert.ok(Math.min(...ys) > next[1], 'S1 starts above the second window');
  });
});

const ring = (id, y, extra = {}) => ({ id, type: 'ring', parts: ['8'], place: { base: [50, y], tip: [50, y - 60], width: 40, dir: 'cw' }, ...extra });
const twoMotifs = (second) => ({ layout: { viewBox: [0, -62, 100, 232] }, elements: [ring('A', 0, { parts: ['4', 'p:top', '4'] }), second] });

test('a tall chart of two motifs is cut in the empty band between them, with no overlap there', () => {
  // Ring B starts new thread, so nothing is drawn between ring A (y -60 to 0) and ring B (y 110 to 170).
  const windows = overviewWindows(twoMotifs(ring('B', 170, { round: 2 })));
  const cut = windows.slice(1).findIndex((box, i) => box[1] === windows[i][1] + windows[i][3]);
  assert.ok(cut >= 0, 'no cut in an empty band');
  const y = windows[cut + 1][1];
  assert.ok(y > 0 && y < 110, `cut at ${y}`);
});

test('the thread between two rings and the line of a join count as drawn, so no cut goes through them', () => {
  const cutsThrough = (pattern) => {
    const windows = overviewWindows(pattern);
    // Overlapping windows mean the cut found no empty band.
    return windows.slice(1).every((box, i) => box[1] < windows[i][1] + windows[i][3]);
  };
  // Thread runs from ring A's base (y 0) to ring B's (y 170).
  assert.ok(cutsThrough(twoMotifs(ring('B', 170))));
  // New thread, but B joins A's picot: the join's line crosses the band.
  assert.ok(cutsThrough(twoMotifs(ring('B', 170, { round: 2, parts: ['4', 'j:A.top', '4'] }))));
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

test('a very flat frame still gives windows that each start below the one before', () => {
  for (const aspect of [0.07, 0.01, 0, -1, Number.NaN]) {
    const windows = overviewWindows(fishbone, { aspect });
    assert.ok(windows.length > 0 && windows.length < 40, `aspect ${aspect}: ${windows.length} windows`);
    windows.slice(1).forEach((box, i) => assert.ok(box[1] > windows[i][1], `aspect ${aspect}: window ${i + 2} does not move on`));
    const flattest = fishbone.layout.viewBox[2] * FLATTEST_FRAME;
    windows.slice(0, -1).forEach((box) => assert.ok(box[3] >= flattest * 0.3 - 1e-6));
  }
});

test('a picot standing out from its line counts as drawn, so no cut goes through it', () => {
  // A bridge along y 0, worked right to left so its decorative picot hangs down 11 units.
  const top = { id: 'A', type: 'bridge', parts: ['4', 'o', '4'], place: { from: [360, 0], to: [10, 0], bulge: 0 } };
  const below = { id: 'B', type: 'bridge', parts: ['30'], place: { from: [10, 400], to: [360, 960], bulge: 0 }, round: 2 };
  const pattern = { layout: { viewBox: [0, -20, 370, 1000] }, elements: [top, below] };
  const [first] = overviewWindows(pattern);
  // The empty band runs from the picot's tip (y 11), or a label below it, to the next bridge (y 400);
  // without the picot the band would start at the line, y 0, and the cut fall at 200.
  assert.ok(first[1] + first[3] >= (11 + 400) / 2 && first[1] + first[3] < 400, `cut at ${first[1] + first[3]}`);
});

test('after the windows are worked out again, a highlighted row decides which one shows', () => {
  const ids = ['R3', 'R4', 'L4', 'L3'];
  const wide = overviewWindows(fishbone, { aspect: 0.967 });
  const flat = overviewWindows(fishbone, { aspect: 0.5 });
  const before = windowFor(fishbone, wide, ids);
  assert.equal(windowAfterRefit(fishbone, flat, before, ids), windowFor(fishbone, flat, ids));
  assert.notEqual(windowFor(fishbone, flat, ids), before);
  // With nothing highlighted the same window number stays, within the new count.
  assert.equal(windowAfterRefit(fishbone, flat, 2, null), 2);
  assert.equal(windowAfterRefit(fishbone, wide, 9, null), wide.length - 1);
  // Shown whole stays whole.
  assert.equal(windowAfterRefit(fishbone, flat, null, ids), null);
});

test('no window edge cuts a number, letter or arrow on the fishbone, whatever the frame', async () => {
  const { chartLabels, leftPicotSpots, readChartElements } = await import('../js/diagram.js');
  const [minX, minY, width, height] = fishbone.layout.viewBox;
  const s = width / 370;
  const elements = readChartElements(fishbone);
  const seen = new Set();
  const firstOfGroup = (element) => {
    if (element.group === undefined) return true;
    if (seen.has(element.group)) return false;
    seen.add(element.group);
    return true;
  };
  const boxes = [];
  [firstOfGroup, () => true].forEach((shows) => {
    const labels = chartLabels(elements, leftPicotSpots(elements, s), s, { minX, minY, width, height }, shows);
    [labels.flip, labels.letter, labels.count].forEach((map) => map.forEach((box, key) => boxes.push({ ...box, key })));
    boxes.push({ ...labels.start, key: '起点' });
    labels.rounds.forEach(({ mark }, id) => boxes.push({ ...mark, key: `round ${id}` }));
  });
  // The frames of 375x667, 360x640 and 375x812 phones and of 1024x768 and 1280x900 desktops.
  for (const aspect of [287 / 349, 275 / 334, 349 / 349, 678 / 478, 810 / 553]) {
    const edges = overviewWindows(fishbone, { aspect }).flatMap(([, y, , h]) => [y, y + h]);
    edges.forEach((edge) => boxes.forEach((box) => {
      assert.ok(edge <= box.y - box.h * 0.75 + 1e-6 || edge >= box.y + box.h * 0.75 - 1e-6, `aspect ${aspect}: edge ${edge.toFixed(1)} cuts ${box.key}`);
    }));
  }
});

test('a sliver at the end keeps the cut in the empty band and reaches up into the window before', () => {
  const small = (id, base, tip, round) => ({ id, type: 'ring', parts: ['8'], round, place: { base: [50, base], tip: [50, tip], width: 30, dir: 'cw' } });
  const pattern = {
    layout: { viewBox: [0, -65, 100, 295] },
    elements: [small('A', 0, -60), small('B', 180, 120, 2), small('C', 220, 190, 3)],
  };
  const windows = overviewWindows(pattern);
  const ends = windows.map(([, y, , h]) => y + h).map((e) => e.toFixed(1)).join(', ');
  // Every ring is whole in some window: none is only ever seen split.
  [[-60, 0], [120, 180], [190, 220]].forEach(([from, to]) => {
    assert.ok(windows.some(([, y, , h]) => y <= from && y + h >= to), `a ring from ${from} to ${to} is split; windows end at ${ends}`);
  });
  // And no window is a sliver.
  windows.forEach(([, , , h]) => assert.ok(h >= 55, `a window ${h.toFixed(1)} high; windows end at ${ends}`));
});

test('across frames from 0.3 to 1.6 times as tall as wide, no window edge of any windowed pattern cuts a label', async () => {
  const { chartLabels, leftPicotSpots, readChartElements } = await import('../js/diagram.js');
  for (const id of read('patterns/index.json')) {
    const pattern = read(`patterns/${id}.json`);
    if (!overviewWindows(pattern).length) continue;
    const [minX, minY, width, height] = pattern.layout.viewBox;
    const s = width / 370;
    const elements = readChartElements(pattern);
    const seen = new Set();
    const firstOfGroup = (element) => {
      if (element.group === undefined) return true;
      if (seen.has(element.group)) return false;
      seen.add(element.group);
      return true;
    };
    const bands = [];
    const box = (b, key) => bands.push({ from: b.y - b.h * 0.75, to: b.y + b.h * 0.75, key });
    const arrow = (a, key) => bands.push({ from: a.y - 14 * s, to: a.y + 14 * s, key });
    [firstOfGroup, () => true].forEach((shows) => {
      const labels = chartLabels(elements, leftPicotSpots(elements, s), s, { minX, minY, width, height }, shows);
      [labels.flip, labels.letter, labels.count].forEach((map) => map.forEach((b, key) => box(b, key)));
      box(labels.start, '起点');
      arrow(labels.arrow, 'start arrow');
      labels.rounds.forEach(({ arrow: a, mark }, key) => {
        arrow(a, `round arrow ${key}`);
        box(mark, `round ${key}`);
      });
    });
    for (let step = 30; step <= 160; step += 1) {
      const aspect = step / 100;
      const windows = overviewWindows(pattern, { aspect });
      windows.forEach(([, y, , h], i) => {
        if (i > 0) assert.ok(y > windows[i - 1][1], `${id} aspect ${aspect}: window ${i + 1} does not move on`);
        [y, y + h].forEach((edge) => bands.forEach(({ from, to, key }) => {
          assert.ok(edge <= from + 1e-6 || edge >= to - 1e-6, `${id} aspect ${aspect}: edge ${edge.toFixed(1)} cuts ${key}`);
        }));
      });
      assert.equal(windows[0][1], minY);
      assert.ok(Math.abs(windows.at(-1)[1] + windows.at(-1)[3] - (minY + height)) < 1e-6);
    }
  }
});

test('on a desktop the sticky plate keeps room for the window buttons, so they stay on screen', () => {
  const reserve = (selector) => Number(css.match(new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{ max-height: calc\\(100dvh - (\\d+)px\\); \\}`))?.[1]);
  const plain = reserve('.pattern-plate .diagram');
  const windowed = reserve('.pattern-plate.has-windows .diagram');
  // The top gap (24px), the view switch above the chart (54px) and the paper's padding and edge (40px).
  assert.ok(plain >= 24 + 54 + 40, `the chart leaves ${plain}px`);
  // The buttons: 44px high, a 2px border and 8px above.
  const buttons = Number(css.match(/\n\.chart-windows button \{[^}]*min-height: (\d+)px/)[1]);
  assert.ok(windowed - plain >= buttons + 2 + 8, `windows add ${windowed - plain}px`);
  // On a phone the chart keeps its share of the screen, which the windows are cut to.
  const phoneRule = phoneCss.match(/\.pattern-plate\.has-windows \.diagram \{ max-height: (\d+)dvh; \}/);
  assert.equal(Number(phoneRule?.[1]) / 100, chartShare);
  // A short landscape screen gives the chart its share only while the buttons still fit below it:
  // both its height and its limit leave at least the windowed reserve.
  const landscape = css.slice(css.indexOf('@media (max-width: 950px) and (orientation: landscape)'));
  const rule = landscape.slice(0, landscape.indexOf('\n}')).match(/\.pattern-plate\.has-windows \.diagram \{([^}]*)\}/)?.[1] ?? '';
  for (const property of ['height', 'max-height']) {
    const value = rule.match(new RegExp(`(?:^|;)\\s*${property}: min\\((\\d+)dvh, calc\\(100dvh - (\\d+)px\\)\\);`));
    assert.ok(value, `the landscape ${property} is not capped`);
    assert.ok(Number(value[2]) >= windowed, `the landscape ${property} leaves ${value[2]}px`);
  }
});
