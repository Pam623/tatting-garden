// Turns a drawn outline into a complete pattern with no AI: the outline decides where rings go, the
// stitch unit decides their counts, and fit-layout's own checks decide whether the result can be made.
// Only the left half is worked out; the right half is its exact mirror.
import { elementGeometry } from './diagram.js';
import { RING_SHAPE, STITCH_UNIT as U, layoutProblems } from './fit-layout.js';
import { checkPattern, structureProblems } from './pattern.js';

const GRID = 240;
const MAX_MIRROR_ERROR = 0.16;
const PATH_POINTS = 240;
const CORNER_WINDOW = 9;
const CONVEX_CORNER = 52;
const CONCAVE_CORNER = 40;
const MAX_CORNERS = 14;
const MIN_LIKENESS = 0.72;
const MAX_STITCHES = 340;
const SIZES = [230, 270, 320, 380, 450];
const SPACINGS = [65, 85, 110, 145];
const TIP_RINGS = [6, 8, 10];
const TIP_REACH = 0.65;
const QUALITY_MARGIN = 0.1;
const MIN_RING = 6;
const NEAR_STRAIGHT = 0.985;
const MAX_RING = 26;
const REACH = 1.25 * U;
const CLEAR = 0.4 * U;
const AXIS_MIN = 62;
const AXIS_MAX = 123;

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
const round1 = (value) => Math.round(value * 10) / 10 + 0;
const degrees = (radians) => (radians * 180) / Math.PI;

/* ---------- from strokes or pixels to a filled shape ---------- */

// Fills a grid from lines, scaled so what was drawn sits in the middle of the grid.
function strokesToInk(lines, radius) {
  const points = lines.flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const fit = (GRID * 0.76) / span;
  const offX = (GRID - (Math.max(...xs) - minX) * fit) / 2;
  const offY = (GRID - (Math.max(...ys) - minY) * fit) / 2;
  const ink = new Uint8Array(GRID * GRID);
  const dab = (cx, cy) => {
    const r = Math.ceil(radius);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(GRID - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GRID - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) ink[y * GRID + x] = 1;
      }
    }
  };
  lines.forEach((line) => {
    const at = line.map(([x, y]) => [(x - minX) * fit + offX, (y - minY) * fit + offY]);
    if (at.length === 1) dab(at[0][0], at[0][1]);
    for (let i = 1; i < at.length; i++) {
      const steps = Math.max(1, Math.ceil(dist(at[i - 1], at[i]) * 2));
      for (let k = 0; k <= steps; k++) dab(at[i - 1][0] + ((at[i][0] - at[i - 1][0]) * k) / steps, at[i - 1][1] + ((at[i][1] - at[i - 1][1]) * k) / steps);
    }
  });
  return ink;
}

// Pixels (1 for ink) are boxed to what was drawn, then scaled onto the same grid.
function pixelsToInk({ width, height, data }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  const span = Math.max(maxX - minX, maxY - minY) + 1;
  const fit = (GRID * 0.76) / span;
  const offX = (GRID - (maxX - minX + 1) * fit) / 2;
  const offY = (GRID - (maxY - minY + 1) * fit) / 2;
  const ink = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const sx = Math.floor((x + 0.5 - offX) / fit) + minX;
      const sy = Math.floor((y + 0.5 - offY) / fit) + minY;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY && data[sy * width + sx]) ink[y * GRID + x] = 1;
    }
  }
  return ink;
}

// Distance of every cell from the nearest cell that is off (or on, with invert), by a two-pass sweep.
function distanceField(cells, size, invert = false) {
  const far = 1e6;
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i++) field[i] = (cells[i] ? 1 : 0) === (invert ? 1 : 0) ? 0 : far;
  const near = (a, b, cost) => (b + cost < a ? b + cost : a);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (x > 0) field[i] = near(field[i], field[i - 1], 1);
      if (y > 0) {
        field[i] = near(field[i], field[i - size], 1);
        if (x > 0) field[i] = near(field[i], field[i - size - 1], 1.414);
        if (x < size - 1) field[i] = near(field[i], field[i - size + 1], 1.414);
      }
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (x < size - 1) field[i] = near(field[i], field[i + 1], 1);
      if (y < size - 1) {
        field[i] = near(field[i], field[i + size], 1);
        if (x < size - 1) field[i] = near(field[i], field[i + size + 1], 1.414);
        if (x > 0) field[i] = near(field[i], field[i + size - 1], 1.414);
      }
    }
  }
  return field;
}

const grow = (cells, size, radius) => distanceField(cells, size, true).map((d) => (d <= radius ? 1 : 0));
const shrink = (cells, size, radius) => distanceField(cells, size).map((d) => (d > radius ? 1 : 0));

// Everything the outside can't reach, so a closed line becomes a solid shape.
function fillEnclosed(cells, size) {
  const outside = new Uint8Array(size * size);
  const stack = [];
  const visit = (i) => {
    if (!cells[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let k = 0; k < size; k++) {
    visit(k);
    visit((size - 1) * size + k);
    visit(k * size);
    visit(k * size + size - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % size;
    if (x > 0) visit(i - 1);
    if (x < size - 1) visit(i + 1);
    if (i >= size) visit(i - size);
    if (i < size * (size - 1)) visit(i + size);
  }
  return outside.map((v) => (v ? 0 : 1));
}

function largestPiece(cells, size) {
  const seen = new Int32Array(size * size);
  let best = 0;
  let bestCount = 0;
  let label = 0;
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    label += 1;
    let count = 0;
    const stack = [start];
    seen[start] = label;
    while (stack.length) {
      const i = stack.pop();
      count += 1;
      const x = i % size;
      [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size].forEach((n) => {
        if (n >= 0 && n < cells.length && cells[n] && !seen[n]) {
          seen[n] = label;
          stack.push(n);
        }
      });
    }
    if (count > bestCount) {
      bestCount = count;
      best = label;
    }
  }
  return { cells: cells.map((_, i) => (seen[i] === best && best ? 1 : 0)), count: bestCount };
}

// Solid shape from ink: bridges small gaps, then drops thin lines such as antennae or a hanging stem.
function solidShape(ink) {
  const areaOk = (piece) => piece.count > GRID * GRID * 0.04;
  let piece = null;
  for (const close of [3.5, 7]) {
    const filled = shrink(fillEnclosed(grow(ink, GRID, close), GRID), GRID, close);
    piece = largestPiece(grow(shrink(filled, GRID, 2.8), GRID, 2.8), GRID);
    if (areaOk(piece)) break;
  }
  return areaOk(piece) ? piece.cells : null;
}

function findAxis(cells) {
  let minX = GRID;
  let maxX = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) {
      minX = Math.min(minX, i % GRID);
      maxX = Math.max(maxX, i % GRID);
    }
  }
  const middle = (minX + maxX) / 2;
  let best = { axis: middle, error: Infinity };
  for (let twice = Math.round((middle - GRID * 0.05) * 2); twice <= Math.round((middle + GRID * 0.05) * 2); twice++) {
    let differ = 0;
    let total = 0;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!cells[y * GRID + x]) continue;
        total += 1;
        const mx = twice - x;
        if (mx < 0 || mx >= GRID || !cells[y * GRID + mx]) differ += 1;
      }
    }
    const error = differ / (total || 1);
    if (error < best.error) best = { axis: twice / 2, error };
  }
  return best;
}

