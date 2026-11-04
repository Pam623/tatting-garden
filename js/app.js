import { buildSteps, describeStep, checkPattern, formulaGroups, structureProblems } from './pattern.js';
import { renderChart } from './diagram.js';

const app = document.getElementById('app');
const TIER = {
  reconstruction: '复原稿',
  sorted: '已整理',
  checked: '已核对',
  made: '已试编',
};
const cache = new Map();
let cleanup = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadPattern(id) {
  if (!cache.has(id)) {
    const response = await fetch(`patterns/${id}.json`);
    if (!response.ok) throw new Error(`Could not load ${id}`);
    cache.set(id, await response.json());
  }
  return cache.get(id);
}

function readProgress(id) {
  try {
    return Number(localStorage.getItem(`progress:${id}`)) || 0;
  } catch {
    return 0;
  }
}

function saveProgress(id, index) {
  try {
    localStorage.setItem(`progress:${id}`, String(index));
  } catch {
    // Progress just won't be remembered in this browser.
  }
}

async function showHome() {
  document.title = '梭编花园';
  const ids = await (await fetch('patterns/index.json')).json();
  const patterns = await Promise.all(ids.map(loadPattern));
  app.innerHTML = `
    <header class="site-head">
      <h1>梭编花园</h1>
      <p>少而精，每一个都能跟着编。</p>
    </header>
    <ul class="gallery">
      ${patterns.filter((p) => structureProblems(p).length === 0).map((p) => `
        <li>
          <a class="card" href="#/p/${escapeHtml(p.id)}">
            <div class="note">${renderChart(p, { title: p.title })}</div>
            <div class="card-text">
              <h2>${escapeHtml(p.title)}</h2>
              <p>${escapeHtml(p.craft)} · ${escapeHtml(p.difficulty)}</p>
              <span class="badge">${TIER[p.tier]}</span>
            </div>
          </a>
        </li>`).join('')}
    </ul>`;
}

function formulaRows(pattern) {
  return formulaGroups(pattern).map((group) => `
    <tr>
      <th scope="row">${escapeHtml(group.ids.join('、'))}</th>
      <td class="formula">${group.formula}</td>
      <td class="num">${group.stitches}</td>
    </tr>`).join('');
}

async function showPattern(id) {
  const pattern = await loadPattern(id);
  const problems = structureProblems(pattern);
  if (problems.length) {
    document.title = `${pattern.title ?? id} · 梭编花园`;
    app.innerHTML = `
      <a class="back" href="#/">← 全部花样</a>
      <h1>${escapeHtml(pattern.title ?? id)}</h1>
      <p class="error">这个花样的数据有问题，暂时画不出来：${escapeHtml(problems.join('；'))}</p>`;
    return;
  }
  const steps = buildSteps(pattern);
  let index = Math.min(readProgress(id), steps.length - 1);
  document.title = `${pattern.title} · 梭编花园`;

  app.innerHTML = `
    <a class="back" href="#/">← 全部花样</a>
    <header class="pattern-head">
      <h1>${escapeHtml(pattern.title)}</h1>
      <span class="badge">${TIER[pattern.tier]}</span>
      <p>${escapeHtml(pattern.summary)}</p>
    </header>
    <div class="workspace">
      <div class="note note-large" id="chart"></div>
      <section class="stepper" aria-label="逐步跟编">
        <p class="where" id="where"></p>
        <h2 id="step-title" aria-live="polite"></h2>
        <p class="detail" id="step-detail"></p>
        <div class="rings-nav" id="rings-nav">
          ${pattern.elements.map((element, i) => `<button type="button" data-ring="${i}" aria-label="跳到 ${escapeHtml(element.id)} 环">${escapeHtml(element.id)}</button>`).join('')}
        </div>
        <div class="controls">
          <button type="button" id="prev" class="ghost">上一步</button>
          <button type="button" id="next" class="primary">下一步</button>
        </div>
      </section>
    </div>
    <div class="reference">
      <section>
        <h2>针数表</h2>
        <table>
          <thead><tr><th scope="col">环</th><th scope="col">针数</th><th scope="col" class="num">合计</th></tr></thead>
          <tbody>${formulaRows(pattern)}</tbody>
        </table>
        <ul class="legend">
          <li>● 接耳</li>
          <li>○ 装饰耳</li>
        </ul>
      </section>
      <section>
        <h2>自动核对</h2>
        <ul class="checks">
          ${checkPattern(pattern).map((c) => `
            <li class="${c.ok ? 'ok' : 'bad'}">
              <strong>${c.ok ? '✓' : '✗'} ${escapeHtml(c.label)}</strong>
              <span>${escapeHtml(c.detail)}</span>
            </li>`).join('')}
        </ul>
        ${pattern.toConfirm?.length ? `
          <h3>图上没画、等你确认</h3>
          <ul class="to-confirm">${pattern.toConfirm.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      </section>
      ${pattern.photo ? `
        <section>
          <h2>成品</h2>
          <img class="photo" src="${escapeHtml(pattern.photo)}" alt="${escapeHtml(pattern.title)}成品照片">
        </section>` : ''}
    </div>`;

  const chart = document.getElementById('chart');
  const where = document.getElementById('where');
  const title = document.getElementById('step-title');
  const detail = document.getElementById('step-detail');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const ringButtons = [...document.querySelectorAll('[data-ring]')];

  function draw() {
    const step = steps[index];
    const text = describeStep(pattern, step);
    chart.innerHTML = renderChart(pattern, {
      current: step.elementId,
      done: pattern.elements.slice(0, step.elementIndex).map((e) => e.id),
      reached: step.at,
      currentItem: step.itemIndex,
      counts: [step.elementId],
      title: `${pattern.title}图解，当前在 ${step.elementId}`,
    });
    where.textContent = `${step.elementId} 环 · 第 ${index + 1} 步，共 ${steps.length} 步`;
    title.textContent = text.title;
    detail.textContent = text.detail;
    prev.disabled = index === 0;
    next.disabled = index === steps.length - 1;
    ringButtons.forEach((button, i) => {
      const current = i === step.elementIndex;
      button.classList.toggle('current', current);
      if (current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    saveProgress(id, index);
  }

  function go(to) {
    index = Math.max(0, Math.min(to, steps.length - 1));
    draw();
  }

  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  ringButtons.forEach((button, i) => {
    button.addEventListener('click', () => go(steps.findIndex((s) => s.elementIndex === i)));
  });
  const onKey = (event) => {
    if (event.key === 'ArrowRight') go(index + 1);
    if (event.key === 'ArrowLeft') go(index - 1);
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => document.removeEventListener('keydown', onKey);
  draw();
}

async function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  window.scrollTo(0, 0);
  const match = location.hash.match(/^#\/p\/([\w-]+)$/);
  try {
    if (match) await showPattern(match[1]);
    else await showHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = '<p class="error">这一页没打开，<a href="#/">回到全部花样</a>。</p>';
  }
}

window.addEventListener('hashchange', route);
route();
