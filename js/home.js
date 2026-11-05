import { structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { app, embedded, escapeHtml, loadIndex, loadPattern, studio } from './shared.js';
import { studioNoticeHtml } from './studio.js';

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
        ${studio.sample ? '<div class="start-actions"><a class="start" href="#/upload">上传图片，转成图解</a><a class="start" href="#/draw">画一个</a></div>' : ''}
        ${studioNoticeHtml()}
      </header>
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
}
