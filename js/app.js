import {
  checkPattern, clampProgress, formulaGroups, handFormula, partsInWords, readElement, structureProblems, summarize,
} from './pattern.js';
import { focusBox, renderChart } from './diagram.js';

const app = document.getElementById('app');
const TIER = {
  reconstruction: { name: '复原稿', meaning: '从成品照片推测的，针数不可靠，编之前要先打样。' },
  sorted: { name: '已整理', meaning: '从图解转录，还没有人独立复核。' },
  checked: { name: '已核对', meaning: '独立复核过，数字也彼此一致，但还没有人照着编过。' },
  made: { name: '已试编', meaning: '有人照着编成功了。' },
};
const LOCAL_VIEW_ABOVE = 8;
const cache = new Map();
let cleanup = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The private lab page carries its patterns inside it; the site fetches them.
const embedded = window.TATTING_PATTERNS ?? null;
(embedded ?? []).forEach((pattern) => cache.set(pattern.id, pattern));

async function loadIndex() {
  if (embedded) return embedded.map((pattern) => pattern.id);
  return (await fetch('patterns/index.json')).json();
}

async function loadPattern(id) {
  if (!cache.has(id)) {
    const response = await fetch(`patterns/${id}.json`);
    if (!response.ok) throw new Error(`Could not load ${id}`);
    cache.set(id, await response.json());
  }
  return cache.get(id);
}

function readProgress(pattern) {
  try {
    return clampProgress(JSON.parse(localStorage.getItem(`work:${pattern.id}`)), pattern.elements.length);
  } catch {
    return clampProgress(null, pattern.elements.length);
  }
}

function saveProgress(pattern, progress) {
  try {
    localStorage.setItem(`work:${pattern.id}`, JSON.stringify(progress));
  } catch {
    // Progress just won't be remembered in this browser.
  }
}

function hasStarted(progress) {
  return progress.index > 0 || progress.part !== null || progress.finished;
}

function stamp(tier) {
  return `<span class="stamp stamp-${tier}">${TIER[tier].name}</span>`;
}

function unitName(element) {
  return element.type === 'ring' ? '环' : '桥';
}

