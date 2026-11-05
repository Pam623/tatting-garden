import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildRow, originalUrl, parseSavedSnapshot, readSaved, retryIfUnavailable, rowFits, ROW_LIMIT_BYTES,
  saveErrorMessage, savedNotice, withDeadline,
} from '../js/saved.js';

const leaf = (id = 'up-abc') => ({ ...JSON.parse(readFileSync(new URL('../patterns/leaf-braid.json', import.meta.url), 'utf8')), id });

// The shape the artifact db's type definitions give for one document and for a query.
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const docSnapshot = (id, body) => Object.freeze({
  id,
  exists: true,
  data: () => deepFreeze(body),
  metadata: { fromCache: false, hasPendingWrites: false },
});
const querySnapshot = (docs, fromCache = false) => ({
  docs,
  size: docs.length,
  empty: docs.length === 0,
  docChanges: () => [],
  metadata: { fromCache, hasPendingWrites: false },
});
const dbAnswering = (get) => ({ collection: (name) => { assert.equal(name, 'studio'); return { get }; } });
const quietly = async (run) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
};

test('a saved row comes back with its pattern and original', () => {
  const original = { assetId: 'a'.repeat(32), width: 800, height: 600, bytes: 1000, contentType: 'image/jpeg' };
  const { saved, broken, stale } = parseSavedSnapshot(querySnapshot([
    docSnapshot('up-abc', { pattern: leaf(), publish: false, savedAt: 5, original }),
  ]));
  assert.deepEqual(broken, []);
  assert.equal(stale, false);
  assert.equal(saved[0].pattern.id, 'up-abc');
  assert.deepEqual(saved[0].original, original);
  assert.equal(saved[0].savedAt, 5);
  assert.equal(saved[0].publish, false);
});

test('a row saved before originals existed still reads', () => {
  const { saved, broken } = parseSavedSnapshot(querySnapshot([
    docSnapshot('up-abc', { pattern: leaf(), publish: true, savedAt: 5 }),
  ]));
  assert.deepEqual(broken, []);
  assert.equal(saved[0].original, null);
  assert.equal(saved[0].publish, true);
});

test('the page gets its own copy, since delivered rows are frozen', () => {
  const { saved } = parseSavedSnapshot(querySnapshot([docSnapshot('up-abc', { pattern: leaf() })]));
  assert.equal(Object.isFrozen(saved[0].pattern), false);
  assert.equal(Object.isFrozen(saved[0].pattern.elements), false);
});

test('an empty collection is fine and says nothing', () => {
  const result = parseSavedSnapshot(querySnapshot([]));
  assert.deepEqual(result.saved, []);
  assert.equal(savedNotice({ status: 'ok', ...result }), null);
});

test('a document that does not exist is skipped, not counted as broken', () => {
  const missing = { id: 'x', exists: false, data: () => undefined, metadata: {} };
  assert.deepEqual(parseSavedSnapshot(querySnapshot([missing])), { saved: [], broken: [], stale: false });
});

test('unusable rows are named and do not hide good ones', () => {
  const noStructure = { ...leaf('up-b'), elements: [{ id: 'A' }] };
  const { saved, broken } = parseSavedSnapshot(querySnapshot([
    docSnapshot('up-a', { pattern: leaf('up-a') }),
    docSnapshot('up-b', { pattern: noStructure }),
    docSnapshot('up-c', { note: 'no pattern' }),
    docSnapshot('up-d', { pattern: leaf('other') }),
    { id: 'up-e', exists: true, data: () => { throw new Error('nope'); }, metadata: {} },
  ]));
  assert.deepEqual(saved.map((row) => row.pattern.id), ['up-a']);
  assert.deepEqual(broken, ['up-b', 'up-c', 'up-d', 'up-e']);
});

test('an answer that is not a query snapshot is bad_format', () => {
  for (const answer of [null, undefined, {}, { docs: 'x' }, []]) {
    assert.throws(() => parseSavedSnapshot(answer), { code: 'bad_format' });
  }
});

test('a copy from the cache is marked stale', () => {
  const result = parseSavedSnapshot(querySnapshot([docSnapshot('up-abc', { pattern: leaf() })], true));
  assert.equal(result.stale, true);
  const notice = savedNotice({ status: 'ok', ...result });
  assert.equal(notice.kind, 'hint');
  assert.equal(notice.retry, true);
});

