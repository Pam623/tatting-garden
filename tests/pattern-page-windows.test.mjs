// The pattern page driven through a stand-in page: the tall fishbone chart in windows that follow
// the frame's size, through resizes, a highlighted row and the finished picture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const frame = { width: 349, height: 337 };
const elements = new Map();
const created = [];
const handlers = new Map();
const on = (target) => (type, fn) => {
  if (!handlers.has(target)) handlers.set(target, {});
  (handlers.get(target)[type] ??= []).push(fn);
};
const fire = (target, type, event = {}) => (handlers.get(target)?.[type] ?? []).forEach((fn) => fn(event));

function fakeElement() {
  let html = '';
  const element = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); },
    textContent: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, toggle() {} },
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(type, fn) { on(element)(type, fn); },
    insertAdjacentElement() {},
    // The chart's picture, measured as the page would lay it out in the frame.
    querySelector(selector) {
      if (selector === 'svg.diagram') {
        return html.includes('class="diagram"') ? { getBoundingClientRect: () => ({ width: frame.width, height: frame.height }) } : null;
      }
      return fakeElement();
    },
    querySelectorAll: () => [],
    get parentElement() { return parent; },
  };
  return element;
}
const parent = fakeElement();

// One row of the stitch table, pressed and released like a toggle.
let pressed = 'false';
const row = {
  ...fakeElement(), dataset: { ids: 'R3,R4,L4,L3' }, getAttribute: () => pressed, setAttribute: (name, value) => { pressed = value; },
};
row.addEventListener = (type, fn) => on(row)(type, fn);

globalThis.document = {
  title: '',
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: (selector) => (selector === '.row' ? [row] : []),
  createElement() {
    const element = fakeElement();
    created.push(element);
    return element;
  },
};
const windowTarget = {};
globalThis.window = { addEventListener: (type, fn) => on(windowTarget)(type, fn), removeEventListener() {} };
globalThis.getComputedStyle = () => ({ maxHeight: `${frame.height}px` });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { hash: '' };
const fishbone = JSON.parse(readFileSync(new URL('../patterns/fishbone.json', import.meta.url), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => fishbone });

const { showPattern } = await import('../js/pattern-page.js');
const { overviewWindows, windowFor } = await import('../js/diagram.js');

const chart = () => document.getElementById('chart');
const shownBox = () => chart().innerHTML.match(/<svg class="diagram" viewBox="([^"]+)"/)?.[1].split(' ').map(Number);
const windowsAt = (width, height) => overviewWindows(fishbone, { aspect: height / width });
const sameBox = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.06);
const pressWindow = (index) => fire(document.getElementById('chart-windows'), 'click', { target: { closest: () => ({ dataset: { window: String(index) } }) } });
const resize = async (width, height) => {
  frame.width = width;
  frame.height = height;
  fire(windowTarget, 'resize');
  await new Promise((resolve) => setTimeout(resolve, 200));
};

await showPattern('fishbone');

test('the page opens on the first window, cut for the frame it is shown in', () => {
  assert.ok(sameBox(shownBox(), windowsAt(349, 337)[0]));
});

test('after a resize a highlighted row is still in the window on show', async () => {
  fire(row, 'click');
  const before = windowsAt(349, 337);
  assert.ok(sameBox(shownBox(), before[windowFor(fishbone, before, ['R3', 'R4', 'L4', 'L3'])]));
  await resize(349, 175);
  const after = windowsAt(349, 175);
  const holding = windowFor(fishbone, after, ['R3', 'R4', 'L4', 'L3']);
  assert.notEqual(holding, windowFor(fishbone, before, ['R3', 'R4', 'L4', 'L3']));
  assert.ok(sameBox(shownBox(), after[holding]));
  fire(row, 'click');
});

test('back from the finished picture, the windows fit the frame as it is now', async () => {
  pressWindow(1);
  const bar = created.find((element) => element.innerHTML.includes('data-mode="finished"'));
  fire(bar, 'click', { target: { closest: () => ({ dataset: { mode: 'finished' } }) } });
  assert.doesNotMatch(chart().innerHTML, /class="diagram"/);
  // The frame changes while the finished picture is on show; resizing then leaves the chart alone.
  await resize(349, 300);
  fire(bar, 'click', { target: { closest: () => ({ dataset: { mode: 'chart' } }) } });
  assert.ok(sameBox(shownBox(), windowsAt(349, 300)[1]), `${shownBox()} vs ${windowsAt(349, 300)[1]} / ${windowsAt(349, 300).length}`);
});
