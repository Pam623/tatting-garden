import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  padAddStroke, padExtendStroke, padLines, padMirrorPoints, padPointFromEvent, padUndo, paintSketch,
} from '../js/sketch-pad.js';

const draw = (strokes, points, mirrored) => {
  let next = padAddStroke(strokes, points[0], mirrored);
  points.slice(1).forEach((point) => { next = padExtendStroke(next, point); });
  return next;
};

test('a mirrored stroke draws two lines, reflected across the middle', () => {
  const strokes = draw([], [[0.2, 0.1], [0.3, 0.4]], true);
  const lines = padLines(strokes);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], [[0.2, 0.1], [0.3, 0.4]]);
  assert.deepEqual(lines[1].map(([x, y]) => [Number(x.toFixed(6)), y]), [[0.8, 0.1], [0.7, 0.4]]);
});

test('an unmirrored stroke draws one line', () => {
  assert.equal(padLines(draw([], [[0.2, 0.1], [0.3, 0.4]], false)).length, 1);
});

test('turning mirroring off keeps earlier strokes mirrored', () => {
  const strokes = draw(draw([], [[0.2, 0.1], [0.3, 0.4]], true), [[0.5, 0.5], [0.6, 0.6]], false);
  assert.equal(padLines(strokes).length, 3);
});

test('undo takes back one whole stroke, its reflection with it', () => {
  const strokes = draw(draw([], [[0.1, 0.1], [0.2, 0.2]], true), [[0.3, 0.3], [0.4, 0.4]], true);
  const undone = padUndo(strokes);
  assert.equal(padLines(undone).length, 2);
  assert.equal(padUndo(padUndo(undone)).length, 0, 'undo on an empty board is harmless');
});

test('points too close together are not stored', () => {
  const strokes = draw([], [[0.5, 0.5], [0.5001, 0.5], [0.6, 0.5]], false);
  assert.equal(strokes[0].points.length, 2);
});

test('a pointer is read relative to the board and kept on it', () => {
  const rect = { left: 10, top: 20, width: 200, height: 200 };
  assert.deepEqual(padPointFromEvent({ clientX: 110, clientY: 70 }, rect), [0.5, 0.25]);
  assert.deepEqual(padPointFromEvent({ clientX: -50, clientY: 500 }, rect), [0, 1]);
});

test('the saved picture has only ink on white paper', () => {
  const calls = [];
  const context = new Proxy({}, {
    get: (_, name) => (...args) => calls.push([name, ...args]),
    set: () => true,
  });
  paintSketch(context, draw([], [[0.25, 0.5], [0.5, 0.5]], true), 100);
  assert.deepEqual(calls[0], ['fillRect', 0, 0, 100, 100]);
  assert.ok(!calls.some(([name]) => name === 'setLineDash'), 'the guide stays out of it');
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
});

test('mirroring twice gives the same points back', () => {
  const points = [[0.2, 0.3], [0.9, 0.1]];
  assert.deepEqual(padMirrorPoints(padMirrorPoints(points)).map(([x, y]) => [Number(x.toFixed(6)), y]), points);
});
