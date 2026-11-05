// Draws a chart from pattern data, so the picture and the numbers can't disagree.
import { numberText, readElement } from './pattern.js';

const SAMPLES = 320;
const PICOT_R = 5.5;
const BASE_SCALE = 370;     // marks are designed at this viewBox width
const PICOT_LENGTH = 11;
const PICOT_WIDTH = 6;
const TEARDROP_PEAK = 0.7698; // the largest value of sin(t) * sin(t / 2)

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const n = (value) => value.toFixed(1);

function ringPoints({ base, tip, width, dir }) {
  const dx = tip[0] - base[0];
  const dy = tip[1] - base[1];
  const length = Math.hypot(dx, dy);
  const axis = { x: dx / length, y: dy / length };
  const left = { x: axis.y, y: -axis.x };
  const side = dir === 'cw' ? 1 : -1;
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * 2 * Math.PI;
    const u = (length * (1 - Math.cos(t))) / 2;
    const v = (side * (width / 2) * Math.sin(t) * Math.sin(t / 2)) / TEARDROP_PEAK;
    points.push({ x: base[0] + axis.x * u + left.x * v, y: base[1] + axis.y * u + left.y * v });
  }
  return { points, outSide: side };
}

function bridgePoints({ from, to, bulge }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const left = { x: dy / length, y: -dx / length };
  const control = { x: (from[0] + to[0]) / 2 + left.x * bulge, y: (from[1] + to[1]) / 2 + left.y * bulge };
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const a = (1 - t) ** 2;
    const b = 2 * (1 - t) * t;
    const c = t ** 2;
    points.push({ x: a * from[0] + b * control.x + c * to[0], y: a * from[1] + b * control.y + c * to[1] });
  }
  return { points, outSide: bulge < 0 ? -1 : 1 };
}

// The element's line, walked in working order. out is its outside, along its direction of travel.
export function elementGeometry(element) {
  const { points, outSide } = element.type === 'ring' ? ringPoints(element.place) : bridgePoints(element.place);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const length = lengths[lengths.length - 1];

  function pointAt(fraction) {
    const target = Math.min(Math.max(fraction, 0), 1) * length;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < target) i++;
    const p0 = points[i - 1];
    const p1 = points[i];
    const span = lengths[i] - lengths[i - 1] || 1;
    const f = (target - lengths[i - 1]) / span;
    const along = { x: (p1.x - p0.x) / span, y: (p1.y - p0.y) / span };
    return {
      x: p0.x + (p1.x - p0.x) * f,
      y: p0.y + (p1.y - p0.y) * f,
      along,
      out: { x: outSide * along.y, y: -outSide * along.x },
    };
  }

  function subPath(from, to) {
    const start = pointAt(from);
    const end = pointAt(to);
    const parts = [`M${n(start.x)} ${n(start.y)}`];
    points.forEach((p, i) => {
      const f = lengths[i] / length;
      if (f > from && f < to) parts.push(`L${n(p.x)} ${n(p.y)}`);
    });
    parts.push(`L${n(end.x)} ${n(end.y)}`);
    return parts.join('');
  }

  return { length, pointAt, subPath };
}

// A view framing these elements, keeping marks readable around them.
export function focusBox(pattern, ids, padding = 34) {
  const points = pattern.elements.filter((e) => ids.includes(e.id)).flatMap((element) => {
    const geometry = elementGeometry(element);
    return Array.from({ length: 41 }, (_, i) => geometry.pointAt(i / 40));
  });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return [minX, minY, Math.max(...xs) + padding - minX, Math.max(...ys) + padding - minY];
}

// Label sizes, in the units marks are designed at. Wider than the ink, so labels keep a little air.
const LABEL_BOXES = {
  count: (text) => ({ w: 7.5 * text.length + 3, h: 13 }),
  flip: () => ({ w: 14, h: 13 }),
  start: () => ({ w: 22, h: 12 }),
};
const LETTER_SMALL = 0.7;
const LINE_CLEARANCE = 1.5;
const OBSTACLE_SPACING = 3;

function boxesOverlap(a, b) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