// The left half reflected over the right, so the two sides can't differ.
function mirrorLeft(cells, axis) {
  const out = new Uint8Array(GRID * GRID);
  const twice = Math.round(axis * 2);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (x * 2 > twice) continue;
      if (cells[y * GRID + x]) {
        out[y * GRID + x] = 1;
        const mx = twice - x;
        if (mx >= 0 && mx < GRID) out[y * GRID + mx] = 1;
      }
    }
  }
  return out;
}

// The shape's outer edge, walked round cell by cell.
function traceEdge(cells) {
  const start = cells.findIndex((v) => v);
  if (start < 0) return [];
  const steps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const on = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && cells[y * GRID + x];
  const sx = start % GRID;
  const sy = Math.floor(start / GRID);
  const edge = [[sx, sy]];
  let x = sx;
  let y = sy;
  let from = 6;
  for (let guard = 0; guard < GRID * GRID; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (from + k) % 8;
      const nx = x + steps[d][0];
      const ny = y + steps[d][1];
      if (on(nx, ny)) {
        x = nx;
        y = ny;
        from = (d + 4) % 8;
        moved = true;
        break;
      }
    }
    if (!moved || (x === sx && y === sy)) break;
    edge.push([x, y]);
  }
  return edge;
}

function resample(points, count) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  const total = lengths[lengths.length - 1];
  const out = [];
  let at = 1;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    while (at < points.length - 1 && lengths[at] < target) at += 1;
    const span = lengths[at] - lengths[at - 1] || 1;
    const f = (target - lengths[at - 1]) / span;
    out.push([points[at - 1][0] + (points[at][0] - points[at - 1][0]) * f, points[at - 1][1] + (points[at][1] - points[at - 1][1]) * f]);
  }
  return out;
}

