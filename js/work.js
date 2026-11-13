import { groupChoice, handFormula, partsInWords, readElement, structureProblems } from './pattern.js';
import { drawingShare, focusBox, renderChart } from './diagram.js';
import {
  app, escapeHtml, loadPattern, readProgress, readSetting, repeatRange, saveProgress, setCleanup, showProblems,
} from './shared.js';

const LOCAL_VIEW_ABOVE = 8;
const LEAST_SHARE = 0.35;     // of the chart frame the whole drawing must cover to be the first view

function unitName(element) {
  return element.type === 'ring' ? '环' : '桥';
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

export async function showWork(id) {
  const pattern = await loadPattern(id);
  const problems = structureProblems(pattern);
  if (problems.length) {
    showProblems(pattern, id, problems);
    return;
  }
  const { elements } = pattern;
  const state = readProgress(pattern);
  let wholeView = true;
  let roomy = true;
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
  // A small pattern shows whole, unless it is a long strip that would leave most of the frame
  // empty, like an edging on a phone; that starts close up on the current element instead.
  const frame = chart.getBoundingClientRect();
  const share = drawingShare(pattern.layout.viewBox, focusBox(pattern, elements.map((e) => e.id), 0), frame.width, frame.height);
  roomy = elements.length <= LOCAL_VIEW_ABOVE && (elements.length < 3 || share >= LEAST_SHARE);
  wholeView = roomy;
  if (elements.length <= LOCAL_VIEW_ABOVE && !roomy) {
    // On a phone the frame takes the shape of a close-up, so a strip doesn't sit in a tall empty box.
    const aspects = elements.map((e, i) => {
      const box = focusBox(pattern, [e.id, elements[i - 1]?.id, elements[i + 1]?.id].filter(Boolean));
      return box[2] / box[3];
    }).sort((a, b) => a - b);
    const work = app.querySelector('.work');
    work.classList.add('is-strip');
    work.style.setProperty('--chart-aspect', aspects[Math.floor(aspects.length / 2)].toFixed(3));
  }
  const repeatIds = pattern.repeat?.elements ?? [];
  const repeatFirst = elements.findIndex((e) => e.id === repeatIds[0]);
  const repeatLast = elements.findIndex((e) => e.id === repeatIds.at(-1));
  // The number of groups set on the pattern page; extra groups are still allowed.
  const repeats = pattern.repeat ? readSetting(`repeat:${pattern.id}`, pattern.repeat.defaultTimes ?? 1) : 1;
  const repeatSize = repeatFirst >= 0 ? repeatLast - repeatFirst + 1 : 0;
  let pass = state.pass;
  let asking = state.asking && state.index === repeatLast;

  function inRepeat(index) {
    return repeatFirst >= 0 && index >= repeatFirst && index <= repeatLast;
  }

  function positionText() {
    const step = `第 ${state.index + 1} 个，共 ${elements.length} 个`;
    return inRepeat(state.index) ? `第 ${pass} 组，共 ${Math.max(pass, repeats)} 组 · ${step}` : step;
  }

  // Share of the whole piece done: the groups actually worked, out of the groups set.
  // After the repeat, pass still holds how many groups were worked.
  function doneShare() {
    const all = elements.length + (Math.max(pass, repeats) - 1) * repeatSize;
    const done = state.index + (state.index >= repeatFirst && repeatFirst >= 0 ? (pass - 1) * repeatSize : 0);
    return all ? done / all : 0;
  }

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
    toggle.hidden = roomy;
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
    document.getElementById('again').addEventListener('click', () => {
      // A new piece starts at group 1, even when the repeat starts at the first element.
      pass = 1;
      go(0);
    });
    next.textContent = '回到花样';
    prev.disabled = false;
  }

  function drawAsk() {
    const choice = groupChoice(pass, repeats);
    const leave = state.index === elements.length - 1 ? '收尾' : '接着往下编';
    position.textContent = positionText();
    bar.style.width = `${doneShare() * 100}%`;
    announce.innerHTML = `<h2 class="element-name">${choice.more ? '再编一组' : '这一段编够了'}</h2>`;
    formula.innerHTML = '';
    formula.hidden = true;
    words.textContent = `${repeatRange(pattern)} ${choice.status}`;
    total.innerHTML = `<div class="again-choice"><button type="button" id="other-choice">${choice.more ? leave : choice.again}</button></div>`;
    document.getElementById('other-choice').addEventListener('click', () => (choice.more ? leaveRepeat() : againGroup()));
    next.textContent = choice.more ? choice.again : leave;
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

    position.textContent = positionText();
    bar.style.width = `${doneShare() * 100}%`;
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
    // At the first element of a later group, back still leads to the group before.
    prev.disabled = state.index === 0 && pass === 1;
    const following = elements[state.index + 1];
    next.textContent = following ? `下一个 · ${following.id} ${unitName(following)}` : '收尾';
  }

  function draw() {
    const element = elements[state.index];
    state.pass = pass;
    state.asking = asking;
    drawChart(element);
    drawPanel(element);
    saveProgress(pattern, state);
  }

  function againGroup() {
    pass += 1;
    go(repeatFirst);
  }

  function leaveRepeat() {
    if (state.index === elements.length - 1) {
      asking = false;
      state.part = null;
      state.finished = true;
      draw();
    } else {
      go(state.index + 1);
    }
  }

  function go(index) {
    state.index = Math.max(0, Math.min(index, elements.length - 1));
    state.part = null;
    state.finished = false;
    asking = false;
    // Only going back before the repeat starts the group count again; after it, pass keeps
    // the number of groups worked, so stepping back into the repeat lands in the right group.
    if (repeatFirst < 0 || state.index < repeatFirst) pass = 1;
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
    } else if (asking) {
      if (groupChoice(pass, repeats).more) againGroup();
      else leaveRepeat();
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
    else if (state.index === repeatFirst && pass > 1) {
      // Back from the start of a later group returns to the choice after the group before.
      pass -= 1;
      state.index = repeatLast;
      state.part = null;
      asking = true;
      draw();
    } else go(state.index - 1);
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
  setCleanup(() => {
    document.removeEventListener('keydown', onKey);
    release();
  });
  draw();
}
