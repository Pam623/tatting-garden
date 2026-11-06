import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderFinished, THREAD_COLORS } from '../js/finished.js';
import { checkPattern } from '../js/pattern.js';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const cards = read('explore/index.json');
const listed = read('patterns/index.json');

// JPEG width from its start-of-frame marker.
function jpegWidth(path) {
  const data = readFileSync(path);
  let i = 2;
  while (i < data.length) {
    const marker = data[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return data.readUInt16BE(i + 7);
    i += 2 + data.readUInt16BE(i + 2);
  }
  throw new Error('no frame header');
}

test('inspiration library has 8 to 12 cards with every source field', () => {
  assert.ok(cards.length >= 8 && cards.length <= 12);
  const ids = new Set();
  cards.forEach((card) => {
    assert.ok(!ids.has(card.id), `${card.id} is repeated`);
    ids.add(card.id);
    ['title', 'note', 'kind', 'book', 'sourceUrl', 'bookUrl'].forEach((key) => assert.ok(card[key], `${card.id} lacks ${key}`));
    assert.ok(Number.isInteger(card.year), `${card.id} lacks a year`);
    assert.ok(card.page, `${card.id} lacks a page`);
    assert.match(card.sourceUrl, /^https:\/\//);
  });
});

test('every card image exists, is at most 800 wide, and all together stay under 3 MB', () => {
  let total = 0;
  cards.forEach((card) => {
    const path = join(root, card.image);
    assert.ok(existsSync(path), `${card.image} is missing`);
    assert.ok(jpegWidth(path) <= 800, `${card.image} is wider than 800`);
    total += statSync(path).size;
  });
  assert.ok(total < 3 * 1024 * 1024, `images take ${total} bytes`);
});

test('cards that link to a pattern point at a listed one that names its book', () => {
  cards.flatMap((card) => card.patterns ?? []).forEach((id) => {
    assert.ok(listed.includes(id), `${id} is not in patterns/index.json`);
    const pattern = read(`patterns/${id}.json`);
    assert.match(pattern.source, /第 \d+ 页/);
    assert.ok(checkPattern(pattern).every((check) => check.ok), `${id} fails its checks`);
  });
});

test('renderFinished draws every pattern in every colour, with no text', () => {
  listed.forEach((id) => {
    const pattern = read(`patterns/${id}.json`);
    THREAD_COLORS.forEach(({ id: color }) => {
      const svg = renderFinished(pattern, { color });
      assert.ok(svg.startsWith('<svg'));
      assert.ok(!/<text|<title|<tspan/.test(svg), `${id} has text`);
      const nodes = (svg.match(/<(path|circle|rect)\b/g) ?? []).length;
      assert.ok(nodes < 1500, `${id} has ${nodes} nodes`);
    });
  });
  assert.equal(THREAD_COLORS.length, 5);
});
