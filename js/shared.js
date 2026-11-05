import { clampProgress, formulaGroups, readElement } from './pattern.js';
import { estimateThread, THREAD_SIZES } from './materials.js';

// What every page shares: the page element, loading patterns, remembered choices and common panels.
export const app = document.getElementById('app');
const cache = new Map();
let cleanup = null;

// Runs when the current page is left.
export function setCleanup(fn) {
  cleanup = fn;
}

export function runCleanup() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The private lab page carries its patterns inside it; the site fetches them.
export const embedded = window.TATTING_PATTERNS ?? null;
(embedded ?? []).forEach((pattern) => cache.set(pattern.id, pattern));

// Only the private lab page, running as an artifact, has `claude`. The public site never does,
// so sample and db stay null there.
export const studio = {
  sample: null, db: null, assets: null, savedIds: new Set(), originals: new Map(), notice: null,
};

export function rememberPattern(pattern) {
  cache.set(pattern.id, pattern);
}

export function isKnownPattern(id) {
  return cache.has(id);
}

export async function loadIndex() {
  if (embedded) return [...embedded.map((pattern) => pattern.id), ...studio.savedIds];
  return (await fetch('patterns/index.json')).json();
}

export async function loadPattern(id) {
  if (!cache.has(id)) {
    const response = await fetch(`patterns/${id}.json`);
    if (!response.ok) throw new Error(`Could not load ${id}`);
    cache.set(id, await response.json());
  }
  return cache.get(id);
}

export function readProgress(pattern) {
  try {
    return clampProgress(JSON.parse(localStorage.getItem(`work:${pattern.id}`)), pattern.elements.length);
  } catch {
    return clampProgress(null, pattern.elements.length);
  }
}

export function saveProgress(pattern, progress) {
  try {
    localStorage.setItem(`work:${pattern.id}`, JSON.stringify(progress));
  } catch {
    // Progress just won't be remembered in this browser.
  }
}

export function readSetting(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // The choice just won't be remembered in this browser.
  }
}

export function repeatRange(pattern) {
  const ids = pattern.repeat?.elements;
  return ids?.length ? `${ids[0]}–${ids.at(-1)}` : '';
}

export function materialsPanel(pattern, size, repeats) {
  const thread = estimateThread(pattern, { size, repeats });
  const metres = (cm) => (cm / 100).toFixed(1);
  const sizes = THREAD_SIZES.map((value) => `
    <label><input type="radio" name="size" value="${value}"${value === size ? ' checked' : ''}><span>${value} 号</span></label>`).join('');
  return `
    <h2>需要</h2>
    <ul>
      <li>${thread.ballNeeded ? '1 个梭子 + 1 团线（或 2 个梭子）' : '1 个梭子'}</li>
      <li>梭子线约 ${metres(thread.shuttleCm)} 米${thread.ballNeeded ? `，线团约 ${metres(thread.ballCm)} 米` : ''}</li>
      ${pattern.threadNote ? `<li>${escapeHtml(pattern.threadNote)}</li>` : ''}
    </ul>
    <div class="size-pick" role="radiogroup" aria-label="线的粗细">${sizes}</div>`;
}

export function legendFor(pattern) {
  const items = pattern.elements.flatMap((e) => readElement(e).items);
  const has = (test) => items.some(test);
  const entries = [];
  if (has((i) => i.kind === 'leave' || i.kind === 'join')) entries.push('<li><span class="key key-join"></span><b>,</b> 接耳</li>');
  if (has((i) => i.kind === 'deco')) entries.push('<li><span class="key key-deco"></span><b>·</b> 装饰耳</li>');
  if (pattern.elements.some((e) => e.flip?.value)) entries.push('<li><span class="key key-flip">翻</span>编之前先翻面</li>');
  return `<ul class="legend">${entries.join('')}</ul>`;
}

function tableRows(pattern, type) {
  return formulaGroups(pattern)
    .filter((group) => group.type === type)
    .map((group) => {
      const ids = group.members.map((m) => m.id);
      const letters = group.members.map((m) => m.id).join(' ');
      return `
        <li>
          <button type="button" class="row" data-ids="${ids.join(',')}" aria-pressed="false">
            <span class="row-letters">${letters}</span>
            <span class="row-formula">${group.formula}</span>
            <span class="row-total">${group.stitches} 针</span>
          </button>
        </li>`;
    }).join('');
}

export function stitchTable(pattern) {
  const section = (title, type) => {
    const rows = tableRows(pattern, type);
    return rows ? `<h3>${title}</h3><ul class="rows">${rows}</ul>` : '';
  };
  return `${section('环', 'ring')}${section('桥', 'bridge')}`;
}

export function showProblems(pattern, id, problems) {
  document.title = `${pattern.title ?? id} · 梭编花园`;
  app.innerHTML = `
    <a class="back" href="#/">← 全部花样</a>
    <h1 class="pattern-title">${escapeHtml(pattern.title ?? id)}</h1>
    <p class="error">这个花样的数据有问题，暂时画不出来：${escapeHtml(problems.join('；'))}</p>`;
}
