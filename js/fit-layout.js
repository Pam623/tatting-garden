// Works out where every ring and bridge goes, from stitch counts alone. The AI decides structure;
// sizes follow from stitches, one half is searched for, and the other half is its exact mirror.
import { elementGeometry } from './diagram.js';
import { parseToken, readElement } from './pattern.js';

export const STITCH_UNIT = 12;
export const RING_SHAPE = 0.62;

const U = STITCH_UNIT;
const FIT_OUTLINE_SAMPLES = 36;
const FIT_BRIDGE_SAMPLES = 20;
const FIT_MAX_EVALS = 3000;
const FIT_STARTS = [1, 0.85, 1.2, 1.5];
const fitRound = (value) => Math.round(value * 10) / 10 + 0;
// Called millions of times in a search, and Math.hypot is far slower than this.
const fitDist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);

let fitRingUnit = null;
// Outline length of a ring whose length (base to tip) is 1.
function fitRingLengthFor(stitches) {
  if (fitRingUnit === null) {
    fitRingUnit = elementGeometry({ type: 'ring', place: { base: [0, 0], tip: [100, 0], width: 100 * RING_SHAPE, dir: 'cw' } }).length / 100;
  }
  return (stitches * U) / fitRingUnit;
}

let fitArcTable = null;
// The bulge giving a bridge this arc over this chord; 0 if the chord is already too long.
function fitBulgeFor(chord, arc) {
  if (fitArcTable === null) {
    fitArcTable = [];
    for (let i = 0; i <= 400; i++) {
      const b = i * 0.02;
      let total = 0;
      let px = 0;
      let py = 0;
      for (let k = 1; k <= 64; k++) {
        const t = k / 64;
        const x = t;
        const y = 2 * (1 - t) * t * b;
        total += Math.hypot(x - px, y - py);
        px = x;
        py = y;
      }
      fitArcTable.push(total);
    }
  }
  const ratio = arc / Math.max(chord, 1e-6);
  if (ratio <= 1) return 0;
  for (let i = 1; i < fitArcTable.length; i++) {
    if (fitArcTable[i] >= ratio) {
      const f = (ratio - fitArcTable[i - 1]) / (fitArcTable[i] - fitArcTable[i - 1]);
      return (i - 1 + f) * 0.02 * chord;
    }
  }
  return 8 * chord;
}

function fitReadSafely(element) {
  try {
    if (!element || typeof element !== 'object' || !Array.isArray(element.parts) || element.parts.length === 0) return null;
    element.parts.forEach(parseToken);
    const read = readElement(element);
    return read.stitches > 0 ? read : null;
  } catch {
    return null;
  }
}

function fitMirrorIndex(i, m, closed) {
  return closed ? (m - i) % m : m - 1 - i;
}

export function mirrorPairs(pattern) {
  const elements = Array.isArray(pattern?.elements) ? pattern.elements : [];
  const m = elements.length;
  const closed = pattern?.layout?.closed === true;
  const pairs = [];
  const axis = [];
  elements.forEach((element, i) => {
    const j = fitMirrorIndex(i, m, closed);
    if (i === j) axis.push(element?.id);
    else if (i < j) pairs.push([element?.id, elements[j]?.id]);
  });
  return { pairs, axis };
}

const fitContents = (read) => read.items.map((item) => (item.kind === 'stitch' ? String(item.count) : item.kind === 'deco' ? '·' : '耳'));

function fitStructureProblems(pattern) {
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return ['结果不是一个花样'];
  const elements = pattern.elements;
  if (!Array.isArray(elements) || elements.length === 0) return ['这个花样没有任何元素'];
  const problems = [];
  const reads = elements.map(fitReadSafely);
  reads.forEach((read, i) => {
    if (!read) problems.push(`${elements[i]?.id ?? `第 ${i + 1} 个元素`} 的内容看不懂或没有针数`);
    if (!['ring', 'bridge'].includes(elements[i]?.type)) problems.push(`${elements[i]?.id ?? `第 ${i + 1} 个元素`} 的类型必须是环或桥`);
  });
  if (problems.length) return problems;
  const m = elements.length;
  const closed = pattern.layout?.closed === true;
  elements.forEach((element, i) => {
    const j = fitMirrorIndex(i, m, closed);
    if (j < i) return;
    const a = fitContents(reads[i]);
    const b = fitContents(reads[j]).reverse();
    if (element.type !== elements[j].type || a.join() !== b.join()) {
      const other = elements[j].id;
      problems.push(i === j
        ? `${element.id} 在对称轴上，前后必须对称：现在是 ${a.join(',')}`
        : `${element.id} 和 ${other} 不对称：${element.id} 是 ${a.join(',')}，${other} 是 ${fitContents(reads[j]).join(',')}，针数和耳的次序要正好相反`);
    }
  });
  elements.forEach((element, i) => {
    if (element.type !== 'bridge') return;
    const before = i > 0 ? elements[i - 1] : closed ? elements[m - 1] : null;
    const after = i < m - 1 ? elements[i + 1] : closed ? elements[0] : null;
    if (before?.type !== 'ring' || after?.type !== 'ring') problems.push(`${element.id} 桥的两头都要接环`);
  });
  if (!elements.some((e) => e.type === 'ring')) problems.push('这个花样至少要有一个环');
  return problems;
}

