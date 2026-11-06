import { structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { deleteDrawing, listDrawings } from './drawings.js';
import { app, embedded, escapeHtml, forgetPattern, loadIndex, loadPattern, studio } from './shared.js';
import { studioNoticeHtml } from './studio.js';

function drawingDate(savedAt) {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? '' : ` · ${date.getMonth() + 1}月${date.getDate()}日`;
}

// What this browser has kept of the patterns drawn here. Nothing at all shows if nothing was drawn.
function mineSection() {
  const { available, drawings } = listDrawings();
  if (!available) return '<section class="mine"><h2>我画的</h2><p class="hint">这个浏览器不让读本机保存，画的花样存不下来。</p></section>';
  if (!drawings.length) return '';
  return `
    <section class="mine" id="mine">
      <h2>我画的</h2>
      <p class="hint">只存在这台设备的这个浏览器里，不会上传。</p>
      <ul class="plates">
        ${drawings.map(({ id, savedAt, pattern }) => `
          <li data-drawing="${escapeHtml(id)}">
            <a class="plate-card" href="#/p/${escapeHtml(id)}">
              <figure class="paper">${renderChart(pattern, { counts: [], title: `${pattern.title}图解` })}</figure>
              <div class="plate-caption">
                <h2>${escapeHtml(pattern.title)}</h2>
                <p>${escapeHtml(pattern.difficulty)} · ${summarize(pattern)}${drawingDate(savedAt)}</p>
              </div>
            </a>
            <div class="mine-actions"><button type="button" class="ghost" data-ask>删除</button></div>
          </li>`).join('')}
      </ul>
    </section>`;
}

// Deleting asks first, on the card itself. A browser's own confirm box can be blocked inside a frame.
function watchMine() {
  document.getElementById('mine')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-drawing]');
    if (!card) return;
    const actions = card.querySelector('.mine-actions');
    const ask = () => {
      actions.innerHTML = '<span>确定删除？编到哪里的记录也一起删。</span><button type="button" class="ghost" data-yes>删除</button><button type="button" class="ghost" data-no>取消</button>';
    };
    if (event.target.matches('[data-ask]')) ask();
    if (event.target.matches('[data-no]')) actions.innerHTML = '<button type="button" class="ghost" data-ask>删除</button>';
    if (event.target.matches('[data-yes]')) {
      if (!deleteDrawing(card.dataset.drawing)) {
        actions.innerHTML = '<span class="error">没删掉，这个浏览器不让改本机保存。</span>';
        return;
      }
      forgetPattern(card.dataset.drawing);
      const section = card.closest('.mine');
      card.remove();
      if (!section.querySelector('[data-drawing]')) section.remove();
    }
  });
}

export async function showHome(isCurrent) {
  const ids = await loadIndex();
  // One file that fails to load shouldn't hide the others.
  const loaded = await Promise.allSettled(ids.map(loadPattern));
  loaded.filter((r) => r.status === 'rejected').forEach((r) => console.error(r.reason));
  if (!isCurrent()) return;
  document.title = embedded ? '梭编实验室' : '梭编花园';
  if (loaded.length > 0 && loaded.every((r) => r.status === 'rejected')) throw new Error('No patterns could be loaded');
  const patterns = loaded
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((p) => structureProblems(p).length === 0);
  app.innerHTML = `
    <div class="home">
      <header class="masthead">
        <h1>${embedded ? '梭编实验室' : '梭编花园'}</h1>
        <p>${embedded ? '只有你能打开。这里的花样还不能公开，或者还在验证。' : '少而精的梭编图解。每一张都能照着编完。'}</p>
        <div class="start-actions">${studio.sample ? '<a class="start" href="#/upload">上传图片，转成图解</a>' : ''}<a class="start" href="#/draw">画一个</a><a class="start" href="#/explore">灵感库</a></div>
        ${studioNoticeHtml()}
      </header>
      ${mineSection()}
      <ul class="plates">
        ${patterns.map((p, i) => `
          <li>
            <a class="plate-card" href="#/p/${escapeHtml(p.id)}">
              <figure class="paper">
                ${renderChart(p, { counts: [], title: `${p.title}图解` })}
                ${p.photo ? `<img class="inset" src="${escapeHtml(p.photo)}" alt="" loading="lazy">` : ''}
              </figure>
              <div class="plate-caption">
                <span class="plate-no">图版 ${String(i + 1).padStart(2, '0')}</span>
                <h2>${escapeHtml(p.title)}</h2>
                <p>${escapeHtml(p.craft)} · ${escapeHtml(p.difficulty)} · ${summarize(p)}</p>
              </div>
            </a>
          </li>`).join('')}
      </ul>
    </div>`;
  watchMine();
}
