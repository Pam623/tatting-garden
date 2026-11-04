// Estimates how much thread a pattern takes, from a measured 4 inches for 10 double stitches at size 20.
import { readElement } from './pattern.js';

const SIZE_FACTOR = { 20: 1.0, 40: 0.7, 80: 0.5 };
const STITCH_CM = 1.0;
const CORE_CM = 0.1;
const PICOT_CM = 0.6;
const SLACK = 1.15;
const TAIL_CM = 20;

export const THREAD_SIZES = Object.keys(SIZE_FACTOR).map(Number);

const withSlack = (cm) => Math.ceil((cm * SLACK + TAIL_CM) / 10) * 10;

export function estimateThread(pattern, { size = 20, repeats } = {}) {
  const factor = SIZE_FACTOR[size];
  if (factor === undefined) throw new Error(`Unknown thread size: ${size}`);
  const times = repeats ?? pattern.repeat?.defaultTimes ?? 1;
  const repeated = pattern.repeat?.elements ?? [];
  let shuttle = 0;
  let ball = 0;
  let totalStitches = 0;
  let picots = 0;
  let ballNeeded = false;
  pattern.elements.forEach((element) => {
    const { items, stitches } = readElement(element);
    const count = repeated.includes(element.id) ? times : 1;
    const marks = items.filter((item) => item.kind === 'deco' || item.kind === 'leave').length;
    totalStitches += stitches * count;
    picots += marks * count;
    if (element.type === 'bridge') {
      ballNeeded = true;
      ball += (stitches * STITCH_CM + marks * PICOT_CM) * factor * count;
      shuttle += stitches * CORE_CM * factor * count;
    } else {
      shuttle += (stitches * STITCH_CM + marks * PICOT_CM) * factor * count;
    }
  });
  return {
    shuttleCm: withSlack(shuttle),
    ballCm: ballNeeded ? withSlack(ball) : 0,
    shuttles: 1,
    ballNeeded,
    totalStitches,
    picots,
  };
}
