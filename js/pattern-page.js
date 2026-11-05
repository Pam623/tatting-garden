import { clampProgress, structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { THREAD_SIZES } from './materials.js';
import {
  app, escapeHtml, legendFor, loadPattern, materialsPanel, readProgress, readSetting, repeatRange,
  saveProgress, saveSetting, showProblems, stitchTable, studio,
} from './shared.js';

function hasStarted(progress) {
  return progress.index > 0 || progress.part !== null || progress.finished;
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
  else if (hasStarted(progress)) startLabel = `继续编 · 第 ${progress.index + 1} 个`;

  app.innerHTML = `
    <div class="pattern">
      <div class="pattern-plate">
        <figure class="paper" id="chart"></figure>
      </div>
      <div class="pattern-side">
        <a class="back" href="#/">← 全部花样</a>
        <header>
          <h1 class="pattern-title">${escapeHtml(pattern.title)}</h1>
          <p class="summary">${summarize(pattern)}</p>
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
        ${pattern.source ? `<p class="source-line">${escapeHtml(pattern.source)}</p>` : ''}
      </div>
    </div>`;

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
  const draw = (ids) => {
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
  };
  document.getElementById('repeat-less')?.addEventListener('click', () => setRepeats(repeats - 1));
  document.getElementById('repeat-more')?.addEventListener('click', () => setRepeats(repeats + 1));
  drawMaterials();
}
