// A small form for naming a saved drawing, used on the drawing result and on the home page cards.
import { cleanTitle, renameDrawing, TITLE_MAX } from './drawings.js';
import { escapeHtml, rememberPattern } from './shared.js';

// After a rename, the chart inside root is announced by its new name too.
// Whatever follows the name, like which window of a tall chart is on show, stays.
export function relabelChart(root, title) {
  const chart = root?.querySelector('svg.diagram');
  if (!chart) return;
  const old = chart.getAttribute?.('aria-label') ?? '';
  const at = old.lastIndexOf('图解');
  chart.setAttribute('aria-label', `${title}图解${at >= 0 ? old.slice(at + 2) : ''}`);
}

// Fills slot with the form. done(pattern) runs after a save, done(null) after cancelling.
export function openRename(slot, id, title, done) {
  slot.innerHTML = `
    <form class="rename">
      <input type="text" name="title" maxlength="${TITLE_MAX}" value="${escapeHtml(title)}" aria-label="名字" enterkeyhint="done">
      <button type="submit" class="primary">保存</button>
      <button type="button" class="ghost" data-cancel>取消</button>
      <p class="hint" role="status" aria-live="polite"></p>
    </form>`;
  const form = slot.querySelector('form');
  const input = form.querySelector('input');
  const note = form.querySelector('[role="status"]');
  input.focus();
  input.select();
  form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!cleanTitle(input.value)) {
      note.textContent = '起个名字再保存。';
      return;
    }
    const pattern = renameDrawing(id, input.value);
    if (!pattern) {
      note.textContent = '没存上，这个浏览器不让改本机保存。';
      return;
    }
    rememberPattern(pattern);
    done(pattern);
  });
}