// The left half of the edge, top to bottom, in units where the shape's bigger side is 1.
function leftPath(cells, axis) {
  const edge = traceEdge(cells);
  if (edge.length < 20) return null;
  const onAxis = edge.map((p, i) => ({ i, y: p[1], x: p[0] })).filter((p) => Math.abs(p.x - axis) <= 1);
  if (onAxis.length < 2) return null;
  const top = onAxis.reduce((a, b) => (b.y < a.y ? b : a));
  const bottom = onAxis.reduce((a, b) => (b.y > a.y ? b : a));
  if (top.y === bottom.y) return null;
  const walk = (from, to) => {
    const out = [];
    for (let i = from; ; i = (i + 1) % edge.length) {
      out.push(edge[i]);
      if (i === to) break;
    }
    return out;
  };
  const one = walk(top.i, bottom.i);
  const two = walk(bottom.i, top.i).reverse();
  const meanX = (line) => line.reduce((sum, p) => sum + p[0], 0) / line.length;
  const left = meanX(one) < meanX(two) ? one : two;
  const xs = edge.map((p) => Math.abs(p[0] - axis) * 2);
  const ys = edge.map((p) => p[1]);
  const size = Math.max(Math.max(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const middleY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const smooth = left.map((_, i) => {
    const near = left.slice(Math.max(0, i - 2), i + 3);
    return i === 0 || i === left.length - 1 ? left[i] : [near.reduce((s, p) => s + p[0], 0) / near.length, near.reduce((s, p) => s + p[1], 0) / near.length];
  });
  const normal = smooth.map(([x, y]) => [Math.min(0, (x - axis) / size), (y - middleY) / size]);
  normal[0][0] = 0;
  normal[normal.length - 1][0] = 0;
  return { points: resample(normal, PATH_POINTS), size, middleY };
}

// Positive is a corner pointing out of the shape, negative a notch into it.
function turnAt(path, i) {
  const k = CORNER_WINDOW;
  if (i < k || i >= path.length - k) return 0;
  const a = [path[i][0] - path[i - k][0], path[i][1] - path[i - k][1]];
  const b = [path[i + k][0] - path[i][0], path[i + k][1] - path[i][1]];
  return -degrees(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
}

function findCorners(path) {
  const turns = path.map((_, i) => turnAt(path, i));
  const found = [];
  turns.forEach((turn, i) => {
    const strong = turn >= CONVEX_CORNER || turn <= -CONCAVE_CORNER;
    if (!strong || i < CORNER_WINDOW * 1.5 || i > path.length - 1 - CORNER_WINDOW * 1.5) return;
    for (let k = Math.max(0, i - CORNER_WINDOW); k <= Math.min(path.length - 1, i + CORNER_WINDOW); k++) {
      if (Math.abs(turns[k]) > Math.abs(turn)) return;
    }
    if (found.length && i - found[found.length - 1].i < CORNER_WINDOW) return;
    found.push({ i, turn, kind: turn > 0 ? 'tip' : 'notch' });
  });
  return found;
}

// What the outline does where it meets the axis: stands up as a tip, dips as a notch, or runs across.
function axisEnd(path, atTop) {
  const k = CORNER_WINDOW;
  const from = atTop ? path[0] : path[path.length - 1];
  const to = atTop ? path[k] : path[path.length - 1 - k];
  const out = atTop ? [0, -1] : [0, 1];
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const angle = degrees(Math.acos(Math.max(-1, Math.min(1, (dx * out[0] + dy * out[1]) / (Math.hypot(dx, dy) || 1)))));
  if (angle > 112) return { kind: 'tip', angle };
  if (angle < 62) return { kind: 'notch', angle };
  return { kind: 'round', angle };
}

/* ---------- ring shapes ---------- */

let ringPerimeter = null;
function ringLength(stitches) {
  if (ringPerimeter === null) ringPerimeter = elementGeometry({ type: 'ring', place: { base: [0, 0], tip: [100, 0], width: 100 * RING_SHAPE, dir: 'cw' } }).length / 100;
  return (stitches * U) / ringPerimeter;
}

const shapes = new Map();
function ringShape(stitches) {
  if (!shapes.has(stitches)) {
    const length = ringLength(stitches);
    const geometry = elementGeometry({ type: 'ring', place: { base: [0, 0], tip: [length, 0], width: length * RING_SHAPE, dir: 'cw' } });
    const outline = Array.from({ length: 28 }, (_, k) => {
      const p = geometry.pointAt(k / 28);
      return [p.x, p.y];
    });
    const ears = [];
    for (let at = 2; at <= stitches - 2; at++) {
      const p = geometry.pointAt(at / stitches);
      ears.push({ at, x: p.x, y: p.y });
    }
    shapes.set(stitches, { length, outline, ears });
  }
  return shapes.get(stitches);
}

// A ring's points in the world; mirrored gives its reflection, with stitch positions counted the other way.
function worldRing(ring, mirrored = false) {
  const key = `${ring.stitches}|${ring.angle}|${mirrored}`;
  ring.memo ??= new Map();
  if (!ring.memo.has(key)) ring.memo.set(key, computeWorldRing(ring, mirrored));
  return ring.memo.get(key);
}

function computeWorldRing(ring, mirrored) {
  const shape = ringShape(ring.stitches);
  const cos = Math.cos(ring.angle);
  const sin = Math.sin(ring.angle);
  const flipX = mirrored ? -1 : 1;
  const place = (x, y) => [flipX * (ring.base[0] + x * cos - y * sin), ring.base[1] + x * sin + y * cos];
  return {
    outline: shape.outline.map((p) => place(p[0], p[1])),
    ears: shape.ears.map((e) => ({ at: mirrored ? ring.stitches - e.at : e.at, point: place(e.x, e.y) })),
    tip: place(shape.length, 0),
    base: place(0, 0),
    middle: place(shape.length / 2, 0),
    span: shape.length / 2 + 1,
  };
}

function pairGap(a, b) {
  const apart = dist(a.middle, b.middle);
  if (apart > a.span + b.span + 3 * U) return { reach: apart - a.span - b.span, clear: apart - a.span - b.span, earA: null, earB: null };
  let reach = Infinity;
  let earA = null;
  let earB = null;
  a.ears.forEach((p) => b.ears.forEach((q) => {
    const d = dist(p.point, q.point);
    if (d < reach) {
      reach = d;
      earA = p.at;
      earB = q.at;
    }
  }));
  let clear = Infinity;
  a.outline.forEach((p) => b.outline.forEach((q) => {
    const d = dist(p, q);
    if (d < clear) clear = d;
  }));
  return { reach, clear, earA, earB };
}

function insideOutline(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/* ---------- planning one half ---------- */

class Walk {
  constructor(points, size) {
    this.points = points.map(([x, y]) => [x * size, y * size]);
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i++) this.lengths.push(this.lengths[i - 1] + dist(this.points[i - 1], this.points[i]));
    this.total = this.lengths[this.lengths.length - 1];
    this.closed = [...this.points, ...[...this.points].reverse().map(([x, y]) => [-x, y])];
  }

  at(l) {
    const target = Math.min(this.total, Math.max(0, l));
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < target) i += 1;
    const span = this.lengths[i] - this.lengths[i - 1] || 1;
    const f = (target - this.lengths[i - 1]) / span;
    return [this.points[i - 1][0] + (this.points[i][0] - this.points[i - 1][0]) * f, this.points[i - 1][1] + (this.points[i][1] - this.points[i - 1][1]) * f];
  }

  // The way into the shape here. Walking down the left side, the inside is to the walker's left hand on screen.
  inward(l, reach = 22) {
    const a = this.at(l - reach);
    const b = this.at(l + reach);
    return Math.atan2(-(b[0] - a[0]), b[1] - a[1]);
  }

  lengthOfIndex(i) {
    return this.lengths[i];
  }
}

// Rings of one left half, in working order from the top of the outline to the bottom.
function planHalf(walk, corners, ends, { spacing, tipRing, topStyle, bottomStyle }) {
  const rings = [];
  const add = (ring) => {
    rings.push({ joinNext: 'bridge', ...ring });
    return rings[rings.length - 1];
  };
  const axisAngleIn = (atTop) => (atTop ? Math.PI / 2 : -Math.PI / 2);
  const planEnd = (atTop, style) => {
    const kind = ends[atTop ? 'top' : 'bottom'];
    const l = atTop ? 0 : walk.total;
    const point = walk.at(l);
    const sign = atTop ? 1 : -1;
    const out = [];
    if (style === 'single') {
      if (kind === 'tip') {
        const length = ringLength(tipRing);
        const angle = axisAngleIn(atTop) + Math.PI;
        out.push({ role: 'tip', axis: true, l, stitches: tipRing, angle, fixed: true, base: [0, point[1] + (sign * length * TIP_REACH)] });
      } else {
        out.push({ role: 'in', axis: true, l, stitches: 10, angle: axisAngleIn(atTop), base: [0, point[1]] });
      }
    } else if (style === 'cluster') {
      // A small ring each side of the axis ring takes the bridge, so the bridge can leave at any angle.
      if (kind === 'tip') {
        const length = ringLength(tipRing);
        const base = [0, point[1] + sign * length * TIP_REACH];
        const angle = axisAngleIn(atTop) + Math.PI;
        out.push({ role: 'tip', axis: true, l, stitches: tipRing, angle, fixed: true, base, joinNext: 'none' });
        const side = [-1.5 * U, base[1] + sign * 0.3 * U];
        const tilt = atTop ? -Math.PI / 2 - 0.8 : Math.PI / 2 + 0.8;
        const nearest = nearestLength(walk, side, atTop);
        out.push({ role: 'shoulder', l: nearest, stitches: MIN_RING + 2, angle: tilt, fixed: true, base: side });
      } else {
        const bases = walk.at(atTop ? 1.75 * U : walk.total - 1.75 * U);
        out.push({ role: 'in', axis: true, l, stitches: 8, angle: axisAngleIn(atTop), base: [0, point[1]], joinNext: 'none' });
        out.push({ role: 'in', notchTwin: true, l: atTop ? 1.75 * U : walk.total - 1.75 * U, stitches: 10, base: [Math.min(bases[0], -1.2 * U), bases[1]], angle: walk.inward(atTop ? 2 * U : walk.total - 2 * U) });
      }
    } else if (style === 'axis-bridge') {
      const inset = 1.7 * U;
      const here = walk.at(atTop ? inset : walk.total - inset);
      const base = [Math.min(here[0], -1.2 * U), here[1]];
      out.push({ role: 'in', notchTwin: true, l: atTop ? inset : walk.total - inset, stitches: 10, base, angle: walk.inward(atTop ? inset : walk.total - inset), besideAxisBridge: true });
    }
    return atTop || style === 'single' ? out : out.reverse().map((ring, i, list) => ({ ...ring, joinNext: i === list.length - 1 ? ring.joinNext : list[i + 1]?.joinNext ?? 'bridge' }));
  };

  const firsts = planEnd(true, topStyle);
  const lasts = planEnd(false, bottomStyle);
  // Going upward the cluster was listed from the axis out, so the link kinds need turning round too.
  if (bottomStyle === 'cluster') {
    lasts.forEach((ring) => { ring.joinNext = 'bridge'; });
    lasts[0].joinNext = 'none';
    lasts[lasts.length - 1].joinNext = 'bridge';
  }
  firsts.forEach(add);

  const startL = firsts[firsts.length - 1].l + (firsts[firsts.length - 1].role === 'tip' ? 0 : 0);
  const endL = lasts[0].l;
  const fixed = corners
    .map((corner) => ({ ...corner, l: walk.lengthOfIndex(corner.i) }))
    .filter((corner) => corner.l > startL + 2.5 * U && corner.l < endL - 2.5 * U);
  const stops = [{ l: startL }, ...fixed, { l: endL }];
  for (let k = 0; k < stops.length; k++) {
    const stop = stops[k];
    if (k > 0 && k < stops.length - 1) {
      if (stop.kind === 'tip') {
        const length = ringLength(tipRing);
        const angle = walk.inward(stop.l, 18) + Math.PI;
        const tip = walk.at(stop.l);
        add({ role: 'tip', l: stop.l, stitches: tipRing, angle, fixed: true, base: [tip[0] + Math.cos(angle + Math.PI) * length * TIP_REACH, tip[1] + Math.sin(angle + Math.PI) * length * TIP_REACH] });
      } else {
        add({ role: 'in', l: stop.l, stitches: 12, angle: walk.inward(stop.l, 18), base: walk.at(stop.l), notch: true });
      }
    }
    if (k === stops.length - 1) break;
    const span = stops[k + 1].l - stop.l;
    const straight = straightness(walk, stop.l, stops[k + 1].l);
    const startsAtCorner = k > 0 || ends.top === 'tip';
    const endsAtCorner = k + 1 < stops.length - 1 || ends.bottom === 'tip';
    const reach = straight < 0.05 && startsAtCorner && endsAtCorner ? Math.max(spacing, 150) : spacing;
    const pieces = Math.max(1, Math.ceil(span / reach));
    for (let piece = 1; piece < pieces; piece++) {
      const l = stop.l + (span * piece) / pieces;
      add({ role: 'in', l, stitches: 12, angle: walk.inward(l), base: walk.at(l) });
    }
  }
  lasts.forEach(add);
  return { rings, topStyle, bottomStyle };
}

function nearestLength(walk, point, atTop) {
  let best = atTop ? 0 : walk.total;
  let bestD = Infinity;
  for (let i = 0; i < walk.points.length; i++) {
    const l = walk.lengths[i];
    if (atTop ? l > walk.total / 2 : l < walk.total / 2) continue;
    const d = dist(walk.points[i], point);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

function straightness(walk, fromL, toL) {
  const a = walk.at(fromL);
  const b = walk.at(toL);
  const chord = dist(a, b) || 1;
  let worst = 0;
  for (let k = 1; k < 10; k++) {
    const p = walk.at(fromL + ((toL - fromL) * k) / 10);
    const off = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / chord;
    worst = Math.max(worst, off);
  }
  return worst / chord;
}

/* ---------- ring sizes, so neighbours can join ---------- */

// Which rings ought to join. A must join; may is taken if the two happen to reach.
function linksOf(half) {
  const { rings } = half;
  const links = [];
  const inner = rings.filter((r) => r.role === 'in');
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i];
    const b = inner[i + 1];
    const between = rings.slice(rings.indexOf(a) + 1, rings.indexOf(b));
    links.push({ a, b, must: false, want: true, close: between.length === 0 });
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    if (a.role !== 'in' || b.role !== 'in') links.push({ a, b, must: a.joinNext === 'none', want: a.joinNext === 'none' });
  }
  [rings[0], rings[rings.length - 1]].forEach((r, index) => {
    if (r.axis) return;
    links.push({ a: r, b: r, across: true, must: r.besideAxisBridge === true, want: true, atTop: index === 0 });
  });
  const nearAxis = (r) => r.role === 'in' && !r.axis;
  if (rings[0].axis && rings[0].role === 'tip' && nearAxis(rings[rings[0].joinNext === 'none' ? 2 : 1] ?? {})) {
    const r = rings[rings[0].joinNext === 'none' ? 2 : 1];
    links.push({ a: r, b: r, across: true, must: false, want: true });
  }
  const end = rings[rings.length - 1];
  if (end.axis && end.role === 'tip') {
    const before = rings[rings.length - 2];
    const r = before?.role === 'shoulder' ? rings[rings.length - 3] : before;
    if (r && nearAxis(r)) links.push({ a: r, b: r, across: true, must: false, want: true });
  }
  return links;
}

function linkGap(link) {
  return pairGap(worldRing(link.a), worldRing(link.b, link.across === true));
}

function tipLeavesShape(ring, walk) {
  if (ring.role !== 'in') return 0;
  const { tip } = worldRing(ring);
  let penalty = insideOutline(tip, walk.closed) ? 0 : 6;
  if (!ring.axis && tip[0] > -0.4 * U) penalty += ((tip[0] + 0.4 * U) / U) ** 2 * 4;
  return penalty;
}

// Rings that merely touch cost a little; one running inside the other costs a lot.
function apartCost(a, b) {
  const { clear } = pairGap(a, b);
  if (clear > CLEAR + 1) return 0;
  const inside = a.outline.some((p) => insideOutline(p, b.outline)) || b.outline.some((p) => insideOutline(p, a.outline));
  return clearPenalty(clear) + (inside ? 25 : 0);
}

function clearPenalty(clear) {
  return clear < CLEAR ? 30 * ((CLEAR - clear) / U) ** 2 : 0;
}

// Where the bridges really run, both sides. Bridges don't move when rings turn or grow.
function arcsOf(half, walk) {
  const { rings } = half;
  const arcs = [];
  for (let i = 0; i < rings.length - 1; i++) {
    if (rings[i].joinNext === 'none') continue;
    const shape = makeBridge(walk, rings[i], rings[i + 1]);
    if (!shape) continue;
    const from = rings[i].base;
    const to = rings[i + 1].base;
    const chord = dist(from, to) || 1;
    const control = [(from[0] + to[0]) / 2 + ((to[1] - from[1]) / chord) * shape.bulge, (from[1] + to[1]) / 2 - ((to[0] - from[0]) / chord) * shape.bulge];
    const points = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const a = (1 - t) ** 2;
      const b = 2 * (1 - t) * t;
      const c = t ** 2;
      points.push([a * from[0] + b * control[0] + c * to[0], a * from[1] + b * control[1] + c * to[1]]);
    }
    arcs.push({ points, ends: [rings[i], rings[i + 1]] });
    arcs.push({ points: points.map(([x, y]) => [-x, y]), ends: rings[i].axis ? [rings[i]] : rings[i + 1].axis ? [rings[i + 1]] : [] });
  }
  return arcs;
}

// Everything about this one ring that its size and turn can change.
function ringCost(ring, half, links, arcs, walk) {
  const world = worldRing(ring);
  let cost = tipLeavesShape(ring, walk) + ring.stitches * 0.004;
  links.forEach((link) => {
    if (!link.want || (link.a !== ring && link.b !== ring)) return;
    const { reach } = linkGap(link);
    const weight = link.must ? 8 : link.close ? 4 : 1;
    if (reach > REACH) cost += weight * ((reach - REACH) / U) ** 2;
  });
  half.rings.forEach((other) => {
    if (other !== ring) cost += apartCost(world, worldRing(other));
    if (!other.axis) cost += apartCost(world, worldRing(other, true));
  });
  arcs.forEach((arc) => {
    const own = arc.ends.includes(ring);
    arc.points.forEach((p) => {
      if (own && dist(p, ring.base) < 1.7 * U) return;
      if (dist(p, world.middle) > world.span + U) return;
      if (insideOutline(p, world.outline)) cost += 12;
      world.outline.forEach((q) => {
        const d = dist(p, q);
        if (d < 0.6 * U) cost += 1.5 * ((0.6 * U - d) / U) ** 2;
      });
    });
  });
  return cost;
}

// Grows and turns the inward rings until neighbours can reach each other without touching.
function settleRings(half, walk) {
  fitTipBases(half, walk);
  const links = linksOf(half);
  const arcs = arcsOf(half, walk);
  const movable = half.rings.filter((r) => !r.fixed);
  movable.forEach((r) => {
    r.home = r.angle;
    r.stitches = Math.min(r.stitches, 10);
  });
  const turn = 8 * (Math.PI / 180);
  for (let sweep = 0; sweep < 14; sweep++) {
    let improved = false;
    for (const ring of movable) {
      const stitches = ring.stitches;
      const angle = ring.angle;
      let best = ringCost(ring, half, links, arcs, walk);
      let pick = null;
      const options = [{ stitches: stitches + 2 }, { stitches: stitches - 2 }, { stitches: stitches + 4 }, { stitches: stitches - 4 }];
      if (!ring.axis) options.push({ angle: angle + turn }, { angle: angle - turn }, { angle: angle + turn, stitches: stitches + 2 }, { angle: angle - turn, stitches: stitches + 2 }, { angle: angle + turn, stitches: stitches - 2 }, { angle: angle - turn, stitches: stitches - 2 });
      for (const option of options) {
        const s = option.stitches ?? stitches;
        const a = option.angle ?? angle;
        if (s < MIN_RING + 2 || s > MAX_RING || Math.abs(a - ring.home) > (ring.notch ? 1.25 : 0.75)) continue;
        ring.stitches = s;
        ring.angle = a;
        const cost = ringCost(ring, half, links, arcs, walk);
        if (cost < best - 1e-6) {
          best = cost;
          pick = option;
        }
      }
      ring.stitches = pick?.stitches ?? stitches;
      ring.angle = pick?.angle ?? angle;
      if (pick) improved = true;
    }
    if (!improved) break;
  }
  // A join is not worth an overlap: anything still in the way turns aside, then shrinks, giving up the join if it must.
  const inTheWay = (ring) => {
    const world = worldRing(ring);
    const touching = half.rings.some((other) => (other !== ring && apartCost(world, worldRing(other)) > 1) || (!other.axis && apartCost(world, worldRing(other, true)) > 1));
    const crossed = arcs.some((arc) => arc.points.some((p) => {
      if (arc.ends.includes(ring) && dist(p, ring.base) < 1.7 * U) return false;
      return insideOutline(p, world.outline) || world.outline.some((q) => dist(p, q) < 0.35 * U);
    }));
    return touching || crossed;
  };
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    movable.forEach((ring) => {
      if (!inTheWay(ring)) return;
      changed = true;
      const angle = ring.angle;
      const free = ring.axis ? null : [0.28, -0.28, 0.56, -0.56, 0.84, -0.84].find((turnBy) => {
        ring.angle = angle + turnBy;
        return !inTheWay(ring);
      });
      if (free !== null && free !== undefined) {
        ring.angle = angle + free;
        return;
      }
      ring.angle = angle;
      if (ring.stitches > MIN_RING) ring.stitches -= 2;
    });
    if (!changed) break;
  }
  return links;
}