test('readSaved returns good rows', async () => {
  const db = dbAnswering(async () => querySnapshot([docSnapshot('up-abc', { pattern: leaf() })]));
  const result = await readSaved(db);
  assert.equal(result.status, 'ok');
  assert.equal(result.saved.length, 1);
});

test('readSaved reports a timeout rather than an empty list', async () => {
  const result = await quietly(() => readSaved(dbAnswering(() => new Promise(() => {})), { timeoutMs: 5 }));
  assert.equal(result.status, 'timeout');
  const notice = savedNotice(result);
  assert.equal(notice.kind, 'error');
  assert.equal(notice.retry, true);
  assert.match(notice.text, /不代表花样丢了/);
});

test('readSaved reports a wrong format', async () => {
  const result = await quietly(() => readSaved(dbAnswering(async () => ({ rows: [] }))));
  assert.equal(result.status, 'bad_format');
  assert.match(savedNotice(result).text, /格式不对/);
});

test('readSaved reports a db error and keeps its code', async () => {
  const result = await quietly(() => readSaved(dbAnswering(async () => { throw { code: 'revoked', message: 'x' }; })));
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'revoked');
  assert.match(savedNotice(result).text, /不代表花样丢了/);
});

test('readSaved retries once when the db is unavailable', async () => {
  let calls = 0;
  const db = dbAnswering(async () => {
    calls += 1;
    if (calls === 1) throw { code: 'unavailable', message: 'x' };
    return querySnapshot([]);
  });
  const result = await readSaved(db, { retryDelayMs: 1 });
  assert.equal(result.status, 'ok');
  assert.equal(calls, 2);
});

test('retryIfUnavailable retries only once, and only for unavailable', async () => {
  let calls = 0;
  await assert.rejects(retryIfUnavailable(async () => { calls += 1; throw { code: 'unavailable' }; }, 1), { code: 'unavailable' });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryIfUnavailable(async () => { calls += 1; throw { code: 'quota_exceeded' }; }, 1), { code: 'quota_exceeded' });
  assert.equal(calls, 1);
});

test('withDeadline passes answers and failures through and times out', async () => {
  assert.equal(await withDeadline(Promise.resolve(1), 50), 1);
  await assert.rejects(withDeadline(Promise.reject({ code: 'x' }), 50), { code: 'x' });
  await assert.rejects(withDeadline(new Promise(() => {}), 5), { code: 'timeout' });
});

test('broken rows are named in the notice', () => {
  const notice = savedNotice({ status: 'ok', saved: [], broken: ['up-a', 'up-b'], stale: false });
  assert.match(notice.text, /2 个/);
  assert.match(notice.text, /up-a、up-b/);
  assert.equal(notice.retry, false);
});

test('no db at all is explained', () => {
  assert.match(savedNotice({ status: 'unavailable' }).text, /连不上存储/);
  assert.equal(savedNotice(null), null);
});

test('rows are measured in bytes against the db limit', () => {
  const row = (text) => buildRow({ id: 'x', text }, null, 1);
  assert.equal(rowFits(row('a')), true);
  assert.equal(rowFits(row('a'.repeat(ROW_LIMIT_BYTES))), false);
  // One Chinese character takes three bytes, so length alone would pass this.
  assert.equal(rowFits(row('花'.repeat(ROW_LIMIT_BYTES / 2))), false);
});

test('a built row keeps the pattern apart from the original', () => {
  const pattern = leaf();
  const original = { assetId: 'abc' };
  const row = buildRow(pattern, original, 9);
  assert.deepEqual(Object.keys(row).sort(), ['original', 'pattern', 'publish', 'savedAt']);
  assert.equal(row.publish, false);
  assert.equal(row.pattern.original, undefined);
  assert.equal(originalUrl(row.original), '/_blob/abc');
  assert.equal(originalUrl(null), null);
});

test('every save failure has a clear message', () => {
  for (const code of ['invalid_argument', 'quota_exceeded', 'resource_exhausted', 'unavailable', 'timeout', 'revoked', 'not_granted']) {
    assert.notEqual(saveErrorMessage({ code }), saveErrorMessage({ code: 'new_code' }), code);
  }
  assert.match(saveErrorMessage(null), /再点一次/);
});
