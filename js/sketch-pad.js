// The drawing board on the private workbench. Strokes are kept in 0..1 coordinates, so the
// board can change size (a phone turning sideways) without losing or distorting the sketch.

export const PAD_LINE_WIDTH = 0.012;
const PAD_MIN_POINT_GAP = 0.002;

// Strokes as a plain value, kept apart from the page so undo and mirroring can be tested.
export function padAddStroke(strokes, point, mirrored) {
  return [...strokes, { mirrored, points: [point] }];
}

export function padExtendStroke(strokes, point) {
  const last = strokes[strokes.length - 1];
  if (!last) return strokes;
  const [px, py] = last.points[last.points.length - 1];
  if (Math.hypot(point[0] - px, point[1] - py) < PAD_MIN_POINT_GAP) return strokes;
  last.points.push(point);
  return strokes;
}

export function padUndo(strokes) {
  return strokes.slice(0, -1);
}

export function padMirrorPoints(points) {
  return points.map(([x, y]) => [1 - x, y]);
}

// Every line that gets drawn: each stroke, plus its reflection if it was drawn with mirroring on.
export function padLines(strokes) {
  return strokes.flatMap((stroke) => (stroke.mirrored ? [stroke.points, padMirrorPoints(stroke.points)] : [stroke.points]));
}

// Width / height of what was drawn. Layout uses this to keep the sketch's proportions.
export function sketchAspect(strokes) {
  const points = padLines(strokes).flat();
  if (points.length < 2) return 1;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || height <= 0) return 1;
  return Math.min(3, Math.max(1 / 3, width / height));
}

export function padPointFromEvent(event, rect) {
  const clamp = (value) => Math.min(1, Math.max(0, value));
  return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
}

function padDrawLine(context, points, size) {
  context.beginPath();
  context.moveTo(points[0][0] * size, points[0][1] * size);
  if (points.length === 1) context.lineTo(points[0][0] * size + 0.01, points[0][1] * size);
  points.slice(1).forEach(([x, y]) => context.lineTo(x * size, y * size));
  context.stroke();
}

// Paints the sketch itself: white paper and ink, nothing else.
export function paintSketch(context, strokes, size) {
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = '#1c1c1c';
  context.lineWidth = PAD_LINE_WIDTH * size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  padLines(strokes).forEach((points) => padDrawLine(context, points, size));
}

// Runs the board on a canvas. onChange gets told each time the sketch changes.
export function startSketchPad(canvas, { onChange = () => {} } = {}) {
  let strokes = [];
  let mirror = true;
  let activePointer = null;
  let size = 0;
  const context = canvas.getContext('2d');

  const paint = () => {
    paintSketch(context, strokes, size);
    if (!mirror) return;
    // The axis is a guide on screen only; it stays out of the saved picture.
    context.save();
    context.setLineDash([size * 0.015, size * 0.015]);
    context.strokeStyle = '#b9b4a8';
    context.lineWidth = Math.max(1, size * 0.002);
    context.beginPath();
    context.moveTo(size / 2, 0);
    context.lineTo(size / 2, size);
    context.stroke();
    context.restore();
  };

  const resize = () => {
    const edge = Math.round(canvas.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 3));
    if (edge > 0 && edge !== size) {
      size = edge;
      canvas.width = edge;
      canvas.height = edge;
    }
    if (size) paint();
  };

  const pointOf = (event) => padPointFromEvent(event, canvas.getBoundingClientRect());

  const down = (event) => {
    if (activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointer = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    strokes = padAddStroke(strokes, pointOf(event), mirror);
    paint();
    onChange();
  };

  const move = (event) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    // A pen or finger reports many points per frame; using them all keeps curves smooth.
    const samples = event.getCoalescedEvents?.() ?? [];
    (samples.length ? samples : [event]).forEach((sample) => padExtendStroke(strokes, pointOf(sample)));
    paint();
  };

  const up = (event) => {
    if (event.pointerId === activePointer) activePointer = null;
  };

  // Older iPad and iPhone Safari can ignore touch-action, so touches are stopped here as well.
  const stopScroll = (event) => event.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('touchstart', stopScroll, { passive: false });
  canvas.addEventListener('touchmove', stopScroll, { passive: false });
  window.addEventListener('resize', resize);
  resize();

  return {
    isEmpty: () => strokes.length === 0,
    aspect: () => sketchAspect(strokes),
    mirrored: () => mirror,
    setMirror(value) {
      mirror = value;
      paint();
    },
    undo() {
      strokes = padUndo(strokes);
      paint();
      onChange();
    },
    clear() {
      strokes = [];
      paint();
      onChange();
    },
    // Paints the sketch on a separate canvas so the on-screen guide stays out of it.
    toCanvas(edge = 1200) {
      const output = document.createElement('canvas');
      output.width = edge;
      output.height = edge;
      paintSketch(output.getContext('2d'), strokes, edge);
      return output;
    },
    stop() {
      window.removeEventListener('resize', resize);
    },
  };
}