// Fixed facts about the pattern: each ring's local outline and where its picots fall.
function fitModel(pattern) {
  const elements = pattern.elements;
  const m = elements.length;
  const closed = pattern.layout?.closed === true;
  const reads = elements.map(readElement);
  const shapes = new Map();
  const items = elements.map((element, i) => {
    const read = reads[i];
    const item = { id: element.id, type: element.type, index: i, read, stitches: read.stitches, mirror: fitMirrorIndex(i, m, closed) };
    if (element.type === 'ring') {
      const key = read.stitches;
      if (!shapes.has(key)) {
        const length = fitRingLengthFor(key);
        const geometry = elementGeometry({ type: 'ring', place: { base: [0, 0], tip: [length, 0], width: length * RING_SHAPE, dir: 'cw' } });
        shapes.set(key, { length, geometry, outline: Array.from({ length: FIT_OUTLINE_SAMPLES }, (_, k) => geometry.pointAt(k / FIT_OUTLINE_SAMPLES)) });
      }
      item.shape = shapes.get(key);
    } else {
      item.arc = read.stitches * U;
      item.prev = i > 0 ? i - 1 : m - 1;
      item.next = i < m - 1 ? i + 1 : 0;
    }
    return item;
  });
  const leftOf = (i) => (closed ? i >= 1 && i < m / 2 : i < (m - 1) / 2);
  const free = items.filter((e) => e.type === 'ring' && (leftOf(e.index) || e.mirror === e.index));
  const left = new Map();
  items.forEach((e) => e.read.items.filter((x) => x.kind === 'leave').forEach((x) => left.set(`${e.id}.${x.name}`, { el: e, f: x.from / e.stitches })));
  const joins = [];
  items.forEach((e) => e.read.items.filter((x) => x.kind === 'join').forEach((x) => {
    const target = left.get(`${x.element}.${x.name}`);
    if (target) joins.push({ a: e, fa: x.from / e.stitches, b: target.el, fb: target.f });
  }));
  items.filter((e) => e.type === 'ring').forEach((e) => {
    const fractions = new Set(joins.flatMap((j) => [j.a === e ? j.fa : null, j.b === e ? j.fb : null]).filter((f) => f !== null));
    e.picots = new Map([...fractions].map((f) => {
      const p = e.shape.geometry.pointAt(f);
      return [f, [p.x, p.y]];
    }));
  });
  const hasBridges = items.some((e) => e.type === 'bridge');
  return { items, free, joins, closed, m, hasBridges, rings: items.filter((e) => e.type === 'ring'), bridges: items.filter((e) => e.type === 'bridge') };
}

// Turns the left half into poses for every ring.
function fitPoses(model, vars) {
  const poses = new Array(model.m);
  model.free.forEach((e, k) => {
    const v = vars[k];
    const axis = e.mirror === e.index;
    poses[e.index] = { x: axis ? 0 : v.x, y: v.y, a: v.a };
    if (!axis) poses[e.mirror] = { x: -v.x, y: v.y, a: Math.PI - v.a };
  });
  return poses;
}

function fitWorldRing(e, pose) {
  const cos = Math.cos(pose.a);
  const sin = Math.sin(pose.a);
  const place = (x, y) => [pose.x + x * cos - y * sin, pose.y + x * sin + y * cos];
  const { length } = e.shape;
  return {
    base: [pose.x, pose.y],
    center: place(length / 2, 0),
    radius: length / 2 + 1,
    outline: e.shape.outline.map((p) => place(p.x, p.y)),
    dir: [cos, sin],
    place,
  };
}

