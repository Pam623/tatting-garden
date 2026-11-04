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
  const elements = pattern.elements.map((element) => ({
    ...readElement(element),
    place: element.place,
    flip: element.flip,
    geometry: elementGeometry(element),
  }));

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
  const leftPicots = new Map();
  elements.forEach((element) => {
    element.items.filter((i) => i.kind === 'leave').forEach((item) => {
      const p = element.geometry.pointAt(fractionOf(element, item.from));
      leftPicots.set(`${element.id}.${item.name}`, { x: p.x + p.out.x * PICOT_R * s, y: p.y + p.out.y * PICOT_R * s });
    });
  });

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
          const mid = geometry.pointAt(fractionOf(element, (item.from + item.to) / 2));
          const offset = 13 * s;
          marks += `<text class="count${now}${state}" ${attrs} x="${n(mid.x + mid.out.x * offset)}" y="${n(mid.y + mid.out.y * offset)}">${numberText(item)}</text>`;
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

    // Letter: inside a ring, on the inner side of a bridge.
    if (element.type === 'ring') {
      const tip = geometry.pointAt(0.5);
      const [bx, by] = element.place.base;
      marks += `<text class="letter${state}" ${attrs} x="${n(bx + (tip.x - bx) * 0.62)}" y="${n(by + (tip.y - by) * 0.62)}">${element.id}</text>`;
    } else {
      const mid = geometry.pointAt(0.5);
      const offset = 20 * s;
      marks += `<text class="letter${state}" ${attrs} x="${n(mid.x - mid.out.x * offset)}" y="${n(mid.y - mid.out.y * offset)}">${element.id}</text>`;
    }

    if (element.flip?.value === true) {
      // Sits on the cord like a bead, so it adds no clutter beside crowded rings.
      const p = geometry.pointAt(element.type === 'ring' ? 0.09 : 0.14);
      const { x, y } = p;
      const w = 14 * s;
      const h = 13 * s;
      marks += `<g class="flip-mark${state}" ${attrs}><rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(3 * s)}"/><text x="${n(x)}" y="${n(y)}">翻</text></g>`;
    }

    // The start of the piece, and the direction of whichever element is being worked.
    if (index === 0 || element.id === current) {
      const p = geometry.pointAt(0.045);
      // Inside the ring, unless another ring shares this base and would collide.
      const sharesBase = element.type === 'ring' && elements.some((other) => other !== element
        && other.place?.base?.[0] === element.place.base[0] && other.place?.base?.[1] === element.place.base[1]);
      const side = sharesBase ? 1 : -1;
      const inX = p.x + side * p.out.x * 16 * s;
      const inY = p.y + side * p.out.y * 16 * s;
      const tipX = inX + p.along.x * 12 * s;
      const tipY = inY + p.along.y * 12 * s;
      const tailX = inX - p.along.x * 12 * s;
      const tailY = inY - p.along.y * 12 * s;
      const wing = (sign) => `${n(tipX - p.along.x * 7 * s + sign * p.out.x * 4.5 * s)} ${n(tipY - p.along.y * 7 * s + sign * p.out.y * 4.5 * s)}`;
      marks += `<path class="start-arrow" d="M${n(tailX)} ${n(tailY)}L${n(tipX)} ${n(tipY)}M${wing(1)}L${n(tipX)} ${n(tipY)}L${wing(-1)}"/>`;
      if (index === 0) {
        marks += `<text class="start-label" x="${n(inX + side * p.out.x * 17 * s)}" y="${n(inY + side * p.out.y * 17 * s)}">起点</text>`;
      }
    }
  });

  return `<svg class="diagram" viewBox="${minX} ${minY} ${width} ${height}" style="--s:${s}" role="img" aria-label="${escapeXml(title)}">${threads}${cords}${links}${marks}</svg>`;
}