// Everything already drawn that a label must stay off, as points close enough that no line slips between them.
function chartObstacles(elements, leftPicots, s) {
  const obstacles = [];
  const addPoint = (x, y, owner, r = LINE_CLEARANCE) => obstacles.push({ x, y, owner, r: r * s });
  const addSegment = (a, b) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (OBSTACLE_SPACING * s)));
    for (let i = 0; i <= steps; i++) addPoint(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, null);
  };
  elements.forEach((element) => {
    const { geometry } = element;
    const steps = Math.max(8, Math.ceil(geometry.length / (OBSTACLE_SPACING * s)));
    for (let i = 0; i <= steps; i++) {
      const p = geometry.pointAt(i / steps);
      addPoint(p.x, p.y, element.id);
    }
    element.items.forEach((item) => {
      if (item.kind === 'stitch') return;
      const p = geometry.pointAt(item.from / element.stitches);
      if (item.kind === 'deco') {
        [4, 8, 11].forEach((out) => addPoint(p.x + p.out.x * out * s, p.y + p.out.y * out * s, null, 3.5));
        return;
      }
      const cx = p.x + p.out.x * PICOT_R * s;
      const cy = p.y + p.out.y * PICOT_R * s;
      addPoint(cx, cy, null, 3.5);
      const target = item.kind === 'join' ? leftPicots.get(`${item.element}.${item.name}`) : null;
      if (target) addSegment({ x: cx, y: cy }, target);
    });
  });
  return obstacles;
}