/* ---------- bridges ---------- */

let arcTable = null;
function bulgeFor(chord, arc) {
  if (arcTable === null) {
    arcTable = [];
    for (let i = 0; i <= 400; i++) {
      const b = i * 0.02;
      let total = 0;
      let px = 0;
      let py = 0;
      for (let k = 1; k <= 64; k++) {
        const t = k / 64;
        const y = 2 * (1 - t) * t * b;
        total += Math.hypot(t - px, y - py);
        px = t;
        py = y;
      }
      arcTable.push(total);
    }
  }
  const ratio = arc / Math.max(chord, 1e-6);
  if (ratio <= 1) return 0;
  for (let i = 1; i < arcTable.length; i++) {
    if (arcTable[i] >= ratio) return (i - 1 + (ratio - arcTable[i - 1]) / (arcTable[i] - arcTable[i - 1])) * 0.02 * chord;
  }
  return 8 * chord;
}

const stretchLength = (walk, fromL, toL) => {
  let total = 0;
  let last = walk.at(fromL);
  for (let k = 1; k <= 16; k++) {
    const p = walk.at(fromL + ((toL - fromL) * k) / 16);
    total += dist(last, p);
    last = p;
  }
  return total;
};

// How far the drawn line runs to the left of the chord, walking from a to b. Left is the bulge's positive side.
function drawnBow(walk, a, b, fromL, toL) {
  const chord = dist(a, b) || 1;
  const left = [(b[1] - a[1]) / chord, -(b[0] - a[0]) / chord];
  let sum = 0;
  for (let k = 3; k <= 7; k++) {
    const p = walk.at(fromL + ((toL - fromL) * k) / 10);
    sum += (p[0] - (a[0] + b[0]) / 2) * left[0] + (p[1] - (a[1] + b[1]) / 2) * left[1];
  }
  return sum / 5 / chord;
}

