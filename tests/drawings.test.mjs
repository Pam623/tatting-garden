import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteDrawing, listDrawings, newDrawingId, saveDrawing } from '../js/drawings.js';

const memory = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map,
  };
};
const pattern = (id) => ({
  schema: 2, id, title: '手绘花片', craft: '梭编', difficulty: '入门', tier: 'sorted', rights: { kind: 'original' }, layout: { viewBox: [0, 0, 10, 10] },
  elements: [{ id: 'A', type: 'ring', parts: ['6'], place: { base: [0, 0], tip: [0, 5], width: 3, dir: 'cw' } }],
});

test('a saved drawing comes back, newest first', () => {
  const storage = memory();
  assert.ok(saveDrawing(pattern('draw-a'), storage, new Date('2026-01-01')));
  assert.ok(saveDrawing(pattern('draw-b'), storage, new Date('2026-01-02')));
  const { available, drawings } = listDrawings(storage);
  assert.equal(available, true);
  assert.deepEqual(drawings.map((d) => d.id), ['draw-b', 'draw-a']);
});

test('deleting takes the work progress with it and leaves everything else', () => {
  const storage = memory({ 'work:draw-a': '{}', 'work:other': '{}', size: '20' });
  saveDrawing(pattern('draw-a'), storage);
  assert.ok(deleteDrawing('draw-a', storage));
  assert.deepEqual([...storage.map.keys()].sort(), ['size', 'work:other']);
});

test('full or blocked storage is an answer, not a crash', () => {
  const full = memory();
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(saveDrawing(pattern('draw-a'), full), false);
  assert.equal(saveDrawing(pattern('draw-a'), null), false);
  assert.deepEqual(listDrawings(null), { available: false, drawings: [] });
  const blocked = { get length() { throw new Error('SecurityError'); } };
  assert.equal(listDrawings(blocked).available, false);
  assert.equal(deleteDrawing('draw-a', null), false);
});

test('damaged or foreign entries are skipped, the good ones still listed', () => {
  const storage = memory({
    'drawing:draw-bad': '{not json',
    'drawing:draw-odd': JSON.stringify({ pattern: pattern('draw-other') }),
    'drawing:"><img': JSON.stringify({ pattern: pattern('"><img') }),
    'drawing:draw-empty': JSON.stringify({ pattern: { ...pattern('draw-empty'), elements: [] } }),
  });
  saveDrawing(pattern('draw-good'), storage);
  assert.deepEqual(listDrawings(storage).drawings.map((d) => d.id), ['draw-good']);
});

test('a new id fits the page address', () => {
  assert.match(newDrawingId(), /^draw-[\w-]+$/);
});
