import { loadExplore } from './explore.js';
import { escapeHtml } from './shared.js';

// A faint picture under the drawing board, only to look at while drawing.
// It is a separate image behind the canvas: it is never drawn on the canvas, so it is not saved
// and does not reach the tracing.
export function setupPadReference(slot, wrap, { library = true, load = loadExplore } = {}) {
  const img = document.createElement('img');
  img.className = 'pad-ref';
  img.alt = '';
  img.hidden = true;
  wrap.insertBefore(img, wrap.firstChild);
  let localUrl = null;
  let loading = null;
  slot.innerHTML = `
    <button type="button" class="ghost" id="ref-open" aria-expanded="false">放一张参照</button>
    <div class="ref-panel" id="ref-panel" hidden>
      ${library ? '<label>从灵感库选\n        <select id="ref-card"><option value="">不选</option></select>\n      </label>' : ''}
      <label>从本机选图
        <input type="file" id="ref-file" accept="image/*">
      </label>
      <button type="button" class="ghost" id="ref-clear">拿掉参照</button>
      <p class="hint">只淡淡显示在画板下面，不会保存，也不会参与变成图解。</p>
    </div>`;
  const panel = slot.querySelector('#ref-panel');
  const open = slot.querySelector('#ref-open');
  const select = slot.querySelector('#ref-card') ?? { value: '', addEventListener() {}, insertAdjacentHTML() {} };
  const file = slot.querySelector('#ref-file');
  const release = () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = null;
  };
  const show = (src) => {
    img.src = src ?? '';
    img.hidden = !src;
  };
  open.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    open.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden && library && !loading) {
      // One load at a time, kept for good, so the options are never added twice.
      loading = load().then((cards) => {
        select.insertAdjacentHTML('beforeend', cards.map((c) => `<option value="${escapeHtml(c.image)}">${escapeHtml(c.title)}</option>`).join(''));
      }).catch((error) => {
        console.error(error);
        loading = null;
      });
    }
  });
  select.addEventListener('change', () => {
    release();
    file.value = '';
    show(select.value || null);
  });
  file.addEventListener('change', () => {
    release();
    const picked = file.files?.[0];
    if (!picked || !picked.type.startsWith('image/')) return;
    select.value = '';
    localUrl = URL.createObjectURL(picked);
    show(localUrl);
  });
  slot.querySelector('#ref-clear').addEventListener('click', () => {
    release();
    select.value = '';
    file.value = '';
    show(null);
  });
  return { stop: release };
}