function axisAngle(from, to, bulge, base, ringAngle) {
  const chord = dist(from, to) || 1;
  const control = [(from[0] + to[0]) / 2 + ((to[1] - from[1]) / chord) * bulge, (from[1] + to[1]) / 2 - ((to[0] - from[0]) / chord) * bulge];
  const dx = control[0] - base[0];
  const dy = control[1] - base[1];
  const cos = (dx * Math.cos(ringAngle) + dy * Math.sin(ringAngle)) / (Math.hypot(dx, dy) || 1);
  return degrees(Math.acos(Math.max(-1, Math.min(1, cos))));
}

function isStraightRun(walk, a, b) {
  const pointed = (ring) => ring.role === 'tip' || ring.role === 'shoulder';
  // Out of a notch the line stays crisp even where the drawing curves, or the arc fills the notch in.
  if (a.notchTwin || b.notchTwin) return !a.axis && !b.axis;
  if (a.axis || b.axis || !(pointed(a) || pointed(b))) return false;
  return Math.abs(drawnBow(walk, walk.at(a.l), walk.at(b.l), a.l, b.l)) < 0.025;
}

// Slides each tip ring a little, so its straight bridges come out a whole number of stitches long.
function fitTipBases(half, walk) {
  const { rings } = half;
  rings.forEach((ring, i) => {
    if ((ring.role !== 'tip' && ring.role !== 'shoulder') || ring.axis) return;
    const before = i > 0 && rings[i - 1].joinNext !== 'none' && isStraightRun(walk, rings[i - 1], ring) ? rings[i - 1] : null;
    const after = i < rings.length - 1 && ring.joinNext !== 'none' && isStraightRun(walk, ring, rings[i + 1]) ? rings[i + 1] : null;
    const target = (other) => Math.max(2, Math.round(dist(other.base, ring.base) / NEAR_STRAIGHT / U)) * U * NEAR_STRAIGHT;
    if (before && after) {
      const r0 = target(before);
      const r1 = target(after);
      const d = dist(before.base, after.base);
      const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
      const h2 = r0 * r0 - a * a;
      if (h2 <= 0) return;
      const ux = (after.base[0] - before.base[0]) / d;
      const uy = (after.base[1] - before.base[1]) / d;
      const mx = before.base[0] + a * ux;
      const my = before.base[1] + a * uy;
      const h = Math.sqrt(h2);
      const options = [[mx - uy * h, my + ux * h], [mx + uy * h, my - ux * h]];
      const best = options.reduce((p, q) => (dist(p, ring.base) < dist(q, ring.base) ? p : q));
      if (dist(best, ring.base) < 1.2 * U) ring.base = best;
    } else if (before || after) {
      const other = before ?? after;
      const d = dist(other.base, ring.base) || 1;
      const r = target(other);
      ring.base = [other.base[0] + ((ring.base[0] - other.base[0]) / d) * r, other.base[1] + ((ring.base[1] - other.base[1]) / d) * r];
    }
  });
}

