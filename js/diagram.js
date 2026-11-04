// Draws a chart from pattern data, so the picture and the numbers can't disagree.
import { readElement } from './pattern.js';

const LENGTH = 142;      // ring from base to tip
const WIDTH = 118;       // ring width factor
const BASE_RADIUS = 10;  // gap from flower centre to each ring's base
const SAMPLES = 320;
const PICOT_R = 5.5;

// Walks a teardrop clockwise: out along its left side, round the tip, back to the base.
function ringOutline(angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const axis = { x: Math.cos(a), y: Math.sin(a) };
  const left = { x: axis.y, y: -axis.x };
  const base = { x: axis.x * BASE_RADIUS, y: axis.y * BASE_RADIUS };
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * 2 * Math.PI;
    const u = (LENGTH * (1 - Math.cos(t))) / 2;
    const v = WIDTH * Math.sin(t) * Math.sin(t / 2) * 0.5;
    points.push({
      x: base.x + axis.x * u + left.x * v,
      y: base.y + axis.y * u + left.y * v,
    });
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { points, lengths, total: lengths[lengths.length - 1], axis, base };
}

// Point on the outline at a fraction of its length, with the outward direction there.
function pointAt(outline, fraction) {
  const target = Math.min(Math.max(fraction, 0), 1) * outline.total;
  let i = 1;
  while (i < outline.lengths.length - 1 && outline.lengths[i] < target) i++;
  const p0 = outline.points[i - 1];
  const p1 = outline.points[i];
  const span = outline.lengths[i] - outline.lengths[i - 1] || 1;
  const f = (target - outline.lengths[i - 1]) / span;
  const dx = (p1.x - p0.x) / span;
  const dy = (p1.y - p0.y) / span;
  return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, out: { x: dy, y: -dx }, along: { x: dx, y: dy } };
}

function arcPath(outline, from, to) {
  const start = pointAt(outline, from);
  const end = pointAt(outline, to);
  const parts = [`M${start.x.toFixed(2)} ${start.y.toFixed(2)}`];
  outline.points.forEach((p, i) => {
    const f = outline.lengths[i] / outline.total;
    if (f > from && f < to) parts.push(`L${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  });
  parts.push(`L${end.x.toFixed(2)} ${end.y.toFixed(2)}`);
  return parts.join('');
}

function picotCentre(outline, stitchAt, totalStitches) {
  const p = pointAt(outline, stitchAt / totalStitches);
  return { x: p.x + p.out.x * PICOT_R, y: p.y + p.out.y * PICOT_R, edge: p };
}

// options.step: the current step from buildSteps, or null to draw the finished piece.
// options.labelRing: ring index that shows its stitch numbers.
export function renderDiagram(pattern, { step = null, labelRing = null, title = '' } = {}) {
  const rings = pattern.elements.filter((e) => e.type === 'ring').map(readElement);
  const start = pattern.layout.startAngle;
  const outlines = rings.map((_, i) => ringOutline(start + (i * 360) / rings.length));
  const stateOf = (i) => {
    if (!step) return 'done';
    if (i < step.elementIndex) return 'done';
    return i === step.elementIndex ? 'current' : 'todo';
  };
  // Picots named so joins can find them.
  const named = new Map();
  rings.forEach((ring, i) => {
    ring.items.forEach((item) => {
      if (item.kind === 'leave') named.set(`${ring.id}.${item.name}`, picotCentre(outlines[i], item.from, ring.stitches));
    });
  });

  let svg = '';
  rings.forEach((ring, i) => {
    const outline = outlines[i];
    const state = stateOf(i);
    if (state === 'current') {
      const reached = step.at / step.total;
      svg += `<path class="ring todo" d="${arcPath(outline, 0, 1)}"/>`;
      if (reached > 0) svg += `<path class="ring active" d="${arcPath(outline, 0, reached)}"/>`;
    } else {
      svg += `<path class="ring ${state}" d="${arcPath(outline, 0, 1)}"/>`;
    }

    const centre = pointAt(outline, 0.5);
    const lx = (outline.base.x + centre.x) / 2 + outline.axis.x * 12;
    const ly = (outline.base.y + centre.y) / 2 + outline.axis.y * 12;
    svg += `<text class="letter ${state}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${ring.id}</text>`;

    ring.items.forEach((item, itemIndex) => {
      const reachedHere = state === 'done' || (state === 'current' && itemIndex <= step.itemIndex);
      const isNow = state === 'current' && itemIndex === step.itemIndex;
      const fade = reachedHere ? '' : ' faint';
      if (item.kind === 'deco' || item.kind === 'leave') {
        const c = picotCentre(outline, item.from, ring.stitches);
        const type = item.kind === 'deco' ? 'deco' : 'joinpicot';
        svg += `<circle class="picot ${type}${fade}${isNow ? ' now' : ''}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${PICOT_R}"/>`;
      }
      if (item.kind === 'join') {
        const c = picotCentre(outline, item.from, ring.stitches);
        const target = named.get(`${item.element}.${item.name}`);
        if (target) {
          svg += `<line class="joinline${fade}${isNow ? ' now' : ''}" x1="${c.edge.x.toFixed(1)}" y1="${c.edge.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}"/>`;
        }
      }
      if (item.kind === 'stitch' && i === labelRing) {
        const mid = pointAt(outline, (item.from + item.to) / 2 / ring.stitches);
        const offset = 18;
        const x = mid.x + mid.out.x * offset;
        const y = mid.y + mid.out.y * offset;
        svg += `<text class="count${isNow ? ' now' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${item.count}</text>`;
      }
    });

    // Start arrow beside the first ring, showing which way the work travels.
    if (i === 0) {
      const p = pointAt(outline, 0.045);
      const inX = p.x - p.out.x * 15;
      const inY = p.y - p.out.y * 15;
      const tip = { x: inX + p.along.x * 12, y: inY + p.along.y * 12 };
      const tail = { x: inX - p.along.x * 12, y: inY - p.along.y * 12 };
      svg += `<g class="start-arrow"><line x1="${tail.x.toFixed(1)}" y1="${tail.y.toFixed(1)}" x2="${tip.x.toFixed(1)}" y2="${tip.y.toFixed(1)}"/>`
        + `<path d="M${(tip.x - p.along.x * 7 + p.out.x * 4.5).toFixed(1)} ${(tip.y - p.along.y * 7 + p.out.y * 4.5).toFixed(1)}L${tip.x.toFixed(1)} ${tip.y.toFixed(1)}L${(tip.x - p.along.x * 7 - p.out.x * 4.5).toFixed(1)} ${(tip.y - p.along.y * 7 - p.out.y * 4.5).toFixed(1)}"/></g>`;
    }
  });

  return `<svg class="diagram" viewBox="-185 -185 370 370" role="img" aria-label="${title}">${svg}</svg>`;
}