async function showHome(isCurrent) {
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
        <p>${embedded ? '只有你能打开。这里的花样还不能公开，或者还在验证。' : '少而精的梭编图解。每一张都说清楚哪里确定，哪里还是推测。'}</p>
      </header>
      <ul class="plates">
        ${patterns.map((p, i) => `
          <li>
            <a class="plate-card" href="#/p/${escapeHtml(p.id)}">
              <figure class="paper">
                ${renderChart(p, { title: `${p.title}图解` })}
                ${p.photo ? `<img class="inset" src="${escapeHtml(p.photo)}" alt="" loading="lazy">` : ''}
              </figure>
              <div class="plate-caption">
                <span class="plate-no">图版 ${String(i + 1).padStart(2, '0')}</span>
                <h2>${escapeHtml(p.title)}</h2>
                <p>${escapeHtml(p.craft)} · ${escapeHtml(p.difficulty)} · ${summarize(p)}</p>
                ${stamp(p.tier)}
              </div>
            </a>
          </li>`).join('')}
      </ul>
      <section class="tiers" aria-label="信任等级说明">
        <h2>怎么算可信</h2>
        <dl>
          ${Object.entries(TIER).map(([tier, { meaning }]) => `
            <div><dt>${stamp(tier)}</dt><dd>${meaning}</dd></div>`).join('')}
        </dl>
      </section>
    </div>`;
}

function legendFor(pattern) {
  const items = pattern.elements.flatMap((e) => readElement(e).items);
  const has = (test) => items.some(test);
  const unsure = has((i) => i.source !== 'source') || pattern.elements.some((e) => e.flip?.value && e.flip.source !== 'source');
  const entries = ['<li><span class="key key-tick"></span>一道刻度是一针</li>'];
  if (has((i) => i.kind === 'leave' || i.kind === 'join')) entries.push('<li><span class="key key-join"></span><b>,</b> 接耳</li>');
  if (has((i) => i.kind === 'deco')) entries.push('<li><span class="key key-deco"></span><b>○</b> 装饰耳</li>');
  if (pattern.elements.some((e) => e.flip?.value)) entries.push('<li><span class="key key-flip">翻</span>编之前先翻面</li>');
  if (unsure) entries.push('<li><span class="key key-unsure"></span>虚线、菱形和 <b>?</b> 是推测</li>');
  return `<ul class="legend">${entries.join('')}</ul>`;
}

function tableRows(pattern, type) {
  return formulaGroups(pattern)
    .filter((group) => group.type === type)
    .map((group) => {
      const ids = group.members.map((m) => m.id);
      const letters = group.members.map((m) => `${m.id}${m.unsure ? '<i>?</i>' : ''}`).join(' ');
      return `
        <li>
          <button type="button" class="row" data-ids="${ids.join(',')}" aria-pressed="false">
            <span class="row-letters">${letters}</span>
            <span class="row-formula">${group.estimated ? '≈ ' : ''}${group.formula}</span>
            <span class="row-total">${group.estimated ? '约 ' : ''}${group.stitches} 针</span>
          </button>
        </li>`;
    }).join('');
}

function stitchTable(pattern) {
  const section = (title, type) => {
    const rows = tableRows(pattern, type);
    return rows ? `<h3>${title}</h3><ul class="rows">${rows}</ul>` : '';
  };
  return `${section('环', 'ring')}${section('桥', 'bridge')}`;
}

function showProblems(pattern, id, problems) {
  document.title = `${pattern.title ?? id} · 梭编花园`;
  app.innerHTML = `
    <a class="back" href="#/">← 全部花样</a>
    <h1 class="pattern-title">${escapeHtml(pattern.title ?? id)}</h1>
    <p class="error">这个花样的数据有问题，暂时画不出来：${escapeHtml(problems.join('；'))}</p>`;
}

async function showPattern(id) {
  const pattern = await loadPattern(id);
  const problems = structureProblems(pattern);
  if (problems.length) {
    showProblems(pattern, id, problems);
    return;
  }
  const progress = readProgress(pattern);
  const checks = checkPattern(pattern);
  const failed = checks.some((c) => !c.ok);
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
          <div class="tier-line">${stamp(pattern.tier)}<span>${TIER[pattern.tier].meaning}</span></div>
          <p class="summary">${summarize(pattern)}</p>
          <p class="lede">${escapeHtml(pattern.summary ?? '')}</p>
        </header>
        <a class="start" id="start" href="#/p/${escapeHtml(pattern.id)}/work">${startLabel}</a>
        <section>
          <h2>针数</h2>
          <p class="hint">点一行，图上对应的部分会亮起来。</p>
          ${stitchTable(pattern)}
          ${legendFor(pattern)}
        </section>
        ${pattern.toConfirm?.length ? `
          <section class="unsure">
            <h2>还不确定的地方</h2>
            <ul>${pattern.toConfirm.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
          </section>` : ''}
        ${pattern.photo ? `
          <section>
            <h2>成品</h2>
            <img class="photo" src="${escapeHtml(pattern.photo)}" alt="${escapeHtml(pattern.title)}成品照片">
          </section>` : ''}
        <details class="checks"${failed ? ' open' : ''}>
          <summary>自动核对${failed ? '发现问题' : ''}</summary>
          <p class="hint">通过只说明数字彼此一致，不代表一定正确。</p>
          <ul>
            ${checks.map((c) => `
              <li class="${c.ok ? 'ok' : 'bad'}">
                <strong>${c.ok ? '✓' : '✗'} ${escapeHtml(c.label)}</strong>
                <span>${escapeHtml(c.detail)}</span>
              </li>`).join('')}
          </ul>
        </details>
      </div>
    </div>`;

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
      counts: ids ?? [],
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
}

function keepScreenAwake() {
  let lock = null;
  let active = true;
  const acquire = async () => {
    if (!active || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      const granted = await navigator.wakeLock.request('screen');
      lock?.release().catch(() => {});
      lock = granted;
      if (!active) lock.release().catch(() => {});
    } catch {
      // Not allowed right now; the screen just sleeps as usual.
    }
  };
  const onVisible = () => acquire();
  document.addEventListener('visibilitychange', onVisible);
  acquire();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
  };
}