// One bridge between two rings: the stitch count follows the outline, the arc follows the stitch count.
function makeBridge(walk, a, b) {
  const from = a.base;
  const to = b.base;
  const chord = dist(from, to);
  if (chord < U) return null;
  // A tip ring's base sits back from the corner, so the drawn line is measured from the corner itself.
  const anchorA = walk.at(a.l);
  const anchorB = walk.at(b.l);
  const drawn = stretchLength(walk, a.l, b.l);
  const bow = drawnBow(walk, anchorA, anchorB, a.l, b.l);
  let side = Math.sign(bow);
  // A straight run bends away from the corners it joins, which is also how a chain lies between them.
  const sharp = (ring) => ring.role === 'tip' || ring.role === 'shoulder' || ring.notch || ring.notchTwin;
  if (Math.abs(bow) < 0.025) side = sharp(a) && sharp(b) ? 1 : -1;
  const wantArc = Math.max(chord / 0.96, Math.min(drawn * (chord / (dist(anchorA, anchorB) || chord)), chord * 1.14));
  // A straight line to a corner stays nearly straight: a full arc from both sides of a sharp tip would cross.
  if (isStraightRun(walk, a, b)) {
    const stitches = Math.max(2, Math.round(chord / NEAR_STRAIGHT / U));
    if (stitches * U * 0.9 <= chord && stitches * U >= chord * 1.004) return { stitches, bulge: round1(side * bulgeFor(chord, stitches * U)) };
  }
  const least = Math.max(2, Math.ceil(wantArc / U));
  const axisRing = a.axis ? a : b.axis ? b : null;
  for (let extra = 0; extra <= 8; extra++) {
    const stitches = least + extra;
    if (chord < 0.5 * stitches * U) break;
    const size = bulgeFor(chord, stitches * U);
    for (const sign of axisRing ? [side, -side] : [side]) {
      const bulge = round1(sign * size);
      if (!axisRing) return { stitches, bulge };
      const angle = axisAngle(from, to, bulge, axisRing.base, axisRing.angle);
      if (angle >= AXIS_MIN && angle <= AXIS_MAX) return { stitches, bulge };
    }
  }
  return null;
}

/* ---------- from a plan to a pattern ---------- */

const NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nameOf = (i) => (i < 26 ? NAMES[i] : `${NAMES[Math.floor(i / 26) - 1]}${NAMES[i % 26]}`);

function roundedRing(ring) {
  const length = ringLength(ring.stitches);
  const base = [round1(ring.base[0]), round1(ring.base[1])];
  const tip = [round1(ring.base[0] + Math.cos(ring.angle) * length), round1(ring.base[1] + Math.sin(ring.angle) * length)];
  if (ring.axis) {
    base[0] = 0;
    tip[0] = 0;
  }
  return { base, tip, width: round1(length * RING_SHAPE), dir: 'cw' };
}

