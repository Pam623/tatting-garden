import { structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { THREAD_SIZES } from './materials.js';
import { convertImage } from './convert.js';
import {
  app, embedded, escapeHtml, isKnownPattern, legendFor, materialsPanel, readSetting, rememberPattern,
  saveSetting, stitchTable, studio,
} from './shared.js';

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function loadSaved() {
  try {
    const snap = await withTimeout(studio.db.collection('studio').get(), 10000);
    (snap?.docs ?? []).forEach((doc) => {
      const row = doc.data?.();
      if (!row?.pattern?.id || isKnownPattern(row.pattern.id)) return;
      rememberPattern(row.pattern);
      studio.savedIds.add(row.pattern.id);
    });
  } catch (error) {
    console.error(error);
  }
}

export async function startStudio() {
  if (!embedded || typeof window.claude?.use !== 'function') return;
  try {
    studio.sample = await withTimeout(window.claude.use('sample'), 10000);
    studio.db = await withTimeout(window.claude.use('db'), 10000);
  } catch {
    studio.db = null;
  }
  if (studio.db) await loadSaved();
}

const SAMPLE_MESSAGES = {
  rate_limited: '用得太频繁了，请等一会儿再试。',
  not_granted: '这个页面还没有得到使用权限，请先允许后再试。',
};

export async function showUpload() {
  document.title = '上传 · 梭编实验室';
  if (!studio.sample) {
    app.innerHTML = '<a class="back" href="#/">← 全部花样</a><p class="error">这里不能上传图片。</p>';
    return;
  }
  app.innerHTML = `
    <div class="upload">
      <a class="back" href="#/">← 全部花样</a>
      <h1 class="pattern-title">上传图片</h1>
      <p class="lede">书上的图解页、手绘的图解，或者成品照片，都可以。</p>
      <input type="file" id="file" accept="image/*" aria-label="选择图片">
      <img class="photo" id="preview" alt="" hidden>
      <button type="button" class="primary convert" id="convert" disabled>转成图解</button>
      <p class="hint" id="status" role="status" aria-live="polite"></p>
      <div id="result"></div>
    </div>`;
  const file = document.getElementById('file');
  const preview = document.getElementById('preview');
  const convert = document.getElementById('convert');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  let blob = null;
  let run = 0;
  let size = readSetting('size', 20);
  if (!THREAD_SIZES.includes(size)) size = 20;

  file.addEventListener('change', () => {
    blob = file.files[0] ?? null;
    run += 1;
    result.innerHTML = '';
    status.textContent = '';
    convert.disabled = !blob;
    preview.hidden = !blob;
    if (blob) preview.src = URL.createObjectURL(blob);
  });

  const showResult = ({ pattern, problems }) => {
    const drawable = pattern && structureProblems(pattern).length === 0;
    const notes = problems.length
      ? `<p class="error">这张图没能完全转好：${escapeHtml(problems.join('；'))}。可以再转一次，或者换一张更清楚的图。</p>`
      : '';
    result.innerHTML = `
      ${notes}
      ${drawable ? `
        <h2 class="pattern-title">${escapeHtml(pattern.title ?? '新花样')}</h2>
        <p class="summary">${summarize(pattern)}</p>
        <p class="lede">${escapeHtml(pattern.summary ?? '')}</p>
        <figure class="paper" id="chart">${renderChart(pattern, { counts: [], title: `${pattern.title}图解` })}</figure>
        <section class="materials" id="materials"></section>
        <section><h2>针数</h2>${stitchTable(pattern)}${legendFor(pattern)}</section>` : ''}
      <div class="upload-actions">
        ${drawable && problems.length === 0 && studio.db ? '<button type="button" class="primary" id="save">保存</button>' : ''}
        <button type="button" class="ghost" id="again">重新转</button>
      </div>`;
    const materials = document.getElementById('materials');
    const drawMaterials = () => {
      materials.innerHTML = materialsPanel(pattern, size, pattern.repeat?.defaultTimes ?? 1);
      materials.querySelectorAll('input[name="size"]').forEach((input) => {
        input.addEventListener('change', () => {
          size = Number(input.value);
          saveSetting('size', size);
          drawMaterials();
        });
      });
    };
    if (materials) drawMaterials();
    document.getElementById('again').addEventListener('click', start);
    document.getElementById('save')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await studio.db.collection('studio').doc(pattern.id).set({ pattern, publish: false, savedAt: Date.now() });
        rememberPattern(pattern);
        studio.savedIds.add(pattern.id);
        location.hash = `#/p/${pattern.id}`;
      } catch (error) {
        console.error(error);
        button.disabled = false;
        status.textContent = '没能保存，请再点一次。';
      }
    });
  };

  async function start() {
    if (!blob) return;
    run += 1;
    const mine = run;
    convert.disabled = true;
    result.innerHTML = '';
    try {
      const outcome = await convertImage(blob, studio.sample, { onProgress: (text) => { if (mine === run) status.textContent = text; } });
      if (mine !== run) return;
      status.textContent = '';
      showResult(outcome);
    } catch (error) {
      console.error(error);
      if (mine !== run) return;
      status.textContent = SAMPLE_MESSAGES[error?.code] ?? '转换没成功，请过一会儿再试。';
    }
    if (mine === run) convert.disabled = false;
  }
  convert.addEventListener('click', start);
}
