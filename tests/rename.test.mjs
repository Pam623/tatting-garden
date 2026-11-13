import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderChart } from '../js/diagram.js';

// rename.js reaches the page through shared.js when loaded, so it gets a bare stand-in first.
globalThis.document = { getElementById: () => ({}) };
globalThis.window = {};
const { relabelChart } = await import('../js/rename.js');

const pattern = {
  id: 'draw-a', title: '手绘花片', layout: { viewBox: [-20, -20, 60, 80] },
  elements: [{ id: 'A', type: 'ring', parts: ['6'], place: { base: [0, 0], tip: [0, 30], width: 20, dir: 'cw' } }],
};

test('a renamed drawing chart is announced by its new name', () => {
  const svg = renderChart(pattern, { counts: [], title: `${pattern.title}图解` });
  let label = svg.match(/aria-label="([^"]*)"/)[1];
  const chart = { setAttribute: (name, value) => { if (name === 'aria-label') label = value; } };
  const card = { querySelector: (selector) => (selector === 'svg.diagram' ? chart : null) };
  assert.equal(label, '手绘花片图解');
  relabelChart(card, '给妈妈的蝴蝶');
  assert.equal(label, '给妈妈的蝴蝶图解');
});

test('relabelling with no chart on show does nothing', () => {
  assert.doesNotThrow(() => relabelChart({ querySelector: () => null }, '爱心'));
  assert.doesNotThrow(() => relabelChart(null, '爱心'));
});