function buildPattern(half, links, walk, title) {
  const { rings } = half;
  // Working order: top element, left rings going down, bottom element, right rings going up.
  const order = [];
  rings.forEach((ring, i) => {
    order.push({ ring, mirrored: false, group: `r${i}` });
    if (i < rings.length - 1) order.push(ring.joinNext === 'none' ? null : { bridgeFrom: i, mirrored: false, group: `b${i}` });
  });
  const leftRings = order.filter(Boolean);
  const hasTop = rings[0].axis;
  const hasBottom = rings[rings.length - 1].axis;
  const all = [];
  if (!hasTop) all.push({ axisBridge: true, atTop: true, group: 'top' });
  leftRings.forEach((e) => all.push(e));
  if (!hasBottom) all.push({ axisBridge: true, atTop: false, group: 'bottom' });
  [...rings].reverse().forEach((ring, reversedIndex) => {
    const i = rings.length - 1 - reversedIndex;
    if (ring.axis) {
      if (i < rings.length - 1 && rings[i].joinNext !== 'none') all.push({ bridgeFrom: i, mirrored: true, group: `b${i}` });
      return;
    }
    if (i < rings.length - 1 && rings[i].joinNext !== 'none') all.push({ bridgeFrom: i, mirrored: true, group: `b${i}` });
    all.push({ ring, mirrored: true, group: `r${i}` });
  });
  all.forEach((entry, i) => { entry.id = nameOf(i); });

  const entryOf = (ring, mirrored) => all.find((e) => e.ring === ring && (ring.axis || e.mirrored === mirrored));

  // Every ear is a stitch position; each link spends one on each of its two rings.
  const earsOn = new Map();
  const taken = (entry) => {
    if (!earsOn.has(entry)) earsOn.set(entry, []);
    return earsOn.get(entry);
  };
  const free = (entry, at) => taken(entry).every((ear) => Math.abs(ear.at - at) >= 2);
  const spots = (world, entry) => world.ears.filter((e) => free(entry, e.at));
  const joined = [];
  const unjoined = [];
  let looseNeighbours = 0;
  let earCount = 0;
  const addLink = (a, mirroredA, b, mirroredB) => {
    const ea = entryOf(a, mirroredA);
    const eb = entryOf(b, mirroredB);
    if (!ea || !eb) return false;
    if (ea === eb) return false;
    const wa = worldRing(a, mirroredA);
    const wb = worldRing(b, mirroredB);
    let best = null;
    spots(wa, ea).forEach((p) => spots(wb, eb).forEach((q) => {
      const d = dist(p.point, q.point);
      if (!best || d < best.d) best = { d, atA: p.at, atB: q.at };
    }));
    if (!best || best.d > 1.35 * U) return false;
    earCount += 1;
    const [first, second, atFirst, atSecond] = all.indexOf(ea) < all.indexOf(eb) ? [ea, eb, best.atA, best.atB] : [eb, ea, best.atB, best.atA];
    const name = `e${earCount}`;
    taken(first).push({ at: atFirst, token: `p:${name}` });
    taken(second).push({ at: atSecond, token: `j:${first.id}.${name}` });
    joined.push([first.id, second.id]);
    return true;
  };
  for (const link of links) {
    if (!link.want) continue;
    let ok;
    if (link.across) {
      ok = addLink(link.a, false, link.a, true);
    } else {
      ok = addLink(link.a, false, link.b, false);
      if (ok && !(link.a.axis && link.b.axis)) {
        // The other side gets the same join; rings on the axis are one ring, so they hold a second ear.
        const mirrorOk = addLink(link.a, true, link.b, true);
        if (!mirrorOk) return { failed: `对称那一侧的 ${entryOf(link.a, true)?.id ?? ''} 接不上` };
      }
    }
    if (!ok && link.must) return { failed: '相邻的环够不着' };
    if (!ok) unjoined.push(link);
    if (!ok && link.close) looseNeighbours += 1;
  }

  const placeOf = (entry) => {
    if (entry.ring) {
      const place = roundedRing(entry.ring);
      return entry.mirrored && !entry.ring.axis ? { base: [round1(-place.base[0]), place.base[1]], tip: [round1(-place.tip[0]), place.tip[1]], width: place.width, dir: 'cw' } : place;
    }
    return null;
  };
  const elements = [];
  const bridgeShapes = new Map();
  for (const entry of all) {
    if (entry.ring) continue;
    const key = entry.axisBridge ? entry.group : entry.bridgeFrom;
    if (bridgeShapes.has(key)) continue;
    if (entry.axisBridge) {
      const ring = entry.atTop ? rings[0] : rings[rings.length - 1];
      const chord = Math.abs(ring.base[0]) * 2;
      const stitches = Math.max(2, Math.ceil(chord / 0.96 / U));
      const size = bulgeFor(chord, stitches * U);
      bridgeShapes.set(key, { stitches, size });
    } else {
      const shape = makeBridge(walk, rings[entry.bridgeFrom], rings[entry.bridgeFrom + 1]);
      if (!shape) return { failed: '有一段桥太短或拐得太急' };
      bridgeShapes.set(key, shape);
    }
  }
  let previousSide = null;
  all.forEach((entry, index) => {
    if (entry.ring) {
      const place = placeOf(entry);
      const stitches = entry.ring.stitches;
      const ears = [...taken(entry)].sort((p, q) => p.at - q.at);
      const parts = [];
      let at = 0;
      ears.forEach((ear) => {
        parts.push(String(ear.at - at), ear.token);
        at = ear.at;
      });
      parts.push(String(stitches - at));
      const element = { id: entry.id, type: 'ring', group: entry.group, parts, place };
      const side = entry.ring.role === 'in' ? 'in' : 'out';
      const afterBridge = index > 0 && !all[index - 1].ring;
      // A ring on the same side as the last one needs a flip after the bridge; the other side needs none.
      if (afterBridge) element.flip = { value: side === previousSide, source: 'source' };
      previousSide = side;
      elements.push(element);
    } else {
      const shape = bridgeShapes.get(entry.axisBridge ? entry.group : entry.bridgeFrom);
      const before = all[(index - 1 + all.length) % all.length];
      const after = all[(index + 1) % all.length];
      const from = placeOf(before).base;
      const to = placeOf(after).base;
      let bulge;
      if (entry.axisBridge) {
        // An axis bridge dips into the shape.
        const inwardSign = (to[0] - from[0]) * (entry.atTop ? 1 : -1) > 0 ? -1 : 1;
        bulge = round1(inwardSign * shape.size);
      } else {
        ({ bulge } = shape);
      }
      elements.push({ id: entry.id, type: 'bridge', group: entry.group, flip: { value: true, source: 'source' }, parts: [String(shape.stitches)], place: { from: [...from], to: [...to], bulge } });
    }
  });

  const places = elements.flatMap((element) => {
    const geometry = elementGeometry(element);
    return Array.from({ length: 81 }, (_, i) => geometry.pointAt(i / 80));
  });
  const halfWidth = Math.max(...places.map((p) => Math.abs(p.x)));
  const minY = Math.min(...places.map((p) => p.y));
  const maxY = Math.max(...places.map((p) => p.y));
  const margin = 35 + 0.12 * Math.max(halfWidth * 2, maxY - minY);
  const side = Math.ceil(halfWidth + margin);
  const top = Math.floor(minY - margin);
  const stitchTotal = elements.reduce((sum, e) => sum + e.parts.filter((p) => /^\d+$/.test(p)).reduce((a, b) => a + Number(b), 0), 0);
  const ringCount = elements.filter((e) => e.type === 'ring').length;
  const bridgeCount = elements.length - ringCount;
  const firstIsRing = elements[0].type === 'ring';
  if (!firstIsRing) return { failed: '起点不是环' };
  const lastBridgeFlip = elements[elements.length - 1].type === 'bridge';
  return {
    pattern: {
      schema: 2,
      id: 'traced',
      title,
      craft: '梭编',
      difficulty: stitchTotal <= 170 ? '入门' : stitchTotal <= 260 ? '进阶' : '熟手',
      tier: 'sorted',
      rights: { kind: 'original', note: '手绘草图设计' },
      summary: `${ringCount} 个环、${bridgeCount} 段桥，沿草图的轮廓走，左右对称。`,
      threadNote: '1 个梭子 + 1 团线，不剪线。图上有“翻”的地方翻面，没有的地方不翻。环和桥之间只留极短的线。',
      layout: { viewBox: [-side, top, side * 2, Math.ceil(maxY + margin) - top], closed: true },
      elements,
      finish: lastBridgeFlip ? `最后一段桥编完后，把两股线拉到 ${elements[0].id} 环的底部，和起头的线尾打结，藏好线尾` : `最后一个环编完后，把线拉到 ${elements[0].id} 环的底部，和起头的线尾打结，藏好线尾`,
    },
    unjoined: unjoined.length,
    looseNeighbours,
    stitches: stitchTotal,
    rings: ringCount,
    bridges: bridgeCount,
  };
}

/* ---------- how much it looks like the drawing ---------- */

const LIKE_GRID = 120;

function chartShape(pattern, size) {
  const ink = new Uint8Array(LIKE_GRID * LIKE_GRID);
  const toCell = (v) => ((v / size) + 0.6) * (LIKE_GRID / 1.2);
  pattern.elements.forEach((element) => {
    const geometry = elementGeometry(element);
    const steps = element.type === 'ring' ? 60 : 40;
    for (let k = 0; k <= steps; k++) {
      const p = geometry.pointAt(k / steps);
      const x = Math.round(toCell(p.x));
      const y = Math.round(toCell(p.y));
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < LIKE_GRID && cy < LIKE_GRID) ink[cy * LIKE_GRID + cx] = 1;
      }
    }
  });
  return fillEnclosed(ink, LIKE_GRID);
}

function likeness(sketch, chart) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < sketch.length; i++) {
    if (sketch[i] && chart[i]) both += 1;
    if (sketch[i] || chart[i]) either += 1;
  }
  return both / (either || 1);
}

// How far the chart's edge strays from the drawn line, as a share of the shape's size: on average, at the worst
// tenth, and at the corners, which are what make a shape recognisable.
function edgeError(pathPoints, cornerPoints, chart) {
  const edge = chart.map((v, i) => {
    if (!v) return 0;
    const x = i % LIKE_GRID;
    return x === 0 || x === LIKE_GRID - 1 || !chart[i - 1] || !chart[i + 1] || !chart[i - LIKE_GRID] || !chart[i + LIKE_GRID] ? 1 : 0;
  });
  const field = distanceField(edge, LIKE_GRID, true);
  const at = ([x, y]) => {
    const cx = Math.max(0, Math.min(LIKE_GRID - 1, Math.round((x + 0.6) * (LIKE_GRID / 1.2))));
    const cy = Math.max(0, Math.min(LIKE_GRID - 1, Math.round((y + 0.6) * (LIKE_GRID / 1.2))));
    return (field[cy * LIKE_GRID + cx] * 1.2) / LIKE_GRID;
  };
  const all = pathPoints.map(at).sort((a, b) => a - b);
  const mean = all.reduce((sum, d) => sum + d, 0) / all.length;
  const worst = all[Math.floor(all.length * 0.9)];
  const corner = cornerPoints.length ? Math.max(...cornerPoints.map(at)) : 0;
  return { mean, worst, corner };
}