function fitInside(point, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function fitWorldBridge(e, worlds) {
  const from = worlds[e.prev].base;
  const to = worlds[e.next].base;
  const chord = fitDist(from, to) || 1e-6;
  const bulge = -fitBulgeFor(chord, e.arc);
  const lx = (to[1] - from[1]) / chord;
  const ly = -(to[0] - from[0]) / chord;
  const control = [(from[0] + to[0]) / 2 + lx * bulge, (from[1] + to[1]) / 2 + ly * bulge];
  const points = [];
  for (let k = 0; k <= FIT_BRIDGE_SAMPLES; k++) {
    const t = k / FIT_BRIDGE_SAMPLES;
    const a = (1 - t) ** 2;
    const b = 2 * (1 - t) * t;
    const c = t ** 2;
    points.push([a * from[0] + b * control[0] + c * to[0], a * from[1] + b * control[1] + c * to[1]]);
  }
  return { from, to, chord, control, points };
}

function fitJoinPoint(e, f, worlds, bridges) {
  if (e.type === 'ring') {
    const p = e.picots.get(f);
    return worlds[e.index].place(p[0], p[1]);
  }
  const { points } = bridges[e.index];
  return points[Math.round(f * FIT_BRIDGE_SAMPLES)];
}

// What is wrong with a pose, as a number: zero means every rule holds, with a margin to spare.
// Poses may be missing while a layout is being built up; only what is placed is measured.
function fitViolation(model, poses) {
  let score = 0;
  const placedRings = model.rings.filter((e) => poses[e.index]);
  const placedBridges = model.bridges.filter((e) => poses[e.prev] && poses[e.next]);
  const worlds = new Array(model.m);
  placedRings.forEach((e) => { worlds[e.index] = fitWorldRing(e, poses[e.index]); });
  const bridges = new Array(model.m);
  placedBridges.forEach((e) => { bridges[e.index] = fitWorldBridge(e, worlds); });

  model.free.forEach((e) => {
    if (poses[e.index] && e.mirror !== e.index && poses[e.index].x > -U) score += ((poses[e.index].x + U) / U) ** 2 * 5;
  });
  model.joins.forEach((j) => {
    const ready = (e) => (e.type === 'ring' ? worlds[e.index] : bridges[e.index]);
    if (!ready(j.a) || !ready(j.b)) return;
    const gap = fitDist(fitJoinPoint(j.a, j.fa, worlds, bridges), fitJoinPoint(j.b, j.fb, worlds, bridges));
    if (gap > 1.35 * U) score += ((gap - 1.35 * U) / U) ** 2 * 30;
  });
  const need = 0.3 * U;
  for (let i = 0; i < placedRings.length; i++) {
    const a = worlds[placedRings[i].index];
    for (let j = i + 1; j < placedRings.length; j++) {
      const b = worlds[placedRings[j].index];
      if (fitDist(a.center, b.center) > a.radius + b.radius + need) continue;
      const shared = fitDist(a.base, b.base) < 1;
      let min = Infinity;
      for (const p of a.outline) {
        if (shared && fitDist(p, a.base) < 2 * U) continue;
        if (fitInside(p, b.outline)) score += 8;
        for (const q of b.outline) {
          if (shared && fitDist(q, b.base) < 2 * U) continue;
          const d = fitDist(p, q);
          if (d < min) min = d;
        }
      }
      for (const q of b.outline) if (!(shared && fitDist(q, b.base) < 2 * U) && fitInside(q, a.outline)) score += 8;
      if (min < need) score += ((need - min) / U) ** 2 * 60;
    }
  }
  placedBridges.forEach((e) => {
    const bridge = bridges[e.index];
    if (bridge.chord > 0.96 * e.arc) score += ((bridge.chord - 0.96 * e.arc) / U) ** 2 * 40;
    if (bridge.chord < 0.5 * e.arc) score += ((0.5 * e.arc - bridge.chord) / U) ** 2 * 20;
    placedRings.forEach((r) => {
      const ring = worlds[r.index];
      if (fitDist(ring.center, bridge.points[10]) > ring.radius + e.arc / 2 + U) return;
      const ends = [bridge.from, bridge.to].filter((end) => fitDist(end, ring.base) < 1);
      bridge.points.forEach((p) => {
        if (ends.some((end) => fitDist(p, end) < 2 * U)) return;
        if (fitInside(p, ring.outline)) score += 8;
        for (const q of ring.outline) {
          const d = fitDist(p, q);
          if (d < 0.5 * U) score += ((0.5 * U - d) / U) ** 2 * 10;
        }
      });
    });
  });
  for (let i = 0; i < placedBridges.length; i++) {
    const a = bridges[placedBridges[i].index];
    for (let j = i + 1; j < placedBridges.length; j++) {
      const b = bridges[placedBridges[j].index];
      const ends = [a.from, a.to].filter((p) => fitDist(p, b.from) < 1 || fitDist(p, b.to) < 1);
      for (const p of a.points) {
        if (ends.some((end) => fitDist(p, end) < 1.5 * U)) continue;
        for (const q of b.points) {
          if (ends.some((end) => fitDist(q, end) < 1.5 * U)) continue;
          const d = fitDist(p, q);
          if (d < 0.7 * U) score += ((0.7 * U - d) / U) ** 2 * 20;
        }
      }
    }
  }
  // Two bridges meeting at an axis ring must not read as lines running on through it.
  model.free.filter((e) => e.mirror === e.index && worlds[e.index]).forEach((e) => {
    const ring = worlds[e.index];
    placedBridges.filter((b) => b.prev === e.index || b.next === e.index).forEach((b) => {
      const { control } = bridges[b.index];
      const dx = control[0] - ring.base[0];
      const dy = control[1] - ring.base[1];
      const angle = (Math.acos(Math.max(-1, Math.min(1, (dx * ring.dir[0] + dy * ring.dir[1]) / (Math.hypot(dx, dy) || 1)))) * 180) / Math.PI;
      if (angle > 122) score += ((angle - 122) / 10) ** 2 * 8;
      if (angle < 63) score += ((63 - angle) / 10) ** 2 * 8;
    });
  });
  // Rings with no bridge between them are only a short thread apart.
  model.items.forEach((e, i) => {
    const next = i < model.m - 1 ? model.items[i + 1] : model.closed ? model.items[0] : null;
    if (e.type === 'ring' && next?.type === 'ring' && next !== e && worlds[e.index] && worlds[next.index]) {
      const d = fitDist(worlds[e.index].base, worlds[next.index].base);
      if (d > 2.5 * U) score += ((d - 2.5 * U) / U) ** 2 * 10;
    }
  });
  return score;
}

function fitStartingShape(model, pattern, aspect, scale) {
  const elements = pattern.elements;
  const total = model.hasBridges
    ? model.bridges.reduce((sum, e) => sum + e.arc, 0) * 0.85
    : model.rings.length * 2 * U;
  const ringsInOrder = model.rings;
  const hinted = ringsInOrder.every((e) => {
    const place = elements[e.index].place;
    return Array.isArray(place?.base) && place.base.every(Number.isFinite);
  });
  const starts = new Map();
  const aimOf = (e, base, center) => {
    const place = elements[e.index].place;
    if (Array.isArray(place?.base) && Array.isArray(place?.tip) && place.tip.every(Number.isFinite) && fitDist(place.base, place.tip) > 0) {
      return Math.atan2(place.tip[1] - place.base[1], Math.abs(place.tip[0] - center) * Math.sign(place.tip[0] - place.base[0]) === 0 ? 0 : place.tip[0] - place.base[0]);
    }
    return null;
  };
  if (hinted && model.hasBridges && model.rings.length > 1) {
    const bases = ringsInOrder.map((e) => elements[e.index].place.base);
    const xs = bases.map((p) => p[0]);
    const ys = bases.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const width = Math.max(...xs) - Math.min(...xs) || 1;
    const height = Math.max(...ys) - Math.min(...ys) || 1;
    const stretch = Math.sqrt(Math.min(3, Math.max(1 / 3, aspect / (width / height))));
    let perimeter = 0;
    bases.forEach((p, i) => { perimeter += fitDist(p, bases[(i + 1) % bases.length]); });
    const factor = perimeter > 0 ? (total / perimeter) * scale : scale;
    model.free.forEach((e) => {
      const [hx, hy] = elements[e.index].place.base;
      const axis = e.mirror === e.index;
      const x = axis ? 0 : -Math.max(U, Math.abs(hx - cx) * factor * stretch);
      const y = ((hy - cy) * factor) / stretch;
      const place = elements[e.index].place;
      let a = aimOf(e, place.base, cx);
      if (a !== null && !axis && hx - cx > 0) a = Math.PI - a; // the AI walked the other way round
      if (a === null) a = Math.atan2(-y, -x);
      if (axis) a = (a > 0 && a < Math.PI) ? Math.PI / 2 : -Math.PI / 2;
      starts.set(e.index, { x, y, a });
    });
    return model.free.map((e) => starts.get(e.index));
  }
  if (!model.closed) {
    // An open chain runs left to right along a line, rings standing up.
    const steps = model.items.map((e) => (e.type === 'bridge' ? e.arc * 0.85 : 0));
    const gap = (i) => (model.items[i].type === 'ring' && model.items[i + 1]?.type === 'ring' ? 2 * U : 0);
    let at = 0;
    const positions = model.items.map((e, i) => {
      const here = at;
      at += steps[i] + gap(i);
      return here;
    });
    const middle = at / 2;
    return model.free.map((e) => ({ x: (positions[e.index] - middle) * scale, y: 0, a: -Math.PI / 2 }));
  }
  const b = total / (2 * Math.PI * Math.sqrt((aspect * aspect + 1) / 2));
  const a = b * aspect;
  const weights = model.items.map((e) => (e.type === 'bridge' ? e.arc : 0));
  const sum = weights.reduce((x, y) => x + y, 0);
  const count = model.rings.length;
  let walked = 0;
  let seen = 0;
  const angleOf = new Map();
  model.items.forEach((e, i) => {
    if (e.type === 'ring') {
      angleOf.set(e.index, sum > 0 ? (walked / sum) * 2 * Math.PI : (seen / count) * 2 * Math.PI);
      seen += 1;
    }
    walked += weights[i];
  });
  return model.free.map((e) => {
    const phi = angleOf.get(e.index);
    const axis = e.mirror === e.index;
    const x = axis ? 0 : -a * scale * Math.abs(Math.sin(phi));
    const y = -b * scale * Math.cos(phi);
    const inward = Math.atan2(-y, -x);
    const aim = model.hasBridges ? inward : inward + Math.PI;
    return { x, y, a: axis ? (Math.sin(aim) > 0 ? Math.PI / 2 : -Math.PI / 2) : aim };
  });
}

const FIT_BEAM = 8;
const FIT_TURNS = 48;

// Builds the left half ring by ring, from the top ring down. Each ring is set so its join ear meets
// the ear it joins, and only its turn around that meeting point is tried. That keeps joins reachable
// from the start and lets a long bridge push the next ring lower than the top ring, which is what
// stops the top bridges reading as an X. Returns null for patterns not shaped like this.
function fitWalkChain(model, start) {
  const { free } = model;
  if (!model.closed || !model.hasBridges || free.length < 2 || free[0].index !== 0 || free[0].mirror !== 0) return null;
  const links = free.map((e, k) => (k === 0 ? null : model.joins.find((j) => j.a === e && j.b === free[k - 1])));
  if (links.slice(1).some((link) => !link)) return null;
  const posesOf = (node) => {
    const poses = new Array(model.m);
    node.forEach((v, k) => {
      const e = free[k];
      const axis = e.mirror === e.index;
      poses[e.index] = { x: axis ? 0 : v.x, y: v.y, a: v.a };
      if (!axis) poses[e.mirror] = { x: -v.x, y: v.y, a: Math.PI - v.a };
    });
    return poses;
  };
  const pullOf = (v, k) => {
    const turn = Math.atan2(Math.sin(v.a - start[k].a), Math.cos(v.a - start[k].a));
    return (((v.x - start[k].x) / U) ** 2 + ((v.y - start[k].y) / U) ** 2) * 0.01 + turn ** 2 * 0.15;
  };
  let nodes = [{ vars: [{ x: 0, y: start[0].y, a: start[0].a }], pull: 0 }];
  for (let k = 1; k < free.length; k++) {
    const e = free[k];
    const link = links[k];
    const ear = e.picots.get(link.fa);
    const axis = e.mirror === e.index;
    const grown = [];
    nodes.forEach((node) => {
      const before = node.vars[k - 1];
      const beforeWorld = fitWorldRing(free[k - 1], before);
      const target = beforeWorld.place(...free[k - 1].picots.get(link.fb));
      const away = Math.atan2(target[1] - beforeWorld.center[1], target[0] - beforeWorld.center[0]);
      const add = (v) => {
        const vars = [...node.vars, v];
        const pull = node.pull + pullOf(v, k);
        grown.push({ vars, pull, score: fitViolation(model, posesOf(vars)) + pull });
      };
      if (axis) {
        const a = start[k].a;
        const y = target[1] - (ear[0] * Math.sin(a) + ear[1] * Math.cos(a));
        [-0.8, -0.4, 0, 0.4, 0.8].forEach((off) => add({ x: 0, y: y + off * U, a }));
        return;
      }
      // Only poses whose bridge can be drawn are worth measuring.
      const bridge = model.items[e.index - 1];
      const beforeBase = [before.x, before.y];
      for (let t = 0; t < FIT_TURNS; t++) {
        const a = (t / FIT_TURNS) * 2 * Math.PI;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        [0, 0.6, -0.6, 1.2, -1.2].forEach((spread) => {
          [0.6, 1, 1.3].forEach((reach) => {
            const x = target[0] + Math.cos(away + spread) * reach * U - (ear[0] * cos - ear[1] * sin);
            const y = target[1] + Math.sin(away + spread) * reach * U - (ear[0] * sin + ear[1] * cos);
            if (x >= -0.8 * U) return;
            if (bridge?.type === 'bridge') {
              const chord = fitDist([x, y], beforeBase);
              if (chord > 0.96 * bridge.arc || chord < 0.5 * bridge.arc) return;
            }
            add({ x, y, a });
          });
        });
      }
    });
    if (grown.length === 0) return null;
    grown.sort((p, q) => p.score - q.score);
    nodes = grown.slice(0, FIT_BEAM);
  }
  return nodes.slice(0, 3).map((node) => node.vars);
}

// Where this ring's first join to an earlier element sits right now, to keep it aimed that way when moved.
function fitJoinTarget(model, vars, e) {
  const join = model.joins.find((j) => j.a === e && j.b.type === 'ring');
  if (!join) return null;
  const poses = fitPoses(model, vars);
  return fitWorldRing(join.b, poses[join.b.index]).place(...join.b.picots.get(join.fb));
}

// Coordinate descent over the left half, from big moves to small, including scaling the whole shape.
function fitSearch(model, start, spent) {
  let vars = start.map((v) => ({ ...v }));
  const pull = (candidate) => candidate.reduce((sum, v, k) => sum + (((v.x - start[k].x) / U) ** 2 + ((v.y - start[k].y) / U) ** 2) * 0.01, 0);
  const measure = (candidate) => {
    spent.evals += 1;
    const violation = fitViolation(model, fitPoses(model, candidate));
    return { violation, total: violation + pull(candidate) };
  };
  let best = measure(vars);
  const degree = Math.PI / 180;
  for (const [move, turn] of [[12, 12], [6, 6], [3, 3], [1.5, 2], [0.75, 1]]) {
    for (let round = 0; round < 6; round++) {
      let improved = false;
      const attempt = (next) => {
        const score = measure(next);
        if (score.total < best.total - 1e-9) {
          vars = next;
          best = score;
          improved = true;
        }
      };
      for (let k = 0; k < vars.length; k++) {
        const axis = model.free[k].mirror === model.free[k].index;
        const tries = axis
          ? [{ y: move }, { y: -move }]
          : [
            { x: move }, { x: -move }, { y: move }, { y: -move }, { a: turn * degree }, { a: -turn * degree },
            { x: move, y: move }, { x: -move, y: move }, { x: move, y: -move }, { x: -move, y: -move },
          ];
        for (const change of tries) {
          if (best.violation < 1e-9 || spent.evals > spent.limit) return { vars, ...best };
          const next = vars.map((v) => ({ ...v }));
          next[k].x += change.x ?? 0;
          next[k].y += change.y ?? 0;
          next[k].a += change.a ?? 0;
          attempt(next);
          if (change.a !== undefined || axis) continue;
          // The same move, turning the ring so it still points at the ear it joins.
          const target = fitJoinTarget(model, vars, model.free[k]);
          if (!target || spent.evals > spent.limit) continue;
          const aimed = next.map((v) => ({ ...v }));
          aimed[k].a += Math.atan2(target[1] - aimed[k].y, target[0] - aimed[k].x) - Math.atan2(target[1] - vars[k].y, target[0] - vars[k].x);
          attempt(aimed);
        }
      }
      // Moving a ring and everything after it together keeps their joins while a bridge changes shape.
      for (let k = 1; k < vars.length; k++) {
        for (const dy of [move, -move]) {
          if (best.violation < 1e-9 || spent.evals > spent.limit) return { vars, ...best };
          attempt(vars.map((v, index) => (index >= k ? { ...v, y: v.y + dy } : { ...v })));
        }
      }
      for (const factor of [1 + move / 200, 1 - move / 200]) {
        if (spent.evals > spent.limit) return { vars, ...best };
        attempt(vars.map((v) => ({ ...v, x: v.x * factor, y: v.y * factor })));
      }
      if (!improved) break;
    }
  }
  return { vars, ...best };
}

function fitBuild(model, vars) {
  const poses = fitPoses(model, vars);
  const place = {};
  const bases = new Array(model.m);
  model.free.forEach((e) => {
    const pose = poses[e.index];
    const length = e.shape.length;
    const base = [fitRound(pose.x), fitRound(pose.y)];
    const tip = [fitRound(pose.x + Math.cos(pose.a) * length), fitRound(pose.y + Math.sin(pose.a) * length)];
    const width = fitRound(length * RING_SHAPE);
    if (e.mirror === e.index) tip[0] = 0;
    place[e.id] = { base, tip, width, dir: 'cw' };
    bases[e.index] = base;
    if (e.mirror !== e.index) {
      const other = model.items[e.mirror];
      place[other.id] = { base: [fitRound(-base[0]), base[1]], tip: [fitRound(-tip[0]), tip[1]], width, dir: 'cw' };
      bases[e.mirror] = place[other.id].base;
    }
  });
  model.bridges.forEach((e) => {
    const from = bases[e.prev];
    const to = bases[e.next];
    place[e.id] = { from: [...from], to: [...to], bulge: fitRound(-fitBulgeFor(fitDist(from, to), e.arc)) };
  });
  return place;
}

function fitViewBox(pattern, place) {
  const points = pattern.elements.flatMap((element) => {
    const geometry = elementGeometry({ type: element.type, place: place[element.id] });
    return Array.from({ length: 81 }, (_, i) => geometry.pointAt(i / 80));
  });
  const xs = points.map((p) => Math.abs(p.x));
  const ys = points.map((p) => p.y);
  const halfWidth = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = 34 + 0.12 * Math.max(halfWidth * 2, maxY - minY) + 1;
  const half = Math.ceil(halfWidth + margin);
  const top = Math.floor(minY - margin);
  return [-half, top, half * 2, Math.ceil(maxY + margin) - top];
}

export function fitLayout(pattern, { aspect = 1 } = {}) {
  const structure = fitStructureProblems(pattern);
  if (structure.length) return { place: {}, viewBox: null, problems: structure };
  const model = fitModel(pattern);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const spent = { evals: 0, limit: 0 };
  let last = [];
  // A very tall or wide sketch may not fit as drawn, so its proportions give way last of all.
  const tries = [
    ...FIT_STARTS.map((scale) => [safeAspect, scale]),
    ...(safeAspect === 1 ? [] : [[Math.sqrt(safeAspect), 1], [1, 1]]),
  ];
  for (const [shape, scale] of tries) {
    const rough = fitStartingShape(model, pattern, shape, scale);
    for (const start of fitWalkChain(model, rough) ?? [rough]) {
      spent.limit += FIT_MAX_EVALS;
      const { vars } = fitSearch(model, start, spent);
      const place = fitBuild(model, vars);
      const viewBox = fitViewBox(pattern, place);
      const problems = layoutProblems(fitApply(pattern, place, viewBox));
      if (problems.length === 0) return { place, viewBox, problems: [] };
      if (last.length === 0 || problems.length < last.length) last = problems;
    }
  }
  return { place: {}, viewBox: null, problems: last };
}

function fitApply(pattern, place, viewBox) {
  const copy = structuredClone(pattern);
  copy.elements.forEach((element) => { element.place = place[element.id]; });
  copy.layout = { ...copy.layout, viewBox };
  return copy;
}

export function applyLayout(pattern, fitted) {
  return fitApply(pattern, fitted.place, fitted.viewBox);
}

const fitMirrorX = (point) => [fitRound(-point[0]), point[1]];
const fitSamePoint = (a, b) => Math.abs(a[0] - b[0]) < 0.051 && Math.abs(a[1] - b[1]) < 0.051;

// Measures a placed pattern against every layout rule, with the geometry the chart really draws.
export function layoutProblems(pattern) {
  const structure = fitStructureProblems(pattern);
  if (structure.length) return structure;
  const problems = new Set();
  const elements = pattern.elements;
  const placeOk = elements.every((e) => (e.type === 'ring'
    ? Array.isArray(e.place?.base) && Array.isArray(e.place?.tip) && Number.isFinite(e.place?.width)
    : Array.isArray(e.place?.from) && Array.isArray(e.place?.to) && Number.isFinite(e.place?.bulge)));
  if (!placeOk) return ['有元素还没有摆位'];
  const m = elements.length;
  const closed = pattern.layout?.closed === true;
  const model = elements.map((element, i) => {
    const read = readElement(element);
    const geometry = elementGeometry(element);
    return { element, id: element.id, type: element.type, read, stitches: read.stitches, geometry, index: i, samples: Array.from({ length: 121 }, (_, k) => {
      const p = geometry.pointAt(k / 120);
      return [p.x, p.y];
    }) };
  });
  const byId = new Map(model.map((e) => [e.id, e]));
  const rings = model.filter((e) => e.type === 'ring');
  const bridges = model.filter((e) => e.type === 'bridge');
  const atFraction = (e, f) => {
    const p = e.geometry.pointAt(f);
    return [p.x, p.y];
  };

  const sizes = new Map();
  rings.forEach((e) => {
    const { base, tip, width } = e.element.place;
    const length = fitDist(base, tip);
    if (Math.abs(e.geometry.length - e.stitches * U) > e.stitches * U * 0.02 || Math.abs(width - RING_SHAPE * length) > 0.3) {
      problems.add(`${e.id} 环的大小和 ${e.stitches} 针对不上`);
    }
    const seen = sizes.get(e.stitches);
    if (seen && (Math.abs(seen.length - length) > 0.3 || Math.abs(seen.width - width) > 0.11)) problems.add(`${seen.id} 和 ${e.id} 针数相同，大小必须一样`);
    if (!seen) sizes.set(e.stitches, { id: e.id, length, width });
  });
  bridges.forEach((e) => {
    const arc = e.stitches * U;
    if (Math.abs(e.geometry.length - arc) > arc * 0.03) problems.add(`${e.id} 桥的长度和 ${e.stitches} 针对不上：请调整这段桥的针数`);
    if (fitDist(e.element.place.from, e.element.place.to) < 0.45 * arc) problems.add(`${e.id} 桥太长，鼓得太厉害：请减少这段桥的针数`);
  });
  model.forEach((e) => e.read.items.filter((x) => x.kind === 'join').forEach((x) => {
    const target = byId.get(x.element);
    const leave = target?.read.items.find((y) => y.kind === 'leave' && y.name === x.name);
    if (!leave) {
      problems.add(`${e.id} 要接的 ${x.element}.${x.name} 不存在`);
      return;
    }
    if (fitDist(atFraction(e, x.from / e.stitches), atFraction(target, leave.from / target.stitches)) > 1.5 * U) {
      problems.add(`${e.id} 和 ${target.id} 的接耳够不着：请调整这两个环的针数或接耳位置`);
    }
  }));
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i];
      const b = rings[j];
      const shared = fitDist(a.element.place.base, b.element.place.base) < 1;
      const near = (p, r) => shared && fitDist(p, r.element.place.base) < 2 * U;
      const pointsA = a.samples.filter((p) => !near(p, a));
      const pointsB = b.samples.filter((p) => !near(p, b));
      const tooClose = pointsA.some((p) => pointsB.some((q) => fitDist(p, q) < 0.25 * U));
      if (tooClose || pointsA.some((p) => fitInside(p, b.samples)) || pointsB.some((p) => fitInside(p, a.samples))) {
        problems.add(`${a.id} 和 ${b.id} 两个环重叠了：请减小这两个环的针数`);
      }
    }
  }
  model.forEach((e, i) => {
    const j = fitMirrorIndex(i, m, closed);
    const other = model[j];
    const bad = () => problems.add(`${e.id} 和 ${other.id} 的位置没有左右镜像`);
    if (e.type === 'ring') {
      const a = e.element.place;
      const b = other.element.place;
      if (!fitSamePoint(a.base, fitMirrorX(b.base)) || !fitSamePoint(a.tip, fitMirrorX(b.tip)) || a.width !== b.width || a.dir !== b.dir) bad();
    } else {
      const a = e.element.place;
      const b = other.element.place;
      if (!fitSamePoint(a.from, fitMirrorX(b.to)) || !fitSamePoint(a.to, fitMirrorX(b.from)) || a.bulge !== b.bulge) bad();
    }
  });
  for (let i = 0; i < bridges.length; i++) {
    const a = bridges[i];
    for (let j = i + 1; j < bridges.length; j++) {
      const b = bridges[j];
      if (fitPolylinesCross(a.samples, b.samples, [a.element.place.from, a.element.place.to].filter((p) => fitSamePoint(p, b.element.place.from) || fitSamePoint(p, b.element.place.to)), 0.5 * U)) {
        problems.add(`${a.id} 和 ${b.id} 两段桥交叉了：请调整这两段桥的针数`);
      }
    }
    rings.forEach((r) => {
      const ends = [a.element.place.from, a.element.place.to].filter((p) => fitSamePoint(p, r.element.place.base));
      const free = (p) => !ends.some((end) => fitDist(p, end) < 1.5 * U);
      if (fitPolylinesCross(a.samples, r.samples, ends, 1.5 * U) || a.samples.some((p) => free(p) && fitInside(p, r.samples))) {
        problems.add(`${a.id} 桥穿过了 ${r.id} 环：请调整针数`);
      }
    });
  }
  rings.forEach((r) => {
    if (fitMirrorIndex(r.index, m, closed) !== r.index) return;
    const { base, tip } = r.element.place;
    const axisLength = fitDist(base, tip) || 1;
    bridges.filter((b) => fitSamePoint(b.element.place.from, base) || fitSamePoint(b.element.place.to, base)).forEach((b) => {
      const { from, to, bulge } = b.element.place;
      const chord = fitDist(from, to) || 1;
      const control = [(from[0] + to[0]) / 2 + ((to[1] - from[1]) / chord) * bulge, (from[1] + to[1]) / 2 - ((to[0] - from[0]) / chord) * bulge];
      const dx = control[0] - base[0];
      const dy = control[1] - base[1];
      const cos = (dx * (tip[0] - base[0]) + dy * (tip[1] - base[1])) / ((Math.hypot(dx, dy) || 1) * axisLength);
      const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (angle < 60 || angle > 125) problems.add(`${b.id} 桥和 ${r.id} 环看起来像一条线直线穿过：请缩短 ${b.id} 桥的针数`);
    });
  });
  model.forEach((e, i) => {
    const next = i < m - 1 ? model[i + 1] : closed ? model[0] : null;
    if (e.type === 'bridge') {
      const before = i > 0 ? model[i - 1] : closed ? model[m - 1] : null;
      if (before?.type === 'ring' && !fitSamePoint(e.element.place.from, before.element.place.base)) problems.add(`${e.id} 的起点没接到 ${before.id} 环`);
      if (next?.type === 'ring' && !fitSamePoint(e.element.place.to, next.element.place.base)) problems.add(`${e.id} 的终点没接到 ${next.id} 环`);
    } else if (next?.type === 'ring' && next !== e && fitDist(e.element.place.base, next.element.place.base) > 3 * U) {
      problems.add(`${e.id} 和 ${next.id} 两个环隔得太远`);
    }
  });
  const viewBox = pattern.layout?.viewBox;
  const points = model.flatMap((e) => e.samples);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const margin = 34 + 0.12 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!Array.isArray(viewBox) || viewBox.length !== 4 || Math.min(...xs) - viewBox[0] < margin - 0.5 || viewBox[0] + viewBox[2] - Math.max(...xs) < margin - 0.5
    || Math.min(...ys) - viewBox[1] < margin - 0.5 || viewBox[1] + viewBox[3] - Math.max(...ys) < margin - 0.5) {
    problems.add('画面没有把花样和标注的空间都留够');
  }
  return [...problems];
}

// True if two sampled lines cross, leaving out points close to a shared end.
function fitPolylinesCross(a, b, ends, skip) {
  const free = (p) => !ends.some((end) => fitDist(p, end) < skip);
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 1; i < a.length; i++) {
    if (!free(a[i - 1]) || !free(a[i])) continue;
    for (let j = 1; j < b.length; j++) {
      if (!free(b[j - 1]) || !free(b[j])) continue;
      if (side(a[i - 1], a[i], b[j - 1]) * side(a[i - 1], a[i], b[j]) < 0 && side(b[j - 1], b[j], a[i - 1]) * side(b[j - 1], b[j], a[i]) < 0) return true;
    }
  }
  return false;
}
