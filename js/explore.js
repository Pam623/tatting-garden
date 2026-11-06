import { renderFinished } from './finished.js';
import { app, escapeHtml, loadPattern } from './shared.js';

// The inspiration library: old-book pages worth tatting. Each card is a crop of a public-domain page.
// Cards with a converted pattern link to the step-by-step chart; the rest can be wished for,
// and wishes stay on this device so Pam can tell the team which one to convert next.
const WISH_KEY = 'tatting.wishes';

export function readWishes() {
  try {
    const list = JSON.parse(localStorage.getItem(WISH_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveWishes(list) {
  try {
    localStorage.setItem(WISH_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export async function loadExplore() {
  const response = await fetch('explore/index.json');
  if (!response.ok) throw new Error('Could not load the inspiration library');
  return response.json();
}

function pageText(card) {
  return typeof card.page === 'number' ? `第 ${card.page} 页` : card.page ?? '';
}

function cardHtml(card, patternTitles, wished) {
  const doable = Array.isArray(card.patterns) && card.patterns.length > 0;
  const action = doable
    ? `<div class="explore-actions"><div class="finished-row">${card.patterns.map((id) => (patternTitles.get(id) ? `<span>${renderFinished(patternTitles.get(id))}</span>` : '')).join('')}</div>${card.patterns.map((id) => `<a class="start" href="#/p/${escapeHtml(id)}">照着编 · ${escapeHtml(patternTitles.get(id)?.title ?? id)}</a>`).join('')}</div>`
    : `<div class="explore-actions">${wished
      ? '<span class="wished">已记下</span><button type="button" class="ghost" data-unwish>取消</button>'
      : '<button type="button" class="wish" data-wish>想编这个</button>'}</div>`;
  return `
    <li class="explore-card" data-card="${escapeHtml(card.id)}">
      <figure class="paper"><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.title)}" loading="lazy"></figure>
      <div class="plate-caption">
        <span class="plate-no">${escapeHtml(card.kind)}</span>
        <h2>${escapeHtml(card.title)}</h2>
        <p>${escapeHtml(card.note)}</p>
        <p class="hint">${escapeHtml(card.book)}，${card.year} 年，${escapeHtml(pageText(card))} · <a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源页面</a></p>
        ${action}
      </div>
    </li>`;
}

function wishSection(cards, wishes) {
  const picked = cards.filter((c) => wishes.includes(c.id));
  if (!picked.length) return '';
  return `
    <section class="wish-list" id="wish-list">
      <h2>已记下 ${picked.length} 个</h2>
      <p class="hint">只存在这台设备的这个浏览器里。想好了，告诉我们要做哪个。</p>
      <ul>${picked.map((c) => `<li>${escapeHtml(c.title)}（${escapeHtml(c.book)}，${escapeHtml(pageText(c))}）</li>`).join('')}</ul>
    </section>`;
}

export async function showExplore() {
  const cards = await loadExplore();
  const ids = [...new Set(cards.flatMap((c) => c.patterns ?? []))];
  const titles = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      titles.set(id, await loadPattern(id));
    } catch (error) {
      console.error(error);
    }
  }));
  const wishes = readWishes();
  document.title = '梭编花园 · 灵感库';
  app.innerHTML = `
    <div class="home explore">
      <header class="masthead">
        <h1>灵感库</h1>
        <p>从古书里挑出来的花样。能照着编的，点「照着编」；还想编别的，点「想编这个」记下来。</p>
        <p class="hint"><a href="#/">回到全部花样</a></p>
      </header>
      <div id="wish-slot">${wishSection(cards, wishes)}</div>
      <ul class="plates explore-grid">
        ${cards.map((c) => cardHtml(c, titles, wishes.includes(c.id))).join('')}
      </ul>
    </div>`;
  app.querySelector('.explore-grid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-card]');
    if (!card) return;
    const id = card.dataset.card;
    const now = readWishes();
    let next = now;
    if (event.target.matches('[data-wish]')) next = [...new Set([...now, id])];
    else if (event.target.matches('[data-unwish]')) next = now.filter((w) => w !== id);
    else return;
    const actions = card.querySelector('.explore-actions');
    if (!saveWishes(next)) {
      actions.innerHTML = '<span class="error">没记下，这个浏览器不让存到本机。</span>';
      return;
    }
    const data = cards.find((c) => c.id === id);
    const html = cardHtml(data, titles, next.includes(id));
    const holder = document.createElement('div');
    holder.innerHTML = html;
    actions.replaceWith(holder.querySelector('.explore-actions'));
    document.getElementById('wish-slot').innerHTML = wishSection(cards, next);
  });
}
