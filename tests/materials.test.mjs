import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { estimateThread } from '../js/materials.js';

const root = new URL('..', import.meta.url).pathname;
const flower = JSON.parse(readFileSync(join(root, 'patterns/little-flower.json'), 'utf8'));

const place = { base: [0, 0], tip: [10, 0], width: 5, dir: 'cw' };
const ring = (id, parts) => ({ id, type: 'ring', place, parts });
const bridge = (id, parts) => ({ id, type: 'bridge', place: { from: [0, 0], to: [10, 0], bulge: 2 }, parts });

test('the flower at size 20 is pinned', () => {
  assert.deepEqual(estimateThread(flower, { size: 20 }), {
    shuttleCm: 170, ballCm: 0, shuttles: 1, ballNeeded: false, totalStitches: 110, picots: 30,
  });
});

test('a bridge takes ball thread for its stitches and picots, and core from the shuttle', () => {
  const result = estimateThread({ elements: [ring('A', ['10']), bridge('B', ['100', 'o', 'p:x'])] });
  // shuttle: 10 + 100 * 0.1 = 20 cm, * 1.15 + 20 = 43, up to 50
  // ball: 100 + 2 * 0.6 = 101.2 cm, * 1.15 + 20 = 136.38, up to 140
  assert.deepEqual(result, { shuttleCm: 50, ballCm: 140, shuttles: 1, ballNeeded: true, totalStitches: 110, picots: 2 });
});

test('joins add nothing', () => {
  const plain = estimateThread({ elements: [ring('A', ['10', 'p:x', '10']), ring('B', ['10'])] });
  const joined = estimateThread({ elements: [ring('A', ['10', 'p:x', '10']), ring('B', ['5', 'j:A.x', '5'])] });
  assert.equal(joined.picots, 1);
  assert.equal(joined.shuttleCm, plain.shuttleCm);
});

test('repeat elements count repeats times, defaulting to defaultTimes', () => {
  const elements = [ring('A', ['20']), ring('B', ['40'])];
  const repeat = { elements: ['B'], defaultTimes: 3, open: [] };
  assert.equal(estimateThread({ elements, repeat }).totalStitches, 140);
  assert.equal(estimateThread({ elements, repeat }, { repeats: 1 }).totalStitches, 60);
  const five = estimateThread({ elements, repeat }, { repeats: 5 });
  assert.equal(five.totalStitches, 220);
  assert.equal(five.shuttleCm, 280);
  assert.equal(estimateThread({ elements }, { repeats: 5 }).totalStitches, 60);
});

test('finer thread takes less', () => {
  const elements = [ring('A', ['100'])];
  assert.equal(estimateThread({ elements }, { size: 20 }).shuttleCm, 140);
  assert.equal(estimateThread({ elements }, { size: 40 }).shuttleCm, 110);
  assert.equal(estimateThread({ elements }, { size: 80 }).shuttleCm, 80);
});

test('an unknown size throws', () => {
  assert.throws(() => estimateThread(flower, { size: 30 }), /size/);
});
