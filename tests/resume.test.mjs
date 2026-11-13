import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeList, wishedCards } from '../js/resume.js';

const pattern = (id, count) => ({ id, title: id.toUpperCase(), elements: Array.from({ length: count }, (_, i) => ({ id: String(i) })) });

test('only started, unfinished patterns come back, latest first', () => {
  const stored = {
    a: { index: 2, part: null, finished: false, at: 100 },
    b: { index: 0, part: null, finished: false, at: 300 },
    c: { index: 1, part: null, finished: true, at: 400 },
    d: { index: 0, part: 1, finished: false, at: 200 },
    e: { index: 9, part: null, finished: false, at: 500 },
    f: { index: 3 },
  };
  const list = resumeList(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => pattern(id, 6)), (id) => stored[id] ?? null);
  assert.deepEqual(list.map((r) => [r.pattern.id, r.index, r.total]), [['d', 0, 6], ['a', 2, 6], ['f', 3, 6]]);
});

test('nothing to pick up gives an empty list', () => {
  assert.deepEqual(resumeList([pattern('a', 3)], () => null), []);
  assert.deepEqual(resumeList([], () => ({ index: 1 })), []);
});

test('wished cards keep their order and drop ids no longer in the library', () => {
  const cards = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  assert.deepEqual(wishedCards(cards, ['z', 'gone', 'x']).map((c) => c.id), ['z', 'x']);
  assert.deepEqual(wishedCards(cards, []), []);
});
