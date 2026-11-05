import { structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { THREAD_SIZES } from './materials.js';
import { convertImage, designFromSketch } from './convert.js';
import {
  buildRow, READ_TIMEOUT_MS, readSaved, retryIfUnavailable, RETRY_TIMEOUT_MS, rowFits, saveErrorMessage, savedNotice,
  withDeadline, WRITE_TIMEOUT_MS,
} from './saved.js';
import {
  ACCEPTED_FILES, describeOriginal, fileKind, fileProblem, originalErrorMessage, pageNumbers, pdfErrorMessage,
  readPageNumber,
} from './upload-file.js';
import { canvasToJpeg, shrinkPicture } from './picture.js';
import { startSketchPad } from './sketch-pad.js';
import { openPdf } from './pdf-reader.js';
import {
  app, embedded, escapeHtml, isKnownPattern, legendFor, materialsPanel, readSetting, rememberPattern,
  saveSetting, setCleanup, stitchTable, studio,
} from './shared.js';

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// claude.use answers null when a capability can't run in this view; a failure means the same.
async function useCapability(name) {
  try {
    return await withTimeout(window.claude.use(name), 10000);
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function loadSaved(timeoutMs) {
  const result = studio.db ? await readSaved(studio.db, { timeoutMs }) : { status: 'unavailable', saved: [] };
  result.saved.forEach(({ pattern, original }) => {
    // A saved pattern can't replace one built into the page.
    if (isKnownPattern(pattern.id) && !studio.savedIds.has(pattern.id)) return;
    rememberPattern(pattern);
    studio.savedIds.add(pattern.id);
    if (original) studio.originals.set(pattern.id, original);
  });
  studio.notice = savedNotice(result);
}

export async function startStudio() {
  if (!embedded || typeof window.claude?.use !== 'function') return;
  app.innerHTML = '<p class="hint" role="status">正在读取保存的花样……</p>';
  [studio.sample, studio.db, studio.assets] = await Promise.all(
    [useCapability('sample'), useCapability('db'), useCapability('assets')],
  );
  await loadSaved(READ_TIMEOUT_MS);
}

// Runs when the viewer asks to read the saved patterns again.
export async function rereadSaved() {
  studio.db = studio.db ?? await useCapability('db');
  await loadSaved(RETRY_TIMEOUT_MS);
}

// The current trouble reading saved patterns, ready to put on a page.
export function studioNoticeHtml() {
  const notice = studio.notice;
  if (!notice) return '';
  const retry = notice.retry ? '<button type="button" class="ghost publish" id="reread">再读一次</button>' : '';
  return `<p class="${notice.kind}" role="status">${escapeHtml(notice.text)}</p>${retry}`;
}

const SAMPLE_MESSAGES = {
  rate_limited: '用得太频繁了，请等一会儿再试。',
  not_granted: '这个页面还没有得到使用权限，请先允许后再试。',
};

// Stores the small copy once, however many times saving is tried.
async function storeOriginal(kept) {
  if (kept.uploaded) return kept.uploaded;
  if (!studio.assets) throw { code: 'no_assets' };
  const stored = await withDeadline(
    retryIfUnavailable(() => studio.assets.upload(kept.blob, { type: 'image/jpeg' })),
    WRITE_TIMEOUT_MS,
  );
  kept.uploaded = describeOriginal(stored, kept);
  return kept.uploaded;
}

// The finished chart with its thread length and save button, for uploads and sketches alike.
function showConversionResult({ pattern, problems }, { result, status, kept, again, againLabel, failure, advice }) {
  let size = readSetting('size', 20);
  if (!THREAD_SIZES.includes(size)) size = 20;
  const drawable = pattern && structureProblems(pattern).length === 0;
  const notes = problems.length
    ? `<p class="error">${failure}：${escapeHtml(problems.join('；'))}。${advice}。</p>`
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
      ${drawable && problems.length === 0 && studio.db ? '<button type="button" class="primary" id="save">保存</button><button type="button" class="ghost" id="save-plain" hidden>不带原图，只存花样</button>' : ''}
      <button type="button" class="ghost" id="again">${againLabel}</button>
    </div>
    ${drawable && problems.length === 0 && !studio.db ? '<p class="error">现在连不上存储，这个花样存不了。请确认已经登录，刷新页面后再转一次。</p>' : ''}`;
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
  document.getElementById('again').addEventListener('click', again);
  const saveButton = document.getElementById('save');
  const plainButton = document.getElementById('save-plain');
  const save = async (withOriginal) => {
    saveButton.disabled = true;
    plainButton.disabled = true;
    const enable = () => {
      saveButton.disabled = false;
      plainButton.disabled = false;
    };
    status.textContent = '正在保存……';
    let stored = null;
    if (withOriginal) {
      try {
        stored = await storeOriginal(kept);
      } catch (error) {
        console.error(error);
        status.textContent = `${originalErrorMessage(error)}花样还没有存。可以再试一次，也可以先只存花样。`;
        plainButton.hidden = false;
        saveButton.textContent = '再试一次';
        enable();
        return;
      }
    }
    try {
      const row = buildRow(pattern, stored);
      if (!rowFits(row)) {
        status.textContent = '这个花样太大，存不进去。可以再转一次，或者换一张更简单的图。';
        enable();
        return;
      }
      const target = studio.db.collection('studio').doc(pattern.id);
      await withDeadline(retryIfUnavailable(() => target.set(row)), WRITE_TIMEOUT_MS);
      rememberPattern(pattern);
      studio.savedIds.add(pattern.id);
      if (stored) studio.originals.set(pattern.id, stored);
      status.textContent = '';
      location.hash = `#/p/${pattern.id}`;
    } catch (error) {
      console.error(error);
      enable();
      status.textContent = saveErrorMessage(error);
    }
  };
  saveButton?.addEventListener('click', () => save(true));
  plainButton?.addEventListener('click', () => save(false));
}

export async function showUpload() {
  document.title = '上传 · 梭编实验室';
  if (!studio.sample) {
    app.innerHTML = '<a class="back" href="#/">← 全部花样</a><p class="error">这里不能上传图片。</p>';
    return;
  }
  app.innerHTML = `
    <div class="upload">
      <a class="back" href="#/">← 全部花样</a>
      <h1 class="pattern-title">上传图片或 PDF</h1>
      <p class="lede">书上的图解页、手绘的图解，或者成品照片，都可以。PDF 有很多页时，选其中一页来转。</p>
      <input type="file" id="file" accept="${ACCEPTED_FILES}" aria-label="选择图片或 PDF">
      <p class="hint" id="pages" hidden>
        <label>第 <select id="page"></select> 页</label>，共 <span id="page-count"></span> 页
      </p>
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
  const pages = document.getElementById('pages');
  const pagePicker = document.getElementById('page');
  let pdf = null;
  let pdfName = '';
  let blob = null;
  let original = null;
  let previewUrl = null;
  let run = 0;

  const showPreview = (picture) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = picture ? URL.createObjectURL(picture) : null;
    preview.hidden = !picture;
    if (picture) preview.src = previewUrl;
    else preview.removeAttribute('src');
  };
  const closePdf = () => {
    pdf?.close();
    pdf = null;
    pages.hidden = true;
  };
  setCleanup(() => {
    showPreview(null);
    closePdf();
  });

  // Forgets the current picture, so an old one can't be converted or saved by mistake.
  const clearPicture = () => {
    run += 1;
    blob = null;
    original = null;
    result.innerHTML = '';
    status.textContent = '';
    convert.disabled = true;
    showPreview(null);
    return run;
  };

  // `picture` is what Claude reads; a smaller copy of it is what gets saved.
  const usePicture = async (picture, details, mine) => {
    const shrunk = await shrinkPicture(picture);
    if (mine !== run) return;
    blob = picture;
    original = { ...shrunk, ...details, uploaded: null };
    status.textContent = '';
    convert.disabled = false;
    showPreview(shrunk.blob);
  };

  const showPdfPage = async (number, mine) => {
    status.textContent = `正在读第 ${number} 页……`;
    try {
      const drawn = await pdf.drawPage(number);
      if (mine !== run) return;
      await usePicture(drawn, { fileName: pdfName, page: number }, mine);
    } catch (error) {
      console.error(error);
      if (mine === run) status.textContent = pdfErrorMessage(error);
    }
  };

  const showPdf = async (picked, mine) => {
    status.textContent = '正在打开 PDF……';
    let opened;
    try {
      opened = await openPdf(picked);
    } catch (error) {
      console.error(error);
      if (mine === run) status.textContent = pdfErrorMessage(error);
      return;
    }
    if (mine !== run) {
      opened.close();
      return;
    }
    pdf = opened;
    pdfName = picked.name;
    pagePicker.innerHTML = pageNumbers(pdf.pageCount).map((n) => `<option value="${n}">${n}</option>`).join('');
    document.getElementById('page-count').textContent = String(pdf.pageCount);
    pages.hidden = pdf.pageCount < 2;
    await showPdfPage(1, mine);
  };

  pagePicker.addEventListener('change', () => {
    const number = readPageNumber(pagePicker.value, pdf?.pageCount ?? 0);
    if (number) showPdfPage(number, clearPicture());
  });

  file.addEventListener('change', async () => {
    const mine = clearPicture();
    closePdf();
    const picked = file.files[0] ?? null;
    if (!picked) return;
    const problem = fileProblem(picked);
    if (problem) {
      status.textContent = problem;
      return;
    }
    if (fileKind(picked) === 'pdf') {
      await showPdf(picked, mine);
      return;
    }
    try {
      await usePicture(picked, { fileName: picked.name }, mine);
    } catch (error) {
      console.error(error);
      if (mine === run) status.textContent = '这张图片打不开。请存成 JPG 或 PNG 再传。';
    }
  });

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
      showConversionResult(outcome, { result, status, kept: original, again: start, againLabel: '重新转', failure: '这张图没能完全转好', advice: '可以再转一次，或者换一张更清楚的图' });
    } catch (error) {
      console.error(error);
      if (mine !== run) return;
      status.textContent = SAMPLE_MESSAGES[error?.code] ?? '转换没成功，请过一会儿再试。';
    }
    if (mine === run) convert.disabled = false;
  }
  convert.addEventListener('click', start);
}

export async function showDraw() {
  document.title = '画一个 · 梭编实验室';
  if (!studio.sample) {
    app.innerHTML = '<a class="back" href="#/">← 全部花样</a><p class="error">这里不能画草图。</p>';
    return;
  }
  app.innerHTML = `
    <div class="upload">
      <a class="back" href="#/">← 全部花样</a>
      <h1 class="pattern-title">画一个</h1>
      <p class="lede">画一个简单的轮廓，比如爱心或蝴蝶。线条不用好看，看得出形状就行。</p>
      <canvas class="sketch-pad" id="pad" role="img" aria-label="画板"></canvas>
      <div class="pad-tools">
        <button type="button" class="ghost" id="undo" disabled>撤销</button>
        <button type="button" class="ghost" id="clear" disabled>清空</button>
        <label class="pad-mirror"><input type="checkbox" id="mirror" checked> 左右对称</label>
      </div>
      <p class="hint" id="mirror-note" hidden>关掉后只是画的时候不镜像，图解还是按左右对称来设计。</p>
      <button type="button" class="primary convert" id="design" disabled>变成图解</button>
      <p class="hint" id="status" role="status" aria-live="polite"></p>
      <div id="result"></div>
    </div>`;
  const design = document.getElementById('design');
  const undo = document.getElementById('undo');
  const clear = document.getElementById('clear');
  const mirror = document.getElementById('mirror');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  let run = 0;
  let kept = null;
  let busy = false;

  const pad = startSketchPad(document.getElementById('pad'), {
    // A changed sketch makes any chart below out of date, including one still being designed.
    onChange() {
      run += 1;
      busy = false;
      kept = null;
      result.innerHTML = '';
      status.textContent = '';
      const empty = pad.isEmpty();
      design.disabled = empty;
      undo.disabled = empty;
      clear.disabled = empty;
    },
  });
  setCleanup(() => {
    run += 1;
    pad.stop();
  });
  undo.addEventListener('click', () => pad.undo());
  clear.addEventListener('click', () => pad.clear());
  mirror.addEventListener('change', () => {
    pad.setMirror(mirror.checked);
    document.getElementById('mirror-note').hidden = mirror.checked;
  });

  async function start() {
    if (pad.isEmpty() || busy) return;
    run += 1;
    const mine = run;
    busy = true;
    design.disabled = true;
    result.innerHTML = '';
    const report = (text) => { if (mine === run) status.textContent = text; };
    try {
      const picture = await canvasToJpeg(pad.toCanvas(), 0.92);
      if (!kept) kept = { ...await shrinkPicture(picture), fileName: '手绘草图', uploaded: null };
      const keptForRun = kept;
      const outcome = await designFromSketch(picture, studio.sample, { aspect: pad.aspect(), onProgress: report });
      if (mine !== run) return;
      status.textContent = '';
      showConversionResult(outcome, {
        result, status, kept: keptForRun, again: start, againLabel: '重新设计', failure: '这张草图没能设计好', advice: '可以再设计一次，或者把草图画简单一点',
      });
    } catch (error) {
      console.error(error);
      if (mine !== run) return;
      status.textContent = SAMPLE_MESSAGES[error?.code] ?? '设计没成功，请过一会儿再试。';
    }
    if (mine === run) {
      busy = false;
      design.disabled = pad.isEmpty();
    }
  }
  design.addEventListener('click', start);
}
