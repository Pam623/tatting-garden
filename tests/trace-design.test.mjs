import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elementGeometry } from '../js/diagram.js';
import { layoutProblems, mirrorPairs } from '../js/fit-layout.js';
import { checkPattern } from '../js/pattern.js';
import { padAddStroke, padExtendStroke, padLines } from '../js/sketch-pad.js';
import { traceDesign } from '../js/trace-design.js';

const curve = (p, a, b, c, steps = 24) => Array.from({ length: steps }, (_, i) => {
  const t = (i + 1) / steps;
  const u = 1 - t;
  return [u * u * u * p[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * p[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]];
});
const chain = (start, ...parts) => {
  const line = [start];
  parts.forEach(([a, b, c]) => line.push(...curve(line[line.length - 1], a, b, c)));
  return line;
};
const reflect = (line) => line.map(([x, y]) => [600 - x, y]);
const ring = (cx, cy, r) => Array.from({ length: 41 }, (_, k) => [cx + r * Math.cos((k / 40) * 2 * Math.PI), cy + r * Math.sin((k / 40) * 2 * Math.PI)]);

// The four test sketches, the same drawings the fit-rate trial used.
const SKETCHES = {
  heart: [chain([300, 520], [[150, 400], [70, 320], [85, 220]], [[100, 120], [235, 100], [305, 205]], [[370, 95], [505, 120], [518, 225]], [[530, 320], [450, 400], [297, 522]])],
  star: [[[300, 70], [365, 235], [540, 245], [405, 355], [452, 525], [300, 430], [150, 528], [196, 356], [60, 245], [236, 236], [300, 70]]],
  teardrop: [[[300, 80], [300, 110]], ring(300, 125, 14), chain([300, 150], [[230, 270], [170, 340], [190, 430]], [[210, 520], [390, 520], [410, 430]], [[430, 340], [370, 270], [302, 150]])],
  butterfly: (() => {
    const wing = chain([295, 300], [[200, 120], [70, 110], [85, 240]], [[95, 330], [200, 330], [295, 305]], [[220, 340], [130, 400], [160, 490]], [[190, 540], [270, 470], [298, 340]]);
    return [wing, reflect(wing), [[298, 220], [300, 420]], chain([298, 220], [[280, 170], [260, 150], [240, 140]]), reflect(chain([298, 220], [[280, 170], [260, 150], [240, 140]]))];
  })(),
};

// Points as a hand on a mouse gives them: whole pixels, uneven spacing, a wobble, and an end that overshoots.
function mouseStroke(line, seed, size = 640) {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const out = [];
  line.forEach((p, i) => {
    if (i && random() < 0.25) return;
    const jitter = () => (random() - 0.5) * 3.2;
    out.push([Math.round(((p[0] + jitter()) / 600) * size) / size, Math.round(((p[1] + jitter()) / 600) * size) / size]);
  });
  return out;
}

function drawOnPad(lines) {
  let strokes = [];
  lines.forEach((line) => {
    strokes = padAddStroke(strokes, line[0], true);
    line.slice(1).forEach((point) => { strokes = padExtendStroke(strokes, point); });
  });
  return padLines(strokes);
}

function allPoints(pattern) {
  return pattern.elements.flatMap((element) => {
    const geometry = elementGeometry(element);
    return Array.from({ length: 61 }, (_, i) => geometry.pointAt(i / 60));
  });
}

// Peaks in how far the drawing reaches from its middle, going round: a star has five.
function outwardPeaks(pattern) {
  const points = allPoints(pattern);
  const cx = 0;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const reach = new Array(72).fill(0);
  points.forEach((p) => {
    const bin = Math.floor(((Math.atan2(p.y - cy, p.x - cx) + Math.PI) / (2 * Math.PI)) * 72) % 72;
    reach[bin] = Math.max(reach[bin], Math.hypot(p.x - cx, p.y - cy));
  });
  const smooth = reach.map((_, i) => (reach[(i + 71) % 72] + reach[i] + reach[(i + 1) % 72]) / 3);
  const mean = smooth.reduce((a, b) => a + b, 0) / 72;
  let peaks = 0;
  smooth.forEach((value, i) => {
    const window = [-4, -3, -2, -1, 1, 2, 3, 4].map((d) => smooth[(i + d + 72) % 72]);
    if (value > mean * 1.15 && window.every((other) => value >= other)) peaks += 1;
  });
  return peaks;
}

const makeable = (pattern) => {
  assert.deepEqual(layoutProblems(pattern), []);
  assert.deepEqual(checkPattern(pattern).filter((c) => !c.ok).map((c) => c.detail), []);
  assert.equal(pattern.elements[0].type, 'ring');
  assert.ok(mirrorPairs(pattern).pairs.length > 0);
};

const width = (points, from, to) => {
  const band = points.filter((p) => p.y >= from && p.y <= to);
  return Math.max(...band.map((p) => Math.abs(p.x))) * 2;
};

for (const [name, strokes] of Object.entries(SKETCHES)) {
  test(`${name}: the drawing becomes a pattern that passes every check`, () => {
    const { pattern, problems, report } = traceDesign({ strokes });
    assert.deepEqual(problems, []);
    makeable(pattern);
    assert.ok(report.stitches <= 340);
    assert.ok(report.likeness >= 0.72);
  });
}

test('a star keeps five points', () => {
  assert.equal(outwardPeaks(traceDesign({ strokes: SKETCHES.star }).pattern), 5);
});

test('a teardrop is narrow on top and round below', () => {
  const points = allPoints(traceDesign({ strokes: SKETCHES.teardrop }).pattern);
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  const height = bottom - top;
  assert.ok(width(points, top, top + height * 0.2) < width(points, top + height * 0.5, top + height * 0.9) * 0.6);
});

test('a heart has a notch on top and a point below', () => {
  const { pattern } = traceDesign({ strokes: SKETCHES.heart });
  const points = allPoints(pattern);
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  const height = bottom - top;
  const onAxis = Math.min(...points.filter((p) => Math.abs(p.x) < 6).map((p) => p.y));
  assert.ok((onAxis - top) / height > 0.1, 'notch');
  assert.ok(width(points, bottom - height * 0.15, bottom) < width(points, top, top + height * 0.5) * 0.45, 'point');
});

test('a butterfly has a waist between its wings', () => {
  const points = allPoints(traceDesign({ strokes: SKETCHES.butterfly }).pattern);
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  const height = bottom - top;
  const waist = Math.min(...Array.from({ length: 8 }, (_, k) => width(points, top + height * (0.3 + k * 0.05), top + height * (0.33 + k * 0.05))));
  assert.ok(waist < width(points, top, top + height * 0.3) * 0.8);
});

test('mouse strokes through the sketch pad give the same kind of result', () => {
  const dense = (corners) => corners.flatMap((p, i) => (i === 0 ? [p] : Array.from({ length: 30 }, (_, k) => [corners[i - 1][0] + ((p[0] - corners[i - 1][0]) * (k + 1)) / 30, corners[i - 1][1] + ((p[1] - corners[i - 1][1]) * (k + 1)) / 30])));
  const leftHalves = {
    heart: [SKETCHES.heart[0].slice(0, 49)],
    star: [dense([[300, 70], [236, 236], [60, 245], [196, 356], [150, 528], [300, 430]])],
  };
  for (const [name, seed] of [['heart', 11], ['star', 29]]) {
    const left = leftHalves[name].map((line) => mouseStroke(line, seed));
    const { pattern, problems, report } = traceDesign({ strokes: drawOnPad(left) }, { mirror: true });
    assert.deepEqual(problems, [], name);
    makeable(pattern);
    assert.ok(report.likeness >= 0.72, name);
    if (name === 'star') assert.equal(outwardPeaks(pattern), 5);
  }
});

test('an unmirrored freehand stroke, not quite closed, is still read as a closed shape', () => {
  const line = mouseStroke(SKETCHES.heart[0].slice(0, -1), 7);
  const { pattern, problems } = traceDesign({ strokes: [line] });
  assert.deepEqual(problems, []);
  makeable(pattern);
});

test('what cannot be made gets a reason in plain words, not a chart', () => {
  const refused = (result, words) => {
    assert.equal(result.pattern, null);
    assert.ok(result.problems[0].includes(words), result.problems[0]);
  };
  refused(traceDesign({ strokes: [] }), '草图是空的');
  refused(traceDesign({ strokes: [[[0.1, 0.5], [0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.9, 0.5], [0.95, 0.5], [0.97, 0.5], [0.99, 0.5]]] }), '封闭');
  const lopsided = [[[0.1, 0.5], [0.3, 0.1], [0.9, 0.2], [0.85, 0.3], [0.5, 0.35], [0.4, 0.6], [0.35, 0.9], [0.2, 0.8], [0.1, 0.5]]];
  refused(traceDesign({ strokes: lopsided }), '对称');
  const gear = [Array.from({ length: 73 }, (_, k) => {
    const angle = (k / 72) * 2 * Math.PI;
    const radius = k % 3 === 0 ? 0.45 : 0.25;
    return [0.5 + radius * Math.sin(angle), 0.5 - radius * Math.cos(angle)];
  })];
  refused(traceDesign({ strokes: gear }), '尖角');
});
