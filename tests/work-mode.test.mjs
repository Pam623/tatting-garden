// Work mode driven through a stand-in page: just enough document for js/work.js to run.
import assert from 'node:assert/strict';
import { test } from 'node:test';

function fakeElement() {
  const handlers = {};
  let html = '';
  return {
    // New markup replaces any element it names, as a real page would.
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      for (const [, id] of String(value).matchAll(/id="([^"]+)"/g)) elements.delete(id);
    },
    textContent: '',
    hidden: false,
    disabled: false,
    open: false,
    style: { setProperty() {} },
    classList: { add() {}, toggle() {} },
    setAttribute() {},
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 360, height: 330 }),
    click() { (handlers.click ?? []).forEach((fn) => fn({ target: this })); },
  };
}

const elements = new Map();
const store = new Map();
const patterns = new Map();
globalThis.document = {
  title: '',
  visibilityState: 'hidden',
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = {};
globalThis.location = { hash: '' };
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.fetch = async (url) => {
  const id = url.match(/patterns\/(.+)\.json$/)?.[1];
  return { ok: patterns.has(id), json: async () => patterns.get(id) };
};

const ring = (id, x) => ({ id, type: 'ring', parts: ['6'], place: { base: [x, 0], tip: [x, 30], width: 20, dir: 'cw' } });
function addPattern(id, ids, repeat, times) {
  patterns.set(id, {
    schema: 2, id, title: id, craft: '梭编', difficulty: '入门', tier: 'sorted', rights: { kind: 'original' },
    layout: { viewBox: [-20, -20, 40 * ids.length + 40, 80] },
    repeat: { elements: repeat, defaultTimes: times, open: [] },
    elements: ids.map((e, i) => ring(e, i * 40)),
  });
}

const { showWork } = await import('../js/work.js');
const $ = (id) => document.getElementById(id);
const saved = (id) => JSON.parse(store.get(`work:${id}`));
const open = async (id) => {
  elements.clear();
  await showWork(id);
};

test('restarting after the last group starts again at group 1 when the repeat starts the pattern', async () => {
  addPattern('loop-ab', ['A', 'B'], ['A', 'B'], 2);
  await open('loop-ab');
  // A B, choice, A B (group 2), choice, then finish.
  for (let i = 0; i < 6; i++) $('next').click();
  assert.equal(saved('loop-ab').finished, true);
  $('again').click();
  assert.equal(saved('loop-ab').index, 0);
  assert.equal(saved('loop-ab').pass, 1);
  assert.match($('position').textContent, /^第 1 组，共 2 组/);
});

test('back from the first element of a later group is allowed and returns to the choice before it', async () => {
  addPattern('loop-back', ['A', 'B'], ['A', 'B'], 3);
  await open('loop-back');
  for (let i = 0; i < 3; i++) $('next').click();
  assert.equal(saved('loop-back').pass, 2);
  assert.equal(saved('loop-back').index, 0);
  assert.equal($('prev').disabled, false);
  $('prev').click();
  assert.equal(saved('loop-back').pass, 1);
  assert.equal(saved('loop-back').asking, true);
  assert.equal(saved('loop-back').index, 1);
});

test('leaving a repeat in the middle counts only the groups worked, and back keeps the group', async () => {
  addPattern('middle', ['A', 'B', 'C', 'D'], ['B', 'C'], 5);
  await open('middle');
  // A, B, C, then the choice after group 1.
  for (let i = 0; i < 3; i++) $('next').click();
  assert.equal(saved('middle').asking, true);
  // Leave through the small button after one group of five.
  $('other-choice').click();
  assert.equal(saved('middle').index, 3);
  // 3 elements done out of 4 + 4 more groups of 2 = 12.
  assert.equal($('bar').style.width, `${(3 / 12) * 100}%`);
  $('prev').click();
  assert.equal(saved('middle').index, 2);
  assert.equal(saved('middle').pass, 1);
  assert.match($('position').textContent, /^第 1 组，共 5 组/);

  // After two groups, stepping back from D lands in group 2.
  await open('middle');
  $('next').click(); // choice after C, group 1
  $('next').click(); // group 2 at B
  $('next').click(); // C
  $('next').click(); // choice after group 2
  $('other-choice').click();
  assert.equal(saved('middle').index, 3);
  assert.equal($('bar').style.width, `${(5 / 12) * 100}%`);
  $('prev').click();
  assert.equal(saved('middle').pass, 2);
  assert.match($('position').textContent, /^第 2 组，共 5 组/);
});

test('three groups plus one extra: no 收尾 before the end, and the finish names 4 groups', async () => {
  addPattern('extra', ['A', 'B', 'C'], ['B', 'C'], 3);
  await open('extra');
  $('next').click(); // A -> B
  const labels = [];
  for (let group = 1; group <= 4; group++) {
    $('next').click(); // B -> C, the group's last element
    labels.push($('next').textContent);
    $('next').click(); // C -> the choice
    if (group < 3) $('next').click(); // 再来一组 (primary)
    else if (group === 3) $('other-choice').click(); // 再多编一组
  }
  assert.deepEqual(labels, ['这组编完了', '这组编完了', '这组编完了', '这组编完了']);
  assert.equal($('next').textContent, '收尾');
  $('next').click();
  assert.equal(saved('extra').finished, true);
  assert.equal($('position').textContent, '起头 A，B–C 共编了 4 组，都编完了');
  await open('extra');
  assert.equal($('position').textContent, '起头 A，B–C 共编了 4 组，都编完了');
});