function pointInOutline(point, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Picks each label's spot: the first candidate touching nothing, or else the one touching least.
// The earlier a candidate is listed, the more it is wanted.
function bestSpot(candidates, box, { obstacles, placed, view, rings, ignoreOwner = null }, owner = null) {
  let best = null;
  for (const candidate of candidates) {
    const area = { x: candidate.x, y: candidate.y, w: box.w, h: box.h };
    let penalty = 0;
    for (const other of placed) if (boxesOverlap(area, other)) penalty += 50;
    for (const o of obstacles) {
      if (o.owner !== null && o.owner === ignoreOwner) continue;
      if (Math.abs(o.x - area.x) * 2 < area.w + o.r * 2 && Math.abs(o.y - area.y) * 2 < area.h + o.r * 2) penalty += 1;
    }
    if (area.x - area.w / 2 < view.minX || area.x + area.w / 2 > view.minX + view.width
      || area.y - area.h / 2 < view.minY || area.y + area.h / 2 > view.minY + view.height) penalty += 25;
    // A number sitting inside a neighbouring ring reads as that ring's number.
    if (rings.some((ring) => ring.id !== owner && pointInOutline(candidate, ring.outline))) penalty += 0.5;
    if (!best || penalty < best.penalty) best = { ...area, penalty };
    if (penalty === 0) break;
  }
  return best;
}

function placeLabel(candidates, box, context, owner = null) {
  const best = bestSpot(candidates, box, context, owner);
  context.placed.push(best);
  return best;
}

// A letter keeps its size if it fits; a small ring gets a small letter inside rather than one elsewhere.
function placeLetter(element, s, context) {
  const box = (scale) => ({ w: (12 * element.id.length + 4) * s * scale, h: 18 * s * scale });
  const inside = letterCandidates(element, s);
  const full = bestSpot(inside, box(1), context, element.id);
  if (full.penalty === 0 || element.type !== 'ring') {
    context.placed.push(full);
    return full;
  }
  const small = bestSpot(inside, box(LETTER_SMALL), context, element.id);
  if (small.penalty === 0) {
    context.placed.push(small);
    return { ...small, small: true };
  }
  const past = bestSpot(letterPastTip(element, s), box(1), context, element.id);
  const chosen = past.penalty <= small.penalty ? past : { ...small, small: true };
  context.placed.push(chosen);
  return chosen;
}

function letterCandidates(element, s) {
  const { geometry, place } = element;
  const list = [];
  if (element.type === 'ring') {
    const tip = geometry.pointAt(0.5);
    const [bx, by] = place.base;
    const axis = { x: tip.x - bx, y: tip.y - by };
    const length = Math.hypot(axis.x, axis.y) || 1;
    const side = { x: axis.y / length, y: -axis.x / length };
    [0.62, 0.5, 0.72, 0.4, 0.8, 0.3].forEach((along) => {
      [0, 7, -7, 13, -13].forEach((across) => {
        list.push({ x: bx + axis.x * along + side.x * across * s, y: by + axis.y * along + side.y * across * s });
      });
    });
    return list;
  }
  [0.5, 0.4, 0.6, 0.3, 0.7].forEach((at) => {
    const p = geometry.pointAt(at);
    [-20, -27, -14, 20, 27, 14, -34, 34].forEach((off) => list.push({ x: p.x + p.out.x * off * s, y: p.y + p.out.y * off * s }));
  });
  return list;
}

// Last resort for a ring too small to hold even a small letter.
function letterPastTip(element, s) {
  const tip = element.geometry.pointAt(0.5);
  const [bx, by] = element.place.base;
  const length = Math.hypot(tip.x - bx, tip.y - by) || 1;
  const ux = (tip.x - bx) / length;
  const uy = (tip.y - by) / length;
  return [15, 22, 30].flatMap((past) => [0, 12, -12].map((across) => ({
    x: tip.x + ux * past * s + uy * across * s,
    y: tip.y + uy * past * s - ux * across * s,
  })));
}

function countCandidates(element, item, s) {
  const { geometry, stitches } = element;
  const list = [];
  [0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95].forEach((at) => {
    const p = geometry.pointAt((item.from + (item.to - item.from) * at) / stitches);
    [13, 18, -13, -18, 9, -9, 24, -24, 30, -30, 37, -37].forEach((off) => list.push({ x: p.x + p.out.x * off * s, y: p.y + p.out.y * off * s }));
  });
  return list;
}

// The flip mark sits on its own cord like a bead, sliding along it to stay clear of everything else.
function flipCandidates(element) {
  const spots = element.type === 'ring'
    ? [0.09, 0.13, 0.17, 0.21, 0.91, 0.87, 0.83, 0.26, 0.74, 0.32, 0.68]
    : [0.14, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86];
  return spots.map((at) => element.geometry.pointAt(at));
}

// Where the arrow showing an element's direction goes. It stays beside its own element, and a ring
// too crowded inside can have it standing just outside the base, pointing in.
function placeArrow(element, elements, s, context) {
  const sharesBase = element.type === 'ring' && elements.some((other) => other !== element
    && other.place?.base?.[0] === element.place.base[0] && other.place?.base?.[1] === element.place.base[1]);
  const sides = sharesBase ? [1, -1] : [-1, 1];
  const candidates = [];
  [0.045, 0.1, 0.16, 0.22].forEach((at) => {
    const p = element.geometry.pointAt(at);
    sides.forEach((side) => [16, 22].forEach((off) => {
      candidates.push({ x: p.x + side * p.out.x * off * s, y: p.y + side * p.out.y * off * s, side, p });
    }));
  });
  if (element.type === 'ring') {
    const [bx, by] = element.place.base;
    const tip = element.geometry.pointAt(0.5);
    const length = Math.hypot(tip.x - bx, tip.y - by) || 1;
    const along = { x: (tip.x - bx) / length, y: (tip.y - by) / length };
    const p = { along, out: { x: along.y, y: -along.x } };
    [18, 26, 34].forEach((back) => {
      candidates.push({ x: bx - along.x * back * s, y: by - along.y * back * s, side: 1, p, outside: true });
    });
  }
  const scored = candidates.map((candidate, index) => {
    let penalty = index * 0.001 + (candidate.outside ? 0.5 : 0);
    for (const other of context.placed) {
      if (boxesOverlap({ x: candidate.x, y: candidate.y, w: 22 * s, h: 22 * s }, other)) penalty += 50;
    }
    for (const o of context.obstacles) {
      const along = (o.x - candidate.x) * candidate.p.along.x + (o.y - candidate.y) * candidate.p.along.y;
      const across = (o.x - candidate.x) * candidate.p.out.x + (o.y - candidate.y) * candidate.p.out.y;
      if (Math.abs(along) < 13 * s + o.r && Math.abs(across) < 6 * s + o.r) penalty += 1;
    }
    return { ...candidate, penalty };
  });
  return scored.reduce((a, b) => (b.penalty < a.penalty ? b : a));
}

// Every label's spot, in order of importance: flip marks, letters, the start, then the numbers on show.
// Numbers come last, so letters stay put whichever numbers are showing.
export function chartLabels(elements, leftPicots, s, view, showsCounts = () => true) {
  const obstacles = chartObstacles(elements, leftPicots, s);
  const placed = [];
  const rings = elements.filter((e) => e.type === 'ring').map((e) => ({
    id: e.id,
    outline: Array.from({ length: 40 }, (_, i) => e.geometry.pointAt(i / 40)),
  }));
  const context = { obstacles, placed, view, rings };
  const labels = { flip: new Map(), letter: new Map(), count: new Map(), arrow: null, start: null };
  const sized = (make, text) => {
    const box = make(text);
    return { w: box.w * s, h: box.h * s };
  };
  elements.filter((e) => e.flip?.value === true).forEach((element) => {
    labels.flip.set(element.id, placeLabel(flipCandidates(element), sized(LABEL_BOXES.flip), { ...context, ignoreOwner: element.id }));
  });
  elements.forEach((element) => {
    labels.letter.set(element.id, placeLetter(element, s, context));
  });
  if (elements.length) {
    const first = elements[0];
    labels.arrow = placeArrow(first, elements, s, context);
    placed.push({ x: labels.arrow.x, y: labels.arrow.y, w: 26 * s, h: 26 * s });
    const { p, side } = labels.arrow;
    const options = [17, 24, -17, -24, 32, -32].flatMap((off) => [0, 12, -12].map((along) => ({
      x: labels.arrow.x + side * p.out.x * off * s + p.along.x * along * s,
      y: labels.arrow.y + side * p.out.y * off * s + p.along.y * along * s,
    })));
    labels.start = placeLabel(options, sized(LABEL_BOXES.start), context);
  }
  // The smallest elements have the least room around them, so their numbers choose first.
  [...elements].filter(showsCounts).sort((a, b) => a.stitches - b.stitches).forEach((element) => {
    element.items.forEach((item, index) => {
      if (item.kind !== 'stitch') return;
      const candidates = countCandidates(element, item, s);
      const box = sized(LABEL_BOXES.count, numberText(item));
      const full = bestSpot(candidates, box, context, element.id);
      // In a crowded spot a smaller number that touches nothing beats a full-size one on a line.
      const small = full.penalty >= 1 ? bestSpot(candidates, { w: box.w * 0.8, h: box.h * 0.8 }, context, element.id) : null;
      const chosen = small && small.penalty < full.penalty ? { ...small, small: true } : full;
      placed.push(chosen);
      labels.count.set(`${element.id}:${index}`, chosen);
    });
  });
  return { ...labels, context };
}

// The parts of a chart renderChart needs for its labels, for pattern data as stored.
export function readChartElements(pattern) {
  return pattern.elements.map((element) => ({
    ...readElement(element),
    place: element.place,
    flip: element.flip,
    geometry: elementGeometry(element),
  }));
}

export function leftPicotSpots(elements, s) {
  const spots = new Map();
  elements.forEach((element) => {
    element.items.filter((i) => i.kind === 'leave').forEach((item) => {
      const p = element.geometry.pointAt(item.from / element.stitches);
      spots.set(`${element.id}.${item.name}`, { x: p.x + p.out.x * PICOT_R * s, y: p.y + p.out.y * PICOT_R * s });
    });
  });
  return spots;
}

// Options, all optional:
//   current      element id drawn solid; others not in done go faint
//   done         element ids drawn full strength, as finished
//   reached      stitches done on current, coloured along its line
//   currentItem  index of the part in progress on current
//   highlight    element ids to emphasise, others faint; current wins over it
//   counts       'all', or element ids that show their numbers; by default, with no
//                current or highlight, the first element of each group (or ungrouped)
//   viewBox      [x, y, width, height] to show instead of the pattern's own
//   title        accessible name
export function renderChart(pattern, options = {}) {
  const {
    current = null, done = [], reached = 0, currentItem = null, highlight = null, counts = null, title = '', viewBox = null,
  } = options;
  const [minX, minY, width, height] = viewBox ?? pattern.layout.viewBox;
  const s = width / BASE_SCALE;
  const elements = readChartElements(pattern);

  const stateClass = (id) => {
    if (current !== null) return id === current || done.includes(id) ? '' : ' is-faint';
    if (highlight) return highlight.includes(id) ? '' : ' is-faint';
    return '';
  };
  const fractionOf = (element, stitches) => stitches / element.stitches;
  const firstOfGroup = new Set();
  const seenGroups = new Set();
  elements.forEach((element) => {
    if (element.group === undefined) firstOfGroup.add(element.id);
    else if (!seenGroups.has(element.group)) {
      seenGroups.add(element.group);
      firstOfGroup.add(element.id);
    }
  });
  const showsCounts = (element) => {
    if (counts === 'all') return true;
    if (Array.isArray(counts)) return counts.includes(element.id);
    return current === null && !highlight && firstOfGroup.has(element.id);
  };

  // Where each join picot was left, for drawing links to it.
  const leftPicots = leftPicotSpots(elements, s);
  const labels = chartLabels(elements, leftPicots, s, { minX, minY, width, height }, showsCounts);

  let cords = '';
  let threads = '';
  let marks = '';
  let links = '';

  elements.forEach((element, index) => {
    const state = stateClass(element.id);
    const { geometry } = element;
    const attrs = `data-el="${element.id}"`;
    const before = elements[index - 1];
    if (element.type === 'ring' && before?.type === 'ring') {
      const [bx, by] = element.place.base;
      const [px, py] = before.place.base;
      if (Math.hypot(bx - px, by - py) > 1) {
        threads += `<line class="thread${state}" ${attrs} x1="${n(px)}" y1="${n(py)}" x2="${n(bx)}" y2="${n(by)}"/>`;
      }
    }

    element.items.filter((i) => i.kind === 'stitch').forEach((item) => {
      const path = geometry.subPath(fractionOf(element, item.from), fractionOf(element, item.to));
      const isCurrent = element.id === current ? ' is-current' : '';
      cords += `<path class="cord${isCurrent}${state}" ${attrs} d="${path}"/>`;
    });

    if (element.id === current && reached > 0) {
      cords += `<path class="cord-reached" ${attrs} d="${geometry.subPath(0, fractionOf(element, reached))}"/>`;
    }

    element.items.forEach((item, itemIndex) => {
      const now = element.id === current && itemIndex === currentItem ? ' now' : '';
      if (item.kind === 'stitch') {
        if (showsCounts(element)) {
          const spot = labels.count.get(`${element.id}:${itemIndex}`);
          marks += `<text class="count${spot.small ? ' small' : ''}${now}${state}" ${attrs} x="${n(spot.x)}" y="${n(spot.y)}">${numberText(item)}</text>`;
        }
        return;
      }

      const p = geometry.pointAt(fractionOf(element, item.from));
      if (item.kind === 'deco') {
        const at = (along, out) => `${n(p.x + p.along.x * along * s + p.out.x * out * s)} ${n(p.y + p.along.y * along * s + p.out.y * out * s)}`;
        const w = PICOT_WIDTH;
        const l = PICOT_LENGTH;
        marks += `<path class="picot deco${now}${state}" ${attrs} d="M${n(p.x)} ${n(p.y)}C${at(w, l * 0.1)} ${at(w * 0.6, l * 0.8)} ${at(0, l)}C${at(-w * 0.6, l * 0.8)} ${at(-w, l * 0.1)} ${n(p.x)} ${n(p.y)}Z"/>`;
        return;
      }
      const cx = p.x + p.out.x * PICOT_R * s;
      const cy = p.y + p.out.y * PICOT_R * s;
      marks += `<circle class="picot join${now}${state}" ${attrs} cx="${n(cx)}" cy="${n(cy)}" r="${n(3 * s)}"/>`;
      if (item.kind === 'join') {
        const target = leftPicots.get(`${item.element}.${item.name}`);
        if (target) {
          links += `<line class="link${state}" ${attrs} x1="${n(cx)}" y1="${n(cy)}" x2="${n(target.x)}" y2="${n(target.y)}"/>`;
        }
      }
    });

    // Letter: inside a ring, on the inner side of a bridge, unless something else is already there.
    const letter = labels.letter.get(element.id);
    marks += `<text class="letter${letter.small ? ' small' : ''}${state}" ${attrs} x="${n(letter.x)}" y="${n(letter.y)}">${element.id}</text>`;

    if (element.flip?.value === true) {
      const { x, y } = labels.flip.get(element.id);
      const w = 14 * s;
      const h = 13 * s;
      marks += `<g class="flip-mark${state}" ${attrs}><rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(3 * s)}"/><text x="${n(x)}" y="${n(y)}">翻</text></g>`;
    }

    // The start of the piece, and the direction of whichever element is being worked.
    if (index === 0 || element.id === current) {
      const arrow = index === 0 ? labels.arrow : placeArrow(element, elements, s, labels.context);
      const { p } = arrow;
      const tipX = arrow.x + p.along.x * 12 * s;
      const tipY = arrow.y + p.along.y * 12 * s;
      const tailX = arrow.x - p.along.x * 12 * s;
      const tailY = arrow.y - p.along.y * 12 * s;
      const wing = (sign) => `${n(tipX - p.along.x * 7 * s + sign * p.out.x * 4.5 * s)} ${n(tipY - p.along.y * 7 * s + sign * p.out.y * 4.5 * s)}`;
      marks += `<path class="start-arrow" d="M${n(tailX)} ${n(tailY)}L${n(tipX)} ${n(tipY)}M${wing(1)}L${n(tipX)} ${n(tipY)}L${wing(-1)}"/>`;
      if (index === 0) {
        marks += `<text class="start-label" x="${n(labels.start.x)}" y="${n(labels.start.y)}">起点</text>`;
      }
    }
  });

  return `<svg class="diagram" viewBox="${minX} ${minY} ${width} ${height}" style="--s:${s}" role="img" aria-label="${escapeXml(title)}">${threads}${cords}${links}${marks}</svg>`;
}
