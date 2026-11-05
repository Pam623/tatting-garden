// The drawing page: draw an outline, get a chart from js/trace-design.js. Nothing leaves the browser.
import { renderChart } from './diagram.js';
import { deleteDrawing, listDrawings, newDrawingId, saveDrawing } from './drawings.js';
import { THREAD_SIZES } from './materials.js';
import { summarize } from './pattern.js';
import {
  app, escapeHtml, forgetPattern, legendFor, materialsPanel, readSetting, rememberPattern, saveSetting, setCleanup, stitchTable,
} from './shared.js';
import { startSketchPad } from './sketch-pad.js';
import { traceDesign } from './trace-design.js';

// A saved drawing has no file on the site, so its pattern has to be known before its page opens.
export function rememberDrawings() {
  listDrawings().drawings.forEach(({ pattern }) => rememberPattern(pattern));
}

export function showDraw() {
  document.title = '画一个 · 梭编花园';
  app.innerHTML = `
    <div class="upload">
      <a class="back" href="#/">← 全部花样</a>
      <div id="board">
        <h1 class="pattern-title">画一个</h1>
        <p class="lede">画一个简单的封闭轮廓，比如爱心、星星或蝴蝶。线条不用好看，看得出形状就行。</p>
        <canvas class="sketch-pad" id="pad" role="img" aria-label="画板"></canvas>
        <div class="pad-tools">
          <button type="button" class="ghost" id="undo" disabled>撤销</button>
          <button type="button" class="ghost" id="clear" disabled>清空</button>
          <label class="pad-mirror"><input type="checkbox" id="mirror" checked> 左右对称</label>
        </div>
        <p class="hint" id="mirror-note" hidden>关掉后画的时候不镜像。图解还是左右对称的，所以要自己画完整的两边。</p>
        <button type="button" class="primary convert" id="design" disabled>变成图解</button>
        <p class="hint" id="status" role="status" aria-live="polite"></p>
        <p class="error" id="refusal" role="alert" hidden></p>
      </div>
      <div id="result" hidden></div>
    </div>`;
  const board = document.getElementById('board');
  const result = document.getElementById('result');
  const design = document.getElementById('design');
  const undo = document.getElementById('undo');
  const clear = document.getElementById('clear');
  const mirror = document.getElementById('mirror');
  const status = document.getElementById('status');
  const refusal = document.getElementById('refusal');
  let timer = null;

  const setRefusal = (text) => {
    refusal.textContent = text;
    refusal.hidden = !text;
  };
  const pad = startSketchPad(document.getElementById('pad'), {
    onChange() {
      setRefusal('');
      const empty = pad.isEmpty();
      design.disabled = empty;
      undo.disabled = empty;
      clear.disabled = empty;
    },
  });
  setCleanup(() => {
    clearTimeout(timer);
    pad.stop();
  });
  undo.addEventListener('click', () => pad.undo());
  clear.addEventListener('click', () => pad.clear());
  mirror.addEventListener('change', () => {
    pad.setMirror(mirror.checked);
    document.getElementById('mirror-note').hidden = mirror.checked;
  });

  const backToBoard = () => {
    result.hidden = true;
    result.innerHTML = '';
    board.hidden = false;
    pad.refresh();
    window.scrollTo(0, 0);
  };

  const showResult = (pattern, saved) => {
    let size = readSetting('size', 20);
    if (!THREAD_SIZES.includes(size)) size = 20;
    result.innerHTML = `
      <h1 class="pattern-title">${escapeHtml(pattern.title)}</h1>
      <p class="summary">${escapeHtml(pattern.difficulty)} · ${summarize(pattern)}</p>
      <figure class="paper" id="chart">${renderChart(pattern, { title: `${pattern.title}图解` })}</figure>
      <div class="upload-actions">
        <a class="start" href="#/p/${escapeHtml(pattern.id)}/work">开始编</a>
        <button type="button" class="ghost" id="redraw">重画</button>
      </div>
      ${saved
    ? '<p class="hint">已存在这台设备上，首页“我画的”里能找到。不会上传。点“重画”会丢掉这一张，回到刚才的草图。</p>'
    : '<p class="error" role="alert">这台设备存不下（可能空间满了，或者浏览器不让存）。现在可以照着编，但关掉页面就没了。</p>'}
      <section class="materials" id="materials"></section>
      <section><h2>针数</h2>${stitchTable(pattern)}${legendFor(pattern)}</section>`;
    const materials = document.getElementById('materials');
    const drawMaterials = () => {
      materials.innerHTML = materialsPanel(pattern, size, 1);
      materials.querySelectorAll('input[name="size"]').forEach((input) => {
        input.addEventListener('change', () => {
          size = Number(input.value);
          saveSetting('size', size);
          drawMaterials();
        });
      });
    };
    drawMaterials();
    document.getElementById('redraw').addEventListener('click', () => {
      // An unsaved result has nothing stored, so only a saved one can fail to delete.
      if (!deleteDrawing(pattern.id) && saved) {
        document.getElementById('redraw').insertAdjacentHTML('afterend', '<p class="error" role="alert">这一张没删掉，浏览器不让改存储。关掉页面再试，或者在首页“我画的”里删。</p>');
        return;
      }
      forgetPattern(pattern.id);
      backToBoard();
    });
    board.hidden = true;
    result.hidden = false;
    window.scrollTo(0, 0);
  };

  const finish = () => {
    status.textContent = '';
    design.disabled = pad.isEmpty();
  };

  design.addEventListener('click', () => {
    if (pad.isEmpty()) return;
    design.disabled = true;
    setRefusal('');
    status.textContent = '正在排环和桥，几秒钟……';
    // The work holds up the page, so the message gets a moment to show first.
    timer = setTimeout(() => {
      try {
        const { pattern, problems } = traceDesign({ strokes: pad.lines() }, { mirror: pad.anyMirrored() });
        finish();
        if (!pattern) {
          setRefusal(problems[0]);
          return;
        }
        pattern.id = newDrawingId();
        rememberPattern(pattern);
        showResult(pattern, saveDrawing(pattern));
      } catch (error) {
        console.error(error);
        finish();
        setRefusal('这张草图没出成图解。再试一次，或者画一个更简单的形状。');
      }
    }, 40);
  });
}