function sketchOnLikeGrid(cells, axis, size, middleY) {
  const out = new Uint8Array(LIKE_GRID * LIKE_GRID);
  for (let y = 0; y < LIKE_GRID; y++) {
    for (let x = 0; x < LIKE_GRID; x++) {
      const nx = (x / LIKE_GRID) * 1.2 - 0.6;
      const ny = (y / LIKE_GRID) * 1.2 - 0.6;
      const cx = Math.round(nx * size + axis);
      const cy = Math.round(ny * size + middleY);
      if (cx >= 0 && cy >= 0 && cx < GRID && cy < GRID && cells[cy * GRID + cx]) out[y * LIKE_GRID + x] = 1;
    }
  }
  return out;
}

/* ---------- the whole thing ---------- */

const refuse = (...problems) => ({ pattern: null, problems, report: null });

function endStyles(kind, angle) {
  if (kind === 'round') return ['single'];
  // Past this the bridge can't leave an axis ring at the angle the drawing needs, so small rings take it.
  if (kind === 'tip') return angle > 122 ? ['cluster'] : ['single', 'cluster'];
  return ['single', 'axis-bridge', 'cluster'];
}

// input: { strokes: [[[x, y], ...], ...] } in any units, or { pixels: { width, height, data } } with 1 for ink.
export function traceDesign(input, { title = '手绘花片', mirror = false } = {}) {
  let ink = null;
  if (Array.isArray(input?.strokes) && input.strokes.flat().length >= 8) ink = strokesToInk(input.strokes, 1.4);
  else if (input?.pixels) ink = pixelsToInk(input.pixels);
  if (!ink) return refuse('草图是空的，或者线太短，先画一个完整的形状。');
  const cells = solidShape(ink);
  if (!cells) return refuse('线没有围成一个封闭的形状。请把缺口接上，再试一次。');
  const { axis, error } = findAxis(cells);
  if (error > MAX_MIRROR_ERROR && !mirror) {
    return refuse(`草图左右差得比较多（约 ${Math.round(error * 100)}%）。梭编图解现在只做左右对称的花样，请打开“对称”开关，会按左半边来做。`);
  }
  const shape = mirrorLeft(cells, axis);
  const piece = largestPiece(shape, GRID);
  const path = leftPath(piece.cells, axis);
  if (!path) return refuse('左右两半没有连在一起，做不成一整片。请让形状跨过中线。');
  const corners = findCorners(path.points);
  if (corners.length > MAX_CORNERS) return refuse(`这个形状有 ${corners.length} 个尖角，半边放不下这么多环。请把形状画简单一点。`);
  const topEnd = axisEnd(path.points, true);
  const bottomEnd = axisEnd(path.points, false);
  const ends = { top: topEnd.kind, bottom: bottomEnd.kind };
  const sketch = sketchOnLikeGrid(piece.cells, axis, path.size, path.middleY);
  const cornerPoints = [path.points[0], path.points[path.points.length - 1], ...corners.map((c) => path.points[c.i])];

  const candidates = [];
  const seen = new Set();
  const reasons = new Map();
  const note = (reason) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  for (const size of SIZES) {
    const walk = new Walk(path.points, size);
    for (const spacing of SPACINGS) {
      for (const tipRing of TIP_RINGS) {
        for (const topStyle of endStyles(topEnd.kind, topEnd.angle)) {
          for (const bottomStyle of endStyles(bottomEnd.kind, bottomEnd.angle)) {
            // The work has to begin with a ring.
            if (topStyle === 'axis-bridge' && bottomStyle === 'axis-bridge') continue;
            if (topStyle === 'axis-bridge') continue;
            const half = planHalf(walk, corners, ends, { spacing, tipRing, topStyle, bottomStyle });
            if (half.rings.length < 2) continue;
            const links = settleRings(half, walk);
            const built = buildPattern(half, links, walk, title);
            if (built.failed) {
              note(built.failed);
              continue;
            }
            if (built.stitches > MAX_STITCHES) {
              note('stitches');
              continue;
            }
            const signature = JSON.stringify(built.pattern.elements);
            if (seen.has(signature)) continue;
            seen.add(signature);
            const chart = chartShape(built.pattern, size);
            const like = likeness(sketch, chart);
            const edge = edgeError(path.points, cornerPoints, chart);
            const quality = like - 7 * edge.mean - 3 * edge.worst - 3 * edge.corner;
            candidates.push({ ...built, like, edge, size, spacing, tipRing, topStyle, bottomStyle, quality, effort: built.stitches + built.unjoined * 16 + built.looseNeighbours * 24 });
          }
        }
      }
    }
  }
  // Among those about as like the drawing as the best one, the least work comes first.
  const bestQuality = Math.max(...candidates.filter((c) => c.like >= MIN_LIKENESS).map((c) => c.quality), -Infinity);
  const closeEnough = (c) => c.quality >= bestQuality - QUALITY_MARGIN;
  candidates.sort((p, q) => (closeEnough(q) - closeEnough(p)) || (closeEnough(p) ? p.effort - q.effort : q.quality - p.quality));
  let tested = 0;
  for (const candidate of candidates) {
    if (candidate.like < MIN_LIKENESS) continue;
    tested += 1;
    const problems = layoutProblems(candidate.pattern);
    problems.forEach(note);
    if (problems.length) continue;
    const failing = [...structureProblems(candidate.pattern), ...checkPattern(candidate.pattern).filter((c) => !c.ok).map((c) => c.detail)];
    if (failing.length) {
      failing.forEach(note);
      continue;
    }
    return {
      pattern: candidate.pattern,
      problems: [],
      report: {
        rings: candidate.rings,
        bridges: candidate.bridges,
        stitches: candidate.stitches,
        likeness: Math.round(candidate.like * 100) / 100,
        unjoined: candidate.unjoined,
        looseNeighbours: candidate.looseNeighbours,
        edge: Object.fromEntries(Object.entries(candidate.edge).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
        corners: corners.length,
        ends,
        mirrorError: Math.round(error * 100) / 100,
        size: candidate.size,
        spacing: candidate.spacing,
        tipRing: candidate.tipRing,
        topStyle: candidate.topStyle,
        bottomStyle: candidate.bottomStyle,
        tested,
      },
    };
  }
  const best = [...candidates].sort((p, q) => q.like - p.like)[0];
  if (!best) return refuse('这个形状的细节太密，环和桥放不进去。请把形状画大一些、简单一些。', ...topReasons(reasons));
  if (best.like < MIN_LIKENESS) return refuse(`能编的版本和草图不够像（只有约 ${Math.round(best.like * 100)}%），这里不给出错的图。请把形状画简单一些，尖角少一点。`);
  return refuse('试过的摆法都有环重叠、桥交叉或接耳够不着，这个形状现在编不出来。请把形状画简单一些。', ...topReasons(reasons));
}

function topReasons(reasons) {
  return [...reasons.entries()].filter(([reason]) => reason !== 'stitches').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([reason]) => reason);
}
