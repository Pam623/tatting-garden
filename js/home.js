import { structureProblems, summarize } from './pattern.js';
import { renderChart } from './diagram.js';
import { renderFinished } from './finished.js';
import { deleteDrawing, listDrawings } from './drawings.js';
import { loadExplore, readWishes, saveWishes } from './explore.js';
import { resumeList, wishedCards } from './resume.js';
import {
  app, embedded, escapeHtml, forgetPattern, loadIndex, loadPattern, readStoredProgress, studio,
} from './shared.js';
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

// Shown first on the home page: where the thread was left, and what was wished for. Nothing when neither.
function pickUpSection(resumes, wished) {
  if (!resumes.length && !wished.length) return '';
  const resumeHtml = resumes.length ? `
    <h2>接着编</h2>
    <ul class="resume-list">
      ${resumes.map(({ pattern, index }) => `
        <li><a class="start resume" href="#/p/${escapeHtml(pattern.id)}/work">继续编 · ${escapeHtml(pattern.title)} · 第 ${index + 1} 个</a></li>`).join('')}
    </ul>` : '';
  const wishHtml = wished.length ? `
    <div id="wished">
      <h2>想编的</h2>
      <ul class="wished-list">
        ${wished.map((card) => `
          <li data-wished="${escapeHtml(card.id)}">
            <a href="#/explore">${escapeHtml(card.title)}</a>
            <button type="button" class="ghost" data-unwish>取消</button>
          </li>`).join('')}
      </ul>
    </div>` : '';
  return `<section class="pick-up" id="pick-up">${resumeHtml}${wishHtml}</section>`;
}

function watchPickUp() {
  document.getElementById('pick-up')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-wished]');
    if (!item || !event.target.matches('[data-unwish]')) return;
    if (!saveWishes(readWishes().filter((id) => id !== item.dataset.wished))) {
      event.target.outerHTML = '<span class="error">没取消掉，这个浏览器不让改本机保存。</span>';
      return;
    }
    const list = item.closest('#wished');
    item.remove();
    if (!list.querySelector('[data-wished]')) list.remove();
    const section = document.getElementById('pick-up');
    if (!section.querySelector('li')) section.remove();
  });
}

async function wishedForHome() {
  const wishes = readWishes();
  if (!wishes.length || embedded) return [];
  try {
    return wishedCards(await loadExplore(), wishes);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function progressNote(pattern) {
  const found = resumeList([pattern], readStoredProgress)[0];
  return found ? ` · 编到第 ${found.index + 1} 个` : '';
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
  const drawn = listDrawings().drawings.map((d) => d.pattern);
  const resumes = resumeList([...drawn, ...patterns], readStoredProgress);
  const wished = await wishedForHome();
  if (!isCurrent()) return;
  app.innerHTML = `
    <div class="home">
      <header class="masthead">
        <h1>${embedded ? '梭编实验室' : '梭编花园'}</h1>
        <p>${embedded ? '只有你能打开。这里的花样还不能公开，或者还在验证。' : '少而精的梭编图解。每一张都能照着编完。'}</p>
        <div class="start-actions">${studio.sample ? '<a class="start" href="#/upload">上传图片，转成图解</a>' : ''}<a class="start" href="#/draw">画一个</a>${embedded ? '' : '<a class="start" href="#/explore">灵感库</a>'}</div>
        ${studioNoticeHtml()}
      </header>
      ${pickUpSection(resumes, wished)}
      ${mineSection()}
      <ul class="plates">
        ${patterns.map((p, i) => `
          <li>
            <a class="plate-card" href="#/p/${escapeHtml(p.id)}">
              <figure class="paper">
                ${renderChart(p, { counts: [], title: `${p.title}图解` })}
              </figure>
              <div class="plate-caption">
                ${p.photo ? `<img class="inset" src="${escapeHtml(p.photo)}" alt="" loading="lazy">` : `<span class="inset finished-inset">${renderFinished(p)}</span>`}
                <span class="plate-no">图版 ${String(i + 1).padStart(2, '0')}</span>
                <h2>${escapeHtml(p.title)}</h2>
                <p>${escapeHtml(p.craft)} · ${escapeHtml(p.difficulty)} · ${summarize(p)}${progressNote(p)}</p>
              </div>
            </a>
          </li>`).join('')}
      </ul>
    </div>`;
  watchMine();
  watchPickUp();
}
