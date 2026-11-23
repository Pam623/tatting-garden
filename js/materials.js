// Estimates how much thread a pattern takes, from a measured 4 inches for 10 double stitches at size 20.
import { readElement, workedSequence } from './pattern.js';

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
  // Each round is its own piece of thread, so each gets its own slack, tails and rounding up.
  // A round start inside a repeat starts a new round every time the group is worked.
  const pieces = [];
  let totalStitches = 0;
  let picots = 0;
  workedSequence(pattern, times).forEach((element, index) => {
    if (index === 0 || element.round !== undefined) pieces.push({ shuttle: 0, ball: 0, bridges: false });
    const piece = pieces.at(-1);
    const { items, stitches } = readElement(element);
    const marks = items.filter((item) => item.kind === 'deco' || item.kind === 'leave').length;
    totalStitches += stitches;
    picots += marks;
    if (element.type === 'bridge') {
      piece.bridges = true;
      piece.ball += (stitches * STITCH_CM + marks * PICOT_CM) * factor;
      piece.shuttle += stitches * CORE_CM * factor;
    } else {
      piece.shuttle += (stitches * STITCH_CM + marks * PICOT_CM) * factor;
    }
  });
  const ballNeeded = pieces.some((piece) => piece.bridges);
  const sum = (thread) => pieces.reduce((total, piece) => total + thread(piece), 0);
  return {
    shuttleCm: sum((piece) => withSlack(piece.shuttle)),
    ballCm: sum((piece) => (piece.bridges ? withSlack(piece.ball) : 0)),
    shuttles: 1,
    rounds: pieces.length,
    ballNeeded,
    totalStitches,
    picots,
  };
}
