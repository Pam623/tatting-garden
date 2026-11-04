import {
  clampProgress, formulaGroups, handFormula, partsInWords, readElement, structureProblems, summarize,
} from './pattern.js';
import { focusBox, renderChart } from './diagram.js';
import { estimateThread, THREAD_SIZES } from './materials.js';
import { convertImage } from './convert.js';

const app = document.getElementById('app');
const LOCAL_VIEW_ABOVE = 8;
const cache = new Map();
let cleanup = null;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The private lab page carries its patterns inside it; the site fetches them.
const embedded = window.TATTING_PATTERNS ?? null;
(embedded ?? []).forEach((pattern) => cache.set(pattern.id, pattern));

// Only the private lab page, running as an artifact, has `claude`. The public site never does.
let sample = null;
let db = null;
const savedIds = new Set();

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function loadSaved() {
  try {
    const snap = await withTimeout(db.collection('studio').get(), 10000);
    (snap?.docs ?? []).forEach((doc) => {
      const row = doc.data?.();
      if (!row?.pattern?.id || cache.has(row.pattern.id)) return;
      cache.set(row.pattern.id, row.pattern);
      savedIds.add(row.pattern.id);
    });
  } catch (error) {
    console.error(error);
  }
}

async function startStudio() {
  if (!embedded || typeof window.claude?.use !== 'function') return;
  try {
    sample = await withTimeout(window.claude.use('sample'), 10000);
    db = await withTimeout(window.claude.use('db'), 10000);
  } catch {
    sample = sample ?? null;
    db = null;
  }
  if (db) await loadSaved();
}

const studioReady = startStudio();

async function loadIndex() {
  if (embedded) return [...embedded.map((pattern) => pattern.id), ...savedIds];
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

function readSetting(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // The choice just won't be remembered in this browser.
  }
}

function repeatRange(pattern) {
  const ids = pattern.repeat?.elements;
  return ids?.length ? `${ids[0]}–${ids.at(-1)}` : '';
}

function materialsPanel(pattern, size, repeats) {
  const thread = estimateThread(pattern, { size, repeats });
  const metres = (cm) => (cm / 100).toFixed(1);
  const sizes = THREAD_SIZES.map((value) => `
    <label><input type="radio" name="size" value="${value}"${value === size ? ' checked' : ''}><span>${value} 号</span></label>`).join('');
  return `
    <h2>需要</h2>
    <ul>
      <li>${thread.ballNeeded ? '1 个梭子 + 1 团线（或 2 个梭子）' : '1 个梭子'}</li>
      <li>梭子线约 ${metres(thread.shuttleCm)} 米${thread.ballNeeded ? `，线团约 ${metres(thread.ballCm)} 米` : ''}</li>
      ${pattern.threadNote ? `<li>${escapeHtml(pattern.threadNote)}</li>` : ''}
    </ul>
    <div class="size-pick" role="radiogroup" aria-label="线的粗细">${sizes}</div>`;
}

