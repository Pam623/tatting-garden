import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conversionPrompt, designFromSketch, designPrompt, DESIGN_EXAMPLE } from '../js/convert.js';
import { renderChart } from '../js/diagram.js';
import { applyLayout, fitLayout, layoutProblems } from '../js/fit-layout.js';
import { checkPattern } from '../js/pattern.js';
import { buildRow, rowFits } from '../js/saved.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const fake = (...answers) => {
  const calls = [];
  return { calls, json: async (prompt, options) => { calls.push({ prompt, options }); return structuredClone(answers.shift()); } };
};
const lopsided = () => {
  const pattern = fixture('sketch-heart');
  pattern.elements.find((e) => e.id === 'O').parts = ['7', 'j:M.last', '3', 'o', '4', 'j:A.first', '9'];
  return pattern;
};
const noPlaces = (pattern) => {
  pattern.elements.forEach((element) => { delete element.place; });
  return pattern;
};

test('the design brief asks for a design from a sketch, and is not the reading brief', () => {
  const prompt = designPrompt();
  ['手绘草图', '对称轴', '接耳只能接已经编好的耳', '摆位由程序计算'].forEach((words) => assert.ok(prompt.includes(words), words));
  assert.notEqual(prompt, conversionPrompt());
  assert.ok(!prompt.includes('上一次的设计'));
});

test('the example in the brief can itself be laid out', () => {
  const fitted = fitLayout(DESIGN_EXAMPLE, { aspect: 1 });
  assert.deepEqual(fitted.problems, []);
  assert.deepEqual(layoutProblems(applyLayout(DESIGN_EXAMPLE, fitted)), []);
});

for (const name of ['sketch-heart', 'sketch-butterfly']) {
  test(`${name}: a design answer is laid out, checked, drawn and ready to save`, async () => {
    const sample = fake(fixture(name));
    const blob = { picture: true };
    const { pattern, problems } = await designFromSketch(blob, sample, { aspect: 1 });
    assert.deepEqual(problems, []);
    assert.equal(sample.calls.length, 1);
    assert.deepEqual(sample.calls[0].options.images, [blob]);
    assert.match(pattern.id, /^up-/);
    assert.deepEqual(layoutProblems(pattern), []);
    assert.ok(checkPattern(pattern).every((c) => c.ok));
    assert.doesNotMatch(renderChart(pattern, { counts: 'all' }), /NaN/);
    assert.ok(rowFits(buildRow(pattern, null)));
  });

  test(`${name}: a design answer without any positions still works`, async () => {
    const { problems } = await designFromSketch({}, fake(noPlaces(fixture(name))), { aspect: 1 });
    assert.deepEqual(problems, []);
  });
}

test('a design that fails goes back to the AI once, with what was wrong', async () => {
  const sample = fake(lopsided(), fixture('sketch-heart'));
  const progress = [];
  const { pattern, problems } = await designFromSketch({}, sample, { onProgress: (text) => progress.push(text) });
  assert.deepEqual(problems, []);
  assert.ok(pattern);
  assert.equal(sample.calls.length, 2);
  assert.ok(!sample.calls[0].prompt.includes('上一次的设计'));
  assert.match(sample.calls[1].prompt, /上一次的设计有这些问题[^]*O/);
  assert.equal(progress.length, 2);
});

test('a design still failing after the retry reports it and gives no chart', async () => {
  const sample = fake(lopsided(), lopsided());
  const { pattern, problems } = await designFromSketch({}, sample);
  assert.equal(sample.calls.length, 2);
  assert.equal(pattern, null);
  assert.ok(problems.length > 0);
});

test('an answer that is not a pattern at all is handled', async () => {
  for (const answer of [null, 'hello', [], {}]) {
    const { pattern, problems } = await designFromSketch({}, fake(answer, answer));
    assert.ok(problems.length > 0);
    assert.ok(!pattern || typeof pattern !== 'object' || !pattern.elements);
  }
});
