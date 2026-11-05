import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { elementGeometry } from '../js/diagram.js';
import { checkPattern, readElement } from '../js/pattern.js';
import {
  STITCH_UNIT, RING_SHAPE, mirrorPairs, fitLayout, applyLayout, layoutProblems,
} from '../js/fit-layout.js';

const root = new URL('..', import.meta.url).pathname;
const load = (name) => JSON.parse(readFileSync(join(root, `tests/fixtures/${name}`), 'utf8'));
const heart = () => load('sketch-heart.json');
const butterfly = () => load('sketch-butterfly.json');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Negating 0 gives -0, which strict equality tells apart from 0; on a chart they are the same place.
const neg = (v) => (v === 0 ? 0 : -v);
const near = (a, b, tolerance = 0.5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not near ${b}`);

// Direct rule measurements, written against diagram.js without the module's
// own helpers, so a bug in layoutProblems cannot hide a bad result.

function directR1(pattern) {
  const sizes = new Map();
  pattern.elements.forEach((el) => {
    if (el.type !== 'ring') return;
    const { stitches } = readElement(el);
    const g = elementGeometry(el);
    near(g.length, stitches * STITCH_UNIT, 0.02 * stitches * STITCH_UNIT);
    near(el.place.width, RING_SHAPE * dist(el.place.base, el.place.tip), 0.2);
    if (!sizes.has(stitches)) sizes.set(stitches, { widths: new Set(), lengths: new Set() });
    sizes.get(stitches).widths.add(el.place.width);
    sizes.get(stitches).lengths.add(g.length);
  });
  sizes.forEach(({ widths, lengths }) => {
    assert.equal(widths.size, 1, 'same stitch counts must give the same width');
    assert.ok(Math.max(...lengths) - Math.min(...lengths) < 0.5, 'same stitch counts must give the same length');
  });
}

function directR3(pattern) {
  const byId = new Map(pattern.elements.map((el) => [el.id, el]));
  pattern.elements.forEach((el) => {
    const info = readElement(el);
    info.items.filter((i) => i.kind === 'join').forEach((item) => {
      const target = byId.get(item.element);
      const targetInfo = readElement(target);
      const leave = targetInfo.items.find((i) => i.kind === 'leave' && i.name === item.name);
      assert.ok(leave, 'join target picot exists');
      const a = elementGeometry(el).pointAt(item.from / info.stitches);
      const b = elementGeometry(target).pointAt(leave.from / targetInfo.stitches);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 1.5 * STITCH_UNIT + 1e-9,
        `${el.id} join to ${target.id} is ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)} apart`);
    });
  });
}

function directR5(pattern) {
  const byId = new Map(pattern.elements.map((el) => [el.id, el]));
  const { pairs, axis } = mirrorPairs(pattern);
  pairs.forEach(([aId, bId]) => {
    const a = byId.get(aId).place;
    const b = byId.get(bId).place;
    if ('base' in a) {
      assert.equal(b.base[0], neg(a.base[0]));
      assert.equal(b.base[1], a.base[1]);
      assert.equal(b.tip[0], neg(a.tip[0]));
      assert.equal(b.tip[1], a.tip[1]);
      assert.equal(b.width, a.width);
      assert.equal(b.dir, a.dir);
    } else {
      assert.equal(a.from[0], neg(b.to[0]));
      assert.equal(a.from[1], b.to[1]);
      assert.equal(a.to[0], neg(b.from[0]));
      assert.equal(a.to[1], b.from[1]);
      assert.equal(a.bulge, b.bulge);
    }
  });
  axis.forEach((id) => {
    const p = byId.get(id).place;
    if ('base' in p) {
      assert.equal(p.base[0], 0);
      assert.equal(p.tip[0], 0);
    }
  });
  pattern.elements.forEach((el) => {
    if (el.type === 'ring') assert.equal(el.place.dir, 'cw');
    const nums = el.type === 'ring'
      ? [...el.place.base, ...el.place.tip, el.place.width]
      : [...el.place.from, ...el.place.to, el.place.bulge];
    nums.forEach((v) => assert.ok(Math.abs(v - Math.round(v * 10) / 10) <= 1e-9, `${el.id} coord ${v} not on 0.1 grid`));
  });
}

function segsCross(a1, a2, b1, b2) {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const den = d1x * d2y - d1y * d2x;
  const rx = b1[0] - a1[0];
  const ry = b1[1] - a1[1];
  if (Math.abs(den) < 1e-12) return false;
  const t = (rx * d2y - ry * d2x) / den;
  const u = (rx * d1y - ry * d1x) / den;
  return t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12;
}

const outlineOf = (el, closed, n) => {
  const g = elementGeometry(el);
  const pts = [];
  const count = closed ? n : n + 1;
  for (let i = 0; i < count; i += 1) {
    const p = g.pointAt(i / n);
    pts.push([p.x, p.y]);
  }
  return pts;
};

function directR6(pattern) {
  const byId = new Map(pattern.elements.map((el) => [el.id, el]));
  const bridges = pattern.elements.filter((el) => el.type === 'bridge');
  const rings = pattern.elements.filter((el) => el.type === 'ring');
  const outlines = new Map(pattern.elements.map((el) => [
    el.id,
    outlineOf(el, el.type === 'ring', el.type === 'ring' ? 48 : 32),
  ]));
  const crossed = (A, B, closedA, closedB, ignoreR, sharedPts) => {
    const oa = outlines.get(A.id);
    const ob = outlines.get(B.id);
    const segsA = closedA ? oa.length : oa.length - 1;
    const segsB = closedB ? ob.length : ob.length - 1;
    for (let i = 0; i < segsA; i += 1) {
      for (let j = 0; j < segsB; j += 1) {
        const nearShared = [oa[i], oa[(i + 1) % oa.length], ob[j], ob[(j + 1) % ob.length]]
          .some((p) => sharedPts.some((s) => dist(p, s) < ignoreR));
        if (nearShared) continue;
        if (segsCross(oa[i], oa[(i + 1) % oa.length], ob[j], ob[(j + 1) % ob.length])) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < bridges.length; i += 1) {
    for (let j = i + 1; j < bridges.length; j += 1) {
      const a = bridges[i].place;
      const b = bridges[j].place;
      const shared = [];
      [a.from, a.to].forEach((pa) => [b.from, b.to].forEach((pb) => {
        if (dist(pa, pb) <= 1e-9) shared.push(pa);
      }));
      assert.ok(!crossed(bridges[i], bridges[j], false, false, 0.5 * STITCH_UNIT, shared),
        `${bridges[i].id} crosses ${bridges[j].id}`);
    }
  }
  bridges.forEach((b) => {
    rings.forEach((r) => {
      const shared = [];
      if (dist(b.place.from, r.place.base) <= 1e-9) shared.push(b.place.from);
      if (dist(b.place.to, r.place.base) <= 1e-9) shared.push(b.place.to);
      assert.ok(!crossed(b, r, false, true, 1.5 * STITCH_UNIT, shared), `${b.id} crosses ring ${r.id}`);
    });
  });
  void byId;
}

function directR7(pattern) {
  const closed = pattern.layout?.closed === true;
  const parsed = pattern.elements.map((el) => readElement(el));
  pattern.elements.forEach((el, i) => {
    if (el.type !== 'ring' || el.place.base[0] !== 0) return;
    const prev = i > 0 ? i - 1 : closed ? parsed.length - 1 : -1;
    const next = i < parsed.length - 1 ? i + 1 : closed ? 0 : -1;
    if (prev < 0 || next < 0 || parsed[prev].type !== 'bridge' || parsed[next].type !== 'bridge') return;
    const axisVec = [el.place.tip[0] - el.place.base[0], el.place.tip[1] - el.place.base[1]];
    [prev, next].forEach((bi) => {
      const b = pattern.elements[bi].place;
      const len = dist(b.from, b.to);
      const control = [(b.from[0] + b.to[0]) / 2 + ((b.to[1] - b.from[1]) / len) * b.bulge,
        (b.from[1] + b.to[1]) / 2 + (-(b.to[0] - b.from[0]) / len) * b.bulge];
      const t = [control[0] - el.place.base[0], control[1] - el.place.base[1]];
      const cos = (t[0] * axisVec[0] + t[1] * axisVec[1]) / (Math.hypot(...t) * Math.hypot(...axisVec));
      const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      assert.ok(ang >= 60 - 1e-9 && ang <= 125 + 1e-9, `${el.id} axis angle ${ang.toFixed(1)}`);
    });
  });
}

function assertFitsClean(pattern, aspect) {
  const fitted = fitLayout(pattern, aspect === undefined ? {} : { aspect });
  assert.deepEqual(fitted.problems, []);
  assert.ok(fitted.viewBox);
  const placed = applyLayout(pattern, fitted);
  assert.deepEqual(layoutProblems(placed), []);
  directR1(placed);
  directR3(placed);
  directR5(placed);
  directR6(placed);
  directR7(placed);
  for (const result of checkPattern(placed)) assert.equal(result.ok, true, `${result.label}: ${result.detail}`);
  return placed;
}

const stripPlaces = (pattern) => ({
  ...pattern,
  elements: pattern.elements.map((el) => {
    const copy = { ...el };
    delete copy.place;
    return copy;
  }),
});

const warpPlaces = (pattern, f, off) => ({
  ...pattern,
  elements: pattern.elements.map((el) => {
    if (!el.place) return { ...el };
    const move = (p) => [p[0] * f + off[0], p[1] * f + off[1]];
    if (el.type === 'ring') return { ...el, place: { ...el.place, base: move(el.place.base), tip: move(el.place.tip) } };
    return { ...el, place: { ...el.place, from: move(el.place.from), to: move(el.place.to) } };
  }),
});

const motif = (id, closed, elements) => ({
  schema: 2, id, title: id, tier: 'sorted', rights: { kind: 'original' },
  layout: { viewBox: [0, 0, 100, 100], closed }, elements,
});
const ring = (id, parts, extra = {}) => ({ id, type: 'ring', parts, ...extra });
const bridge = (id, parts, extra = {}) => ({ id, type: 'bridge', parts, ...extra });

// The smallest closed motif in the family: six rings pointing inward, each joining the ring before it.
const wreathMotif = () => motif('t-wreath', true, [
  ring('A', ['2', 'p:a1', '4', 'o', '4', 'p:a2', '2']), bridge('B', ['12']),
  ring('C', ['8', 'j:A.a2', '3', 'o', '3', 'p:c', '6']), bridge('D', ['8']),
  ring('E', ['5', 'j:C.c', '2', 'o', '2', 'p:e', '5']), bridge('F', ['8']),
  ring('G', ['5', 'j:E.e', '2', 'o', '2', 'p:g', '5']), bridge('H', ['8']),
  ring('I', ['5', 'j:G.g', '2', 'o', '2', 'p:i', '5']), bridge('J', ['8']),
  ring('K', ['6', 'j:I.i', '3', 'o', '3', 'j:A.a1', '8']), bridge('L', ['12']),
]);

test('sketch heart fits cleanly and checks pass', () => {
  assertFitsClean(heart());
});

test('sketch butterfly fits cleanly and checks pass', () => {
  assertFitsClean(butterfly());
});

test('fixtures fit when every place is removed', () => {
  assertFitsClean(stripPlaces(heart()));
  assertFitsClean(stripPlaces(butterfly()));
});

test('wrongly scaled and shifted hints still fit', () => {
  assertFitsClean(warpPlaces(heart(), 0.3, [500, 300]));
  assertFitsClean(warpPlaces(butterfly(), 0.3, [500, 300]));
});

test('equal stitch counts give equal ring sizes, across both sides and both fixtures', () => {
  const a = assertFitsClean(heart());
  const b = assertFitsClean(butterfly());
  const sizeOf = (pattern, id) => {
    const el = pattern.elements.find((e) => e.id === id);
    return { width: el.place.width, length: elementGeometry(el).length };
  };
  const same = (x, y) => {
    assert.equal(x.width, y.width);
    near(x.length, y.length, 0.5);
  };
  same(sizeOf(a, 'C'), sizeOf(a, 'O'));
  same(sizeOf(b, 'C'), sizeOf(b, 'O'));
  same(sizeOf(a, 'A'), sizeOf(a, 'E'));
});

test('fitting is deterministic and never mutates the input', () => {
  const input = heart();
  const before = JSON.parse(JSON.stringify(input));
  const one = fitLayout(input);
  const two = fitLayout(input);
  assert.deepEqual(input, before);
  const fittedAgain = applyLayout(input, one);
  assert.deepEqual(input, before);
  const three = fitLayout(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(one, two);
  assert.deepEqual(one, three);
  assert.deepEqual(layoutProblems(fittedAgain), []);
});

test('a ring-only closed flower of six rings fits', () => {
  const flower = motif('t-flower', true, 'ABCDEF'.split('').map((id) => ring(id, ['3', 'o', '3'])));
  assertFitsClean(flower);
});

test('a small closed motif of six rings and six bridges with joins fits', () => {
  const wreath = wreathMotif();
  assertFitsClean(wreath);
});

test('an open chain of three rings and two bridges without joins fits', () => {
  const chain = motif('t-chain', false, [
    ring('A', ['4', 'o', '4']),
    bridge('B', ['6']),
    ring('C', ['5', 'o', '5']),
    bridge('D', ['6']),
    ring('E', ['4', 'o', '4']),
  ]);
  assertFitsClean(chain);
});

test('an asymmetric pair reports a Chinese problem naming the pair, without throwing', () => {
  const broken = heart();
  const o = broken.elements.find((el) => el.id === 'O');
  o.parts = [...o.parts];
  o.parts[o.parts.length - 1] = '8';
  const fitted = fitLayout(broken);
  assert.ok(fitted.problems.length > 0);
  assert.ok(fitted.problems.some((p) => p.includes('C') && p.includes('O') && p.includes('不对称')));
  assert.deepEqual(fitted.place, {});
  assert.equal(fitted.viewBox, null);
});

test('an unreachable join is reported, not thrown', () => {
  const reach = motif('t-reach', false, [
    ring('A', ['6', 'j:C.x', '6']),
    bridge('B', ['40']),
    ring('C', ['2', 'p:x+', '2']),
    bridge('D', ['40']),
    ring('E', ['6', 'j:C.x', '6']),
  ]);
  const fitted = fitLayout(reach);
  assert.ok(fitted.problems.length > 0);
  assert.ok(fitted.problems.some((p) => p.includes('接耳') || p.includes('长度')));
});

test('garbage input gives problems and never throws', () => {
  const cases = [
    {},
    { elements: [] },
    { elements: [{ id: 'A', type: 'ring', parts: ['bogus', '5'] }] },
    null,
  ];
  assert.ok(layoutProblems({ elements: [{ id: 'A', type: 'ring', parts: ['5'] }] }).length > 0, 'an unplaced ring is a problem');
  cases.forEach((bad, i) => {
    const fitted = fitLayout(bad);
    assert.ok(fitted.problems.length > 0, `case ${i} reports problems`);
    assert.equal(fitted.viewBox, null);
    assert.ok(layoutProblems(bad).length > 0, `case ${i} measures problems`);
  });
});

test('layoutProblems catches overlapping rings', () => {
  const placed = assertFitsClean(heart());
  const c = placed.elements.find((el) => el.id === 'C');
  const e = placed.elements.find((el) => el.id === 'E');
  c.place.base = [...e.place.base];
  c.place.tip = [...e.place.tip];
  const problems = layoutProblems(placed);
  assert.ok(problems.some((p) => p.includes('重叠')));
});

test('layoutProblems catches a broken mirror', () => {
  const placed = assertFitsClean(heart());
  const o = placed.elements.find((el) => el.id === 'O');
  o.place.tip = [o.place.tip[0] + 3, o.place.tip[1]];
  const problems = layoutProblems(placed);
  assert.ok(problems.some((p) => p.includes('镜像')));
});

test('layoutProblems catches crossing bridges', () => {
  const placed = assertFitsClean(butterfly());
  const b = placed.elements.find((el) => el.id === 'B');
  b.place.bulge = -b.place.bulge;
  const problems = layoutProblems(placed);
  assert.ok(problems.some((p) => p.includes('交叉') || p.includes('穿过')));
});

test('layoutProblems catches a straight-through thread at the axis ring', () => {
  const placed = assertFitsClean(heart());
  const a = placed.elements.find((el) => el.id === 'A');
  a.place.tip = [0, a.place.base[1] - 60];
  const problems = layoutProblems(placed);
  assert.ok(problems.some((p) => p.includes('直线穿过')));
});

test('a wider aspect gives a wider layout when hints are missing', () => {
  const wide = fitLayout(stripPlaces(heart()), { aspect: 2 });
  const narrow = fitLayout(stripPlaces(heart()), { aspect: 0.5 });
  assert.deepEqual(wide.problems, []);
  assert.deepEqual(narrow.problems, []);
  const ratio = (vb) => vb[2] / vb[3];
  // Stitch counts fix most of the size, so proportions can only lean, not stretch.
  assert.ok(ratio(wide.viewBox) > ratio(narrow.viewBox),
    `wide ${ratio(wide.viewBox).toFixed(2)} vs narrow ${ratio(narrow.viewBox).toFixed(2)}`);
});

test('each fit finishes in a few seconds', () => {
  const jobs = [
    ['heart', heart(), {}],
    ['heart stripped', stripPlaces(heart()), {}],
    ['heart warped', warpPlaces(heart(), 0.3, [500, 300]), {}],
    ['butterfly', butterfly(), {}],
    ['butterfly stripped', stripPlaces(butterfly()), {}],
    ['flower', motif('t-flower', true, 'ABCDEF'.split('').map((id) => ring(id, ['3', 'o', '3']))), {}],
    ['wreath', wreathMotif(), {}],
    ['chain', motif('t-chain', false, [
      ring('A', ['4', 'o', '4']), bridge('B', ['6']), ring('C', ['5', 'o', '5']),
      bridge('D', ['6']), ring('E', ['4', 'o', '4']),
    ]), {}],
  ];
  jobs.forEach(([name, pattern, opts]) => {
    const start = Date.now();
    const fitted = fitLayout(pattern, opts);
    const took = Date.now() - start;
    assert.deepEqual(fitted.problems, [], `${name} fits`);
    assert.ok(took < 8000, `${name} took ${took}ms`);
  });
});
