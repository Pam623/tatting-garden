// Simulated finished piece: a thread-and-cloth line drawing made from the same pattern data as the chart.
// Rings and bridges become a thread of tiny knots, picots become small loops, joins are tied points.
// Pure function, no text in the output; each element costs four paths plus a few small circles.
import { elementGeometry } from './diagram.js';
import { readElement } from './pattern.js';

export const THREAD_COLORS = [
  { id: 'ivory', label: '象牙白', thread: '#f2ebd9', cloth: '#3d4654' },
  { id: 'beige', label: '米色', thread: '#d9c4a1', cloth: '#41404a' },
  { id: 'pink', label: '灰粉', thread: '#d8a9ab', cloth: '#3a4350' },
  { id: 'blue', label: '雾蓝', thread: '#9db3c8', cloth: '#4a3f3c' },
  { id: 'green', label: '墨绿', thread: '#2f5a46', cloth: '#e9e2d2' },
];

const THREAD_SCALE = 370;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const f = (v) => v.toFixed(1);

export function renderFinished(pattern, { color = 'ivory' } = {}) {
  const palette = THREAD_COLORS.find((c) => c.id === color) ?? THREAD_COLORS[0];
  const [minX, minY, width, height] = pattern.layout.viewBox;
  const s = width / THREAD_SCALE;
  const w = 8 * s;
  const shade = mix(palette.thread, '#000000', 0.55);
  const mid = mix(palette.thread, '#000000', 0.12);
  const light = mix(palette.thread, '#ffffff', 0.55);
  const uid = `fin-${String(pattern.id ?? 'x').replace(/[^\w-]/g, '')}-${palette.id}`;
  const parsed = pattern.elements.map((element) => ({ element, read: readElement(element), geo: elementGeometry(element) }));
  const byId = new Map(parsed.map((p) => [p.element.id, p]));
  const spot = (p, stitches) => p.geo.pointAt(p.read.stitches ? stitches / p.read.stitches : 0);

  const shadow = [];
  const body = [];
  const loops = [];
  const ties = [];
  const links = [];
  const dash = `${f(w * 0.42)} ${f(w * 0.22)}`;
  parsed.forEach((p) => {
    const d = p.geo.subPath(0, 1);
    shadow.push(`<path d="${d}" transform="translate(${f(w * 0.3)} ${f(w * 0.55)})"/>`);
    body.push(`<path class="base" d="${d}"/><path class="knots" d="${d}"/><path class="gleam" d="${d}"/>`);
    p.read.items.forEach((item) => {
      if (item.kind === 'stitch') return;
      const at = spot(p, item.from);
      if (item.kind === 'join') {
        const target = byId.get(item.element);
        const picot = target?.read.items.find((i) => i.kind === 'leave' && i.name === item.name);
        if (picot) {
          const there = spot(target, picot.from);
          links.push(`<path d="M${f(at.x)} ${f(at.y)}L${f(there.x)} ${f(there.y)}"/>`);
        }
        ties.push(`<circle cx="${f(at.x)}" cy="${f(at.y)}" r="${f(w * 0.7)}"/>`);
        return;
      }
      const r = w * 1.25;
      const cx = at.x + at.out.x * (r + w * 0.2);
      const cy = at.y + at.out.y * (r + w * 0.2);
      loops.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`);
    });
  });

    return `<svg class="finished" xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="${palette.label}线的模拟完成图">
<defs>
<radialGradient id="${uid}-bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${mix(palette.cloth, '#ffffff', 0.08)}"/><stop offset="1" stop-color="${mix(palette.cloth, '#000000', 0.18)}"/></radialGradient>
<pattern id="${uid}-weave" width="${f(w * 0.9)}" height="${f(w * 0.9)}" patternUnits="userSpaceOnUse"><path d="M0 0H${f(w * 0.9)}M0 0V${f(w * 0.9)}" stroke="${mix(palette.cloth, '#000000', 0.25)}" stroke-width="${f(w * 0.08)}" opacity="0.35"/></pattern>
</defs>
<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#${uid}-bg)"/>
<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#${uid}-weave)"/>
<g stroke="#000" stroke-opacity="0.35" stroke-width="${f(w * 1.1)}" fill="none" stroke-linecap="round" stroke-linejoin="round">${shadow.join('')}</g>
<g fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="${f(w * 0.5)}">${loops.join('')}</g>
<g fill="none" stroke="${shade}" stroke-width="${f(w * 0.95)}">${loops.join('')}</g>
<g fill="none" stroke="${mid}" stroke-width="${f(w * 0.6)}" stroke-dasharray="${dash}">${loops.join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="${shade}" stroke-width="${f(w * 0.6)}">${links.join('')}</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${f(w)}"><style>#${uid} .base{stroke:${shade};stroke-width:${f(w)}}#${uid} .knots{stroke:${mid};stroke-width:${f(w * 0.78)};stroke-dasharray:${dash}}#${uid} .gleam{stroke:${light};stroke-width:${f(w * 0.2)};stroke-dasharray:${f(w * 0.35)} ${f(w * 0.55)};stroke-dashoffset:${f(w * 0.2)};opacity:0.85}</style><g id="${uid}">${body.join('')}</g></g>
<g fill="${shade}" stroke="${light}" stroke-width="${f(w * 0.15)}">${ties.join('')}</g>
</svg>`;
}