function hasStarted(progress) {
  return progress.index > 0 || progress.part !== null || progress.finished;
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
        <p>${embedded ? '只有你能打开。这里的花样还不能公开，或者还在验证。' : '少而精的梭编图解。每一张都能照着编完。'}</p>
        ${sample ? '<a class="start" href="#/upload">上传图片，转成图解</a>' : ''}
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

function legendFor(pattern) {
  const items = pattern.elements.flatMap((e) => readElement(e).items);
  const has = (test) => items.some(test);
  const entries = [];
  if (has((i) => i.kind === 'leave' || i.kind === 'join')) entries.push('<li><span class="key key-join"></span><b>,</b> 接耳</li>');
  if (has((i) => i.kind === 'deco')) entries.push('<li><span class="key key-deco"></span><b>·</b> 装饰耳</li>');
  if (pattern.elements.some((e) => e.flip?.value)) entries.push('<li><span class="key key-flip">翻</span>编之前先翻面</li>');
  return `<ul class="legend">${entries.join('')}</ul>`;
}

function tableRows(pattern, type) {
  return formulaGroups(pattern)
    .filter((group) => group.type === type)
    .map((group) => {
      const ids = group.members.map((m) => m.id);
      const letters = group.members.map((m) => m.id).join(' ');
      return `
        <li>
          <button type="button" class="row" data-ids="${ids.join(',')}" aria-pressed="false">
            <span class="row-letters">${letters}</span>
            <span class="row-formula">${group.formula}</span>
            <span class="row-total">${group.stitches} 针</span>
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
        ${db && savedIds.has(pattern.id) ? '<button type="button" class="ghost publish" id="publish">发布到网站</button>' : ''}
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
      await db.collection('studio').doc(pattern.id).update({ publish: true });
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

const SAMPLE_MESSAGES = {
  rate_limited: '用得太频繁了，请等一会儿再试。',
  not_granted: '这个页面还没有得到使用权限，请先允许后再试。',
};

async function showUpload() {
  document.title = '上传 · 梭编实验室';
  if (!sample) {
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
        ${drawable && problems.length === 0 && db ? '<button type="button" class="primary" id="save">保存</button>' : ''}
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
        await db.collection('studio').doc(pattern.id).set({ pattern, publish: false, savedAt: Date.now() });
        cache.set(pattern.id, pattern);
        savedIds.add(pattern.id);
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
      const outcome = await convertImage(blob, sample, { onProgress: (text) => { if (mine === run) status.textContent = text; } });
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
  const repeatIds = pattern.repeat?.elements ?? [];
  const repeatFirst = elements.findIndex((e) => e.id === repeatIds[0]);
  const repeatLast = elements.findIndex((e) => e.id === repeatIds.at(-1));
  let pass = 1;
  let asking = false;

  function flipLine(element) {
    if (!element.flip) return '';
    return element.flip.value ? '<p class="flip">先翻面</p>' : '';
  }

  function drawChart(element) {
    if (state.finished) {
      chart.innerHTML = renderChart(pattern, { title: `${pattern.title}图解，已编完` });
      toggle.hidden = true;
      return;
    }
    const parts = partsInWords(pattern, element, { pass });
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
    const parts = partsInWords(pattern, element, { pass });
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

  function drawAsk() {
    position.textContent = `第 ${state.index + 1} 个，共 ${elements.length} 个`;
    announce.innerHTML = '<h2 class="element-name">再编一组？</h2>';
    formula.innerHTML = '';
    formula.hidden = true;
    words.textContent = `${repeatRange(pattern)} 已经编完第 ${pass} 组。`;
    total.innerHTML = '<div class="again-choice"><button type="button" id="again-group">再来一组</button></div>';
    document.getElementById('again-group').addEventListener('click', () => {
      pass += 1;
      go(repeatFirst);
    });
    next.textContent = state.index === elements.length - 1 ? '收尾' : '接着往下编';
    prev.disabled = false;
  }

  function drawPanel(element) {
    if (asking) {
      drawAsk();
      return;
    }
    if (state.finished) {
      drawFinish();
      return;
    }
    const parts = partsInWords(pattern, element, { pass });
    const read = readElement(element);
    const join = read.items.filter((i) => i.kind === 'leave' || i.kind === 'join').length;
    const deco = read.items.filter((i) => i.kind === 'deco').length;
    const counts = [`共 ${read.stitches} 针`, join ? `${join} 个接耳` : '', deco ? `${deco} 个装饰耳` : ''].filter(Boolean).join('，');

    position.textContent = `第 ${state.index + 1} 个，共 ${elements.length} 个`;
    bar.style.width = `${(state.index / elements.length) * 100}%`;
    announce.innerHTML = `${flipLine(element)}<h2 class="element-name"><b>${element.id}</b> ${unitName(element)}</h2>`;
    formula.hidden = false;
    formula.setAttribute('aria-label', `${element.id} ${unitName(element)}的针数，${handFormula(element)}`);
    formula.innerHTML = parts.map((p) => `<button type="button" class="part part-${p.kind}" data-part="${p.index}" aria-pressed="false" aria-label="${escapeHtml(p.words)}">${p.text}</button>`).join('');
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
    asking = false;
    if (!repeatIds.includes(elements[state.index].id)) pass = 1;
    jump.open = false;
    draw();
  }

  function forward() {
    if (state.finished) {
      location.hash = `#/p/${pattern.id}`;
    } else if (state.index === repeatLast && !asking) {
      state.part = null;
      asking = true;
      draw();
    } else if (state.index === elements.length - 1) {
      asking = false;
      state.part = null;
      state.finished = true;
      draw();
    } else {
      go(state.index + 1);
    }
  }

  function back() {
    if (asking) {
      asking = false;
      draw();
    } else if (state.finished) go(elements.length - 1);
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
  await studioReady;
  if (thisRoute !== routeCount) return;
  const match = location.hash.match(/^#\/p\/([\w-]+)(\/work)?$/);
  document.body.classList.toggle('in-work', Boolean(match?.[2]));
  try {
    // Fetch first, so a page that finishes loading late can't draw over a newer one.
    // A home page failure is sorted out per pattern inside showHome.
    if (match) await loadPattern(match[1]);
    if (thisRoute !== routeCount) return;
    if (location.hash === '#/upload') await showUpload();
    else if (match?.[2]) await showWork(match[1]);
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