async function showWork(id) {
  const pattern = await loadPattern(id);
  const problems = structureProblems(pattern);
  if (problems.length) {
    showProblems(pattern, id, problems);
    return;
  }
  const { elements } = pattern;
  const state = readProgress(pattern);
  let wholeView = elements.length <= LOCAL_VIEW_ABOVE;
  document.title = `编 ${pattern.title} · 梭编花园`;

  app.innerHTML = `
    <div class="work">
      <div class="work-chart">
        <figure class="paper" id="chart"></figure>
        <button type="button" class="view-toggle" id="view-toggle"></button>
      </div>
      <div class="work-panel">
        <div class="work-top">
          <a class="back" href="#/p/${escapeHtml(pattern.id)}">← 退出</a>
          <details class="jump" id="jump">
            <summary id="position"></summary>
            <div class="jump-list">
              ${elements.map((e, i) => `<button type="button" data-jump="${i}" aria-label="跳到 ${e.id} ${unitName(e)}">${e.id}</button>`).join('')}
            </div>
          </details>
          ${stamp(pattern.tier)}
        </div>
        <div class="bar" aria-hidden="true"><span id="bar"></span></div>
        <div class="work-content" id="content">
          <div id="announce" aria-live="polite"></div>
          <div class="formula" id="formula" role="group"></div>
          <p class="words" id="words" aria-live="polite"></p>
          <p class="total" id="total"></p>
        </div>
        <div class="work-nav">
          <button type="button" id="prev" class="ghost">上一个</button>
          <button type="button" id="next" class="primary"></button>
        </div>
      </div>
    </div>`;

  const chart = document.getElementById('chart');
  const announce = document.getElementById('announce');
  const formula = document.getElementById('formula');
  const words = document.getElementById('words');
  const total = document.getElementById('total');
  const position = document.getElementById('position');
  const bar = document.getElementById('bar');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const toggle = document.getElementById('view-toggle');
  const jump = document.getElementById('jump');

  function flipLine(element) {
    if (!element.flip) return '';
    if (element.flip.value) {
      const unsure = element.flip.source !== 'source';
      return `<p class="flip${unsure ? ' flip-unsure' : ''}">先翻面${unsure ? '（推测）' : ''}</p>`;
    }
    return element.flip.source === 'source' ? '' : '<p class="flip-quiet">不翻面（推测）</p>';
  }

  function drawChart(element) {
    if (state.finished) {
      chart.innerHTML = renderChart(pattern, { title: `${pattern.title}图解，已编完` });
      toggle.hidden = true;
      return;
    }
    const parts = partsInWords(pattern, element);
    const selected = state.part === null ? null : parts[state.part] ?? null;
    const earlier = elements.slice(0, state.index).map((e) => e.id);
    const targets = parts.filter((p) => p.target).map((p) => p.target);
    const neighbours = [elements[state.index - 1]?.id, elements[state.index + 1]?.id].filter(Boolean);
    const options = {
      current: element.id,
      done: [...earlier, ...(selected?.target ? [selected.target] : [])],
      reached: selected ? selected.to : 0,
      currentItem: selected ? selected.index : null,
      counts: [element.id],
      title: `${pattern.title}图解，当前在 ${element.id} ${unitName(element)}`,
    };
    if (!wholeView) options.viewBox = focusBox(pattern, [element.id, ...targets, ...neighbours]);
    chart.innerHTML = renderChart(pattern, options);
    toggle.hidden = elements.length <= LOCAL_VIEW_ABOVE;
    toggle.textContent = wholeView ? '看局部' : '看全图';
  }

  function drawWords(element) {
    const parts = partsInWords(pattern, element);
    const selected = state.part === null ? null : parts[state.part] ?? null;
    words.textContent = selected ? selected.words : '点数字可以逐段看。';
    formula.querySelectorAll('[data-part]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.part) === selected?.index));
    });
  }

  function drawFinish() {
    position.textContent = `全部 ${elements.length} 个都编完了`;
    bar.style.width = '100%';
    announce.innerHTML = '<h2 class="element-name">收尾</h2>';
    formula.innerHTML = '';
    formula.hidden = true;
    words.textContent = pattern.finish ?? '把线头收好。';
    total.innerHTML = '<button type="button" class="again" id="again">重新开始</button>';
    document.getElementById('again').addEventListener('click', () => go(0));
    next.textContent = '回到花样';
    prev.disabled = false;
  }

  function drawPanel(element) {
    if (state.finished) {
      drawFinish();
      return;
    }
    const parts = partsInWords(pattern, element);
    const read = readElement(element);
    const join = read.items.filter((i) => i.kind === 'leave' || i.kind === 'join').length;
    const deco = read.items.filter((i) => i.kind === 'deco').length;
    const counts = [`共 ${read.stitches} 针`, join ? `${join} 个接耳` : '', deco ? `${deco} 个装饰耳` : ''].filter(Boolean).join('，');

    position.textContent = `第 ${state.index + 1} 个，共 ${elements.length} 个`;
    bar.style.width = `${(state.index / elements.length) * 100}%`;
    announce.innerHTML = `${flipLine(element)}<h2 class="element-name"><b>${element.id}</b> ${unitName(element)}</h2>`;
    formula.hidden = false;
    formula.setAttribute('aria-label', `${element.id} ${unitName(element)}的针数，${handFormula(element)}`);
    formula.innerHTML = parts.map((p) => `<button type="button" class="part part-${p.kind}${p.source === 'source' ? '' : ' part-unsure'}" data-part="${p.index}" aria-pressed="false" aria-label="${escapeHtml(p.words)}">${p.text}</button>`).join('');
    formula.querySelectorAll('[data-part]').forEach((button) => {
      button.addEventListener('click', () => {
        const part = Number(button.dataset.part);
        state.part = state.part === part ? null : part;
        drawChart(element);
        drawWords(element);
        saveProgress(pattern, state);
      });
    });
    drawWords(element);
    total.textContent = `${counts}。${element.type === 'ring' ? '编完拉紧成环。' : ''}`;
    prev.disabled = state.index === 0;
    const following = elements[state.index + 1];
    next.textContent = following ? `下一个 · ${following.id} ${unitName(following)}` : '收尾';
  }

  function draw() {
    const element = elements[state.index];
    drawChart(element);
    drawPanel(element);
    saveProgress(pattern, state);
  }

  function go(index) {
    state.index = Math.max(0, Math.min(index, elements.length - 1));
    state.part = null;
    state.finished = false;
    jump.open = false;
    draw();
  }

  function forward() {
    if (state.finished) {
      location.hash = `#/p/${pattern.id}`;
    } else if (state.index === elements.length - 1) {
      state.part = null;
      state.finished = true;
      draw();
    } else {
      go(state.index + 1);
    }
  }

  function back() {
    if (state.finished) go(elements.length - 1);
    else go(state.index - 1);
  }

  next.addEventListener('click', forward);
  prev.addEventListener('click', back);
  toggle.addEventListener('click', () => {
    wholeView = !wholeView;
    draw();
  });
  jump.querySelectorAll('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => go(Number(button.dataset.jump)));
  });
  const onKey = (event) => {
    if (event.key === 'ArrowRight') forward();
    if (event.key === 'ArrowLeft' && !prev.disabled) back();
  };
  document.addEventListener('keydown', onKey);
  const release = keepScreenAwake();
  cleanup = () => {
    document.removeEventListener('keydown', onKey);
    release();
  };
  draw();
}

let routeCount = 0;

async function route() {
  routeCount += 1;
  const thisRoute = routeCount;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  window.scrollTo(0, 0);
  const match = location.hash.match(/^#\/p\/([\w-]+)(\/work)?$/);
  document.body.classList.toggle('in-work', Boolean(match?.[2]));
  try {
    // Fetch first, so a page that finishes loading late can't draw over a newer one.
    // A home page failure is sorted out per pattern inside showHome.
    if (match) await loadPattern(match[1]);
    if (thisRoute !== routeCount) return;
    if (match?.[2]) await showWork(match[1]);
    else if (match) await showPattern(match[1]);
    else await showHome(() => thisRoute === routeCount);
  } catch (error) {
    console.error(error);
    if (thisRoute !== routeCount) return;
    app.innerHTML = '<p class="error">这一页没打开，<a href="#/">回到全部花样</a>。</p>';
  }
}

window.addEventListener('hashchange', route);
route();
