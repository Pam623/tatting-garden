import { structureProblems } from './pattern.js';

// Reading and writing saved rows of the `studio` collection. Nothing here touches the page,
// so all of it can be tested with the shapes the artifact db documents.

export const ROW_LIMIT_BYTES = 256 * 1024;
export const READ_TIMEOUT_MS = 10000;
export const RETRY_TIMEOUT_MS = 30000;
export const WRITE_TIMEOUT_MS = 30000;

const SAVE_MESSAGES = {
  invalid_argument: '这个花样太大或格式不对，存不进去。可以再转一次，或者换一张更简单的图。',
  quota_exceeded: '存储空间满了，这个花样存不进去。请先删掉一些不要的花样。',
  resource_exhausted: '操作太频繁了，请等一分钟再点保存。',
  unavailable: '存储暂时连不上，请过一会儿再点保存。',
  timeout: '保存一直没有回应，不确定有没有存上。请检查网络后再点一次。',
  revoked: '这个页面的存储权限被收回了，存不了。请刷新页面后再试。',
  not_granted: '这个页面还没有得到存储权限，存不了。请先允许后再试。',
  capability_disabled: '这个页面现在用不了存储，存不了。请刷新页面后再试。',
  capability_removed: '这个页面现在用不了存储，存不了。请刷新页面后再试。',
};

export function saveErrorMessage(error) {
  return SAVE_MESSAGES[error?.code] ?? '没能保存，请再点一次。';
}

// Rejects with { code: 'timeout' } if the promise takes too long.
export function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject({ code: 'timeout', message: `No answer in ${ms} ms` }), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// The db and the asset store each name one code that asks for a single retry after a short delay.
const RETRY_ONCE = new Set(['unavailable', 'store_unavailable']);

export async function retryIfUnavailable(call, delayMs = 500 + Math.random() * 500) {
  try {
    return await call();
  } catch (error) {
    if (!RETRY_ONCE.has(error?.code)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return call();
  }
}

// `original` describes the stored source picture; it is null when there is none.
export function buildRow(pattern, original = null, savedAt = Date.now()) {
  return { pattern, publish: false, savedAt, original };
}

export function rowBytes(row) {
  return new TextEncoder().encode(JSON.stringify(row)).length;
}

export function rowFits(row) {
  return rowBytes(row) <= ROW_LIMIT_BYTES;
}

function readOriginal(value) {
  if (!value || typeof value !== 'object' || typeof value.assetId !== 'string' || !value.assetId) return null;
  return structuredClone(value);
}

// A stored asset shows at this path from every version of the artifact.
export function originalUrl(original) {
  return original?.assetId ? `/_blob/${encodeURIComponent(original.assetId)}` : null;
}

// Turns a db QuerySnapshot into saved patterns plus the ids of rows that can't be used.
// Throws { code: 'bad_format' } if the answer isn't shaped like a QuerySnapshot at all.
export function parseSavedSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.docs)) throw { code: 'bad_format', message: 'No docs in the answer' };
  const saved = [];
  const broken = [];
  for (const doc of snapshot.docs) {
    if (doc?.exists === false) continue;
    let row = null;
    try {
      row = doc.data();
    } catch (error) {
      console.error(error);
    }
    const pattern = row?.pattern;
    const usable = pattern && typeof pattern === 'object' && pattern.id === doc.id
      && structureProblems(pattern).length === 0;
    if (!usable) {
      broken.push(String(doc?.id ?? '未知'));
      continue;
    }
    // Delivered rows are frozen, and the page keeps these for later.
    saved.push({
      pattern: structuredClone(pattern),
      original: readOriginal(row.original),
      publish: row.publish === true,
      savedAt: typeof row.savedAt === 'number' ? row.savedAt : null,
    });
  }
  return { saved, broken, stale: snapshot.metadata?.fromCache === true };
}

// One read of the collection that always settles. `status` is ok, timeout, bad_format or error.
export async function readSaved(db, { timeoutMs = READ_TIMEOUT_MS, retryDelayMs } = {}) {
  try {
    const snapshot = await withDeadline(
      retryIfUnavailable(() => db.collection('studio').get(), retryDelayMs),
      timeoutMs,
    );
    return { status: 'ok', ...parseSavedSnapshot(snapshot) };
  } catch (error) {
    console.error(error);
    const status = error?.code === 'timeout' || error?.code === 'bad_format' ? error.code : 'error';
    return { status, saved: [], broken: [], stale: false, code: error?.code ?? null };
  }
}

// What to tell the viewer about a read: null when there is nothing to say.
// `retry` says whether reading again could help.
export function savedNotice(result) {
  if (!result) return null;
  const keep = '这不代表花样丢了。';
  if (result.status === 'unavailable') {
    return { kind: 'error', retry: true, text: `现在连不上存储，读不到保存的花样。${keep}请确认已经登录，再读一次。` };
  }
  if (result.status === 'timeout') {
    return { kind: 'error', retry: true, text: `读取保存的花样超时了。${keep}请检查网络，再读一次。` };
  }
  if (result.status === 'bad_format') {
    return { kind: 'error', retry: true, text: `读到的保存数据格式不对，没法显示。${keep}请再读一次，还不行就告诉 Claude。` };
  }
  if (result.status === 'error') {
    return { kind: 'error', retry: true, text: `读取保存的花样没成功。${keep}请过一会儿再读一次。` };
  }
  if (result.broken.length) {
    return { kind: 'error', retry: false, text: `有 ${result.broken.length} 个保存的花样数据有问题，暂时打不开（${result.broken.join('、')}）。它们还在存储里，请告诉 Claude。` };
  }
  if (result.stale) {
    return { kind: 'hint', retry: true, text: '这里显示的是上次留下的副本，最近保存的花样可能还没出现。可以再读一次。' };
  }
  return null;
}
