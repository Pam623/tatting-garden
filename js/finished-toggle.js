import { renderFinished, THREAD_COLORS } from './finished.js';

const COLOR_KEY = 'tatting.threadColor';

function savedColor() {
  try {
    const id = localStorage.getItem(COLOR_KEY);
    return THREAD_COLORS.some((c) => c.id === id) ? id : 'ivory';
  } catch {
    return 'ivory';
  }
}

// Puts a "chart / simulated finished piece" switch above a chart figure.
// showChart() redraws the normal chart; the returned isFinished() tells callers to leave the figure alone.
export function attachFinishedToggle(figure, pattern, showChart) {
  let on = false;
  let color = savedColor();
  const bar = document.createElement('div');
  bar.className = 'finished-bar';
  bar.innerHTML = `
    <div class="finished-modes" role="group" aria-label="看图的方式">
      <button type="button" data-mode="chart" aria-pressed="true">图解</button>
      <button type="button" data-mode="finished" aria-pressed="false">模拟完成图</button>
    </div>
    <label class="finished-color" hidden>线色
      <select>${THREAD_COLORS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
    </label>
    <p class="hint" hidden>照着数据画的示意，不是实物照片。</p>`;
  figure.insertAdjacentElement('beforebegin', bar);
  const select = bar.querySelector('select');
  select.value = color;
  const paint = () => {
    bar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.mode === 'finished') === on)));
    bar.querySelector('.finished-color').hidden = !on;
    bar.querySelector('.hint').hidden = !on;
    if (on) figure.innerHTML = renderFinished(pattern, { color });
    else showChart();
  };
  bar.addEventListener('click', (event) => {
    const mode = event.target.closest('[data-mode]')?.dataset.mode;
    if (!mode || (mode === 'finished') === on) return;
    on = mode === 'finished';
    paint();
  });
  select.addEventListener('change', () => {
    color = select.value;
    try {
      localStorage.setItem(COLOR_KEY, color);
    } catch {
      // The colour just won't be remembered.
    }
    paint();
  });
  return { isFinished: () => on };
}
