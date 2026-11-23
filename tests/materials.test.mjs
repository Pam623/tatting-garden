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
    shuttleCm: 170, ballCm: 0, shuttles: 1, rounds: 1, ballNeeded: false, totalStitches: 110, picots: 30,
  });
});

test('a bridge takes ball thread for its stitches and picots, and core from the shuttle', () => {
  const result = estimateThread({ elements: [ring('A', ['10']), bridge('B', ['100', 'o', 'p:x'])] });
  // shuttle: 10 + 100 * 0.1 = 20 cm, * 1.15 + 20 = 43, up to 50
  // ball: 100 + 2 * 0.6 = 101.2 cm, * 1.15 + 20 = 136.38, up to 140
  assert.deepEqual(result, { shuttleCm: 50, ballCm: 140, shuttles: 1, rounds: 1, ballNeeded: true, totalStitches: 110, picots: 2 });
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

test('each round is its own thread: slack, tails and rounding up per round, then added', () => {
  const two = estimateThread({ elements: [ring('A', ['10']), { ...bridge('B', ['20']), round: 2 }] });
  // round 1 shuttle: 10 * 1.15 + 20 = 31.5, up to 40; no ball.
  // round 2 shuttle: 20 * 0.1 = 2, * 1.15 + 20 = 22.3, up to 30; ball: 20 * 1.15 + 20 = 43, up to 50.
  assert.deepEqual(two, { shuttleCm: 70, ballCm: 50, shuttles: 1, rounds: 2, ballNeeded: true, totalStitches: 30, picots: 0 });
});

test('the leaf bookmark is rounded per round, not after adding the rounds up', () => {
  const leaf = JSON.parse(readFileSync(join(root, 'patterns/leaf-bookmark.json'), 'utf8'));
  const result = estimateThread(leaf, { size: 20 });
  assert.equal(result.rounds, 4);
  assert.equal(result.shuttleCm, 260);
  assert.equal(result.ballCm, 390);
});

test('a round start inside a repeat starts a new round, with its own tails, in every group', () => {
  const elements = [ring('A', ['10']), { ...ring('B', ['10']), round: 2 }];
  const once = estimateThread({ elements, repeat: { elements: ['B'], defaultTimes: 1 } });
  const thrice = estimateThread({ elements, repeat: { elements: ['B'], defaultTimes: 3 } });
  assert.equal(once.rounds, 2);
  assert.equal(thrice.rounds, 4);
  // every round: 10 * 1.15 + 20 = 31.5, up to 40
  assert.equal(thrice.shuttleCm, 160);
  assert.equal(thrice.totalStitches, 40);
});
