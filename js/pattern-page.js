import { clampProgress, hasStarted, structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { attachFinishedToggle } from './finished-toggle.js';
import { THREAD_SIZES } from './materials.js';
import { originalUrl } from './saved.js';
import { originalCaption } from './upload-file.js';
import {
  app, escapeHtml, legendFor, loadPattern, materialsPanel, readProgress, readSetting, repeatRange,
  saveProgress, saveSetting, showProblems, stitchTable, studio,
} from './shared.js';

// Only saved patterns have this section, so built-in and public patterns look as before.
function originalSection(pattern) {
  if (!studio.savedIds.has(pattern.id)) return '';
  const original = studio.originals.get(pattern.id);
  if (!original) return '<section><h2>原图</h2><p class="hint">这个花样没有存原图。</p></section>';
  const caption = originalCaption(original);
  return `
    <section id="original">
      <h2>原图</h2>
      <img class="photo" src="${escapeHtml(originalUrl(original))}" alt="转换用的原图">
      ${caption ? `<p class="hint">${escapeHtml(caption)}</p>` : ''}
    </section>`;
}

export async function showPattern(id) {
  const pattern = await loadPattern(id);
  const problems = structureProblems(pattern);
  if (problems.length) {
    showProblems(pattern, id, problems);
    return;
  }
  const progress = readProgress(pattern);
  document.title = `${pattern.title} · 梭编花园`;
  let startLabel = '开始编';
  if (progress.finished) startLabel = '重新开始编';
  else if (hasStarted(progress)) startLabel = `继续编 · ${progress.pass > 1 ? `第 ${progress.pass} 组` : ''}第 ${progress.index + 1} 个`;

  app.innerHTML = `
    <div class="pattern">
      <div class="pattern-plate">
        <figure class="paper" id="chart"></figure>
      </div>
      <div class="pattern-side">
        <a class="back" href="#/">← 全部花样</a>
        <header>
          <h1 class="pattern-title">${escapeHtml(pattern.title)}</h1>
          <p class="summary" id="summary"></p>
          <p class="lede">${escapeHtml(pattern.summary ?? '')}</p>
        </header>
        <a class="start" id="start" href="#/p/${escapeHtml(pattern.id)}/work">${startLabel}</a>
        ${studio.db && studio.savedIds.has(pattern.id) ? '<button type="button" class="ghost publish" id="publish">发布到网站</button>' : ''}
        <section class="materials" id="materials"></section>
        <section>
          <h2>针数</h2>
          <p class="hint">点一行，图上对应的部分会亮起来。</p>
          ${stitchTable(pattern)}
          ${pattern.repeat ? `
            <div class="repeat-line">
              <span>重复 ${repeatRange(pattern)}</span>
              <span class="stepper">
                <span id="repeat-label">重复次数</span>
                <button type="button" id="repeat-less" aria-label="少一次">−</button>
                <output id="repeat-count" aria-labelledby="repeat-label"></output>
                <button type="button" id="repeat-more" aria-label="多一次">+</button>
              </span>
            </div>` : ''}
          ${legendFor(pattern)}
        </section>
        ${pattern.photo ? `
          <section>
            <h2>成品</h2>
            <img class="photo" src="${escapeHtml(pattern.photo)}" alt="${escapeHtml(pattern.title)}成品照片">
          </section>` : ''}
        ${originalSection(pattern)}
        ${pattern.source ? `<p class="source-line">${escapeHtml(pattern.source)}</p>` : ''}
      </div>
    </div>`;

  document.querySelector('#original img')?.addEventListener('error', (event) => {
    event.target.outerHTML = '<p class="error">原图这次没读出来，花样不受影响。请刷新页面再看；一直这样就告诉 Claude。</p>';
  });
  const publish = document.getElementById('publish');
  publish?.addEventListener('click', async () => {
    publish.disabled = true;
    try {
      await studio.db.collection('studio').doc(pattern.id).update({ publish: true });
      publish.textContent = '已请求发布';
    } catch (error) {
      console.error(error);
      publish.disabled = false;
      publish.textContent = '没成功，再点一次';
    }
  });
  if (progress.finished) {
    document.getElementById('start').addEventListener('click', () => {
      saveProgress(pattern, clampProgress(null, pattern.elements.length));
    });
  }
  const chart = document.getElementById('chart');
  const rows = [...document.querySelectorAll('.row')];
  let shown = null;
  let view = null;
  const draw = (ids) => {
    shown = ids;
    if (view?.isFinished()) return;
    chart.innerHTML = renderChart(pattern, {
      highlight: ids,
      counts: ids ?? null,
      title: `${pattern.title}图解`,
    });
  };
  rows.forEach((row) => {
    row.addEventListener('click', () => {
      const pressing = row.getAttribute('aria-pressed') !== 'true';
      rows.forEach((other) => other.setAttribute('aria-pressed', 'false'));
      row.setAttribute('aria-pressed', String(pressing));
      draw(pressing ? row.dataset.ids.split(',') : null);
    });
  });
  draw(null);

  const materials = document.getElementById('materials');
  let size = readSetting('size', 20);
  if (!THREAD_SIZES.includes(size)) size = 20;
  let repeats = readSetting(`repeat:${pattern.id}`, pattern.repeat?.defaultTimes ?? 1);
  const summary = document.getElementById('summary');
  const drawSummary = () => {
    summary.textContent = summarize(pattern, pattern.repeat ? { repeats } : {});
  };
  view = attachFinishedToggle(chart, pattern, () => draw(shown), pattern.repeat ? { repeats: () => repeats } : {});
  const drawMaterials = () => {
    materials.innerHTML = materialsPanel(pattern, size, repeats);
    materials.querySelectorAll('input[name="size"]').forEach((input) => {
      input.addEventListener('change', () => {
        size = Number(input.value);
        saveSetting('size', size);
        drawMaterials();
      });
    });
    const count = document.getElementById('repeat-count');
    if (count) count.textContent = String(repeats);
  };
  const setRepeats = (value) => {
    repeats = Math.max(1, value);
    saveSetting(`repeat:${pattern.id}`, repeats);
    drawMaterials();
    drawSummary();
    view.refresh();
  };
  document.getElementById('repeat-less')?.addEventListener('click', () => setRepeats(repeats - 1));
  document.getElementById('repeat-more')?.addEventListener('click', () => setRepeats(repeats + 1));
  drawMaterials();
  drawSummary();
}
