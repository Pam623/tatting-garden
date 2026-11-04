import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conversionPrompt, convertImage, validatePattern } from '../js/convert.js';

const good = () => JSON.parse(readFileSync(new URL('../patterns/leaf-braid.json', import.meta.url), 'utf8'));
const bad = () => {
  const p = good();
  p.elements[0].parts = ['4', 'p:orphan', '4'];
  return p;
};
const fake = (...answers) => {
  const prompts = [];
  return { prompts, json: async (input) => { prompts.push(input); return structuredClone(answers.shift()); } };
};

test('valid first time needs one call', async () => {
  const sample = fake(good());
  const { pattern, problems } = await convertImage({}, sample);
  assert.deepEqual(problems, []);
  assert.equal(sample.prompts.length, 1);
  assert.match(pattern.id, /^up-/);
});

test('invalid then valid retries once with the failure', async () => {
  const sample = fake(bad(), good());
  const failures = validatePattern(bad());
  assert.ok(failures.length);
  const { problems } = await convertImage({}, sample);
  assert.deepEqual(problems, []);
  assert.equal(sample.prompts.length, 2);
  assert.ok(sample.prompts[1].includes(failures[0]));
});

test('invalid twice returns the problems and stops', async () => {
  const sample = fake(bad(), bad(), good());
  const { problems } = await convertImage({}, sample);
  assert.ok(problems.length);
  assert.equal(sample.prompts.length, 2);
});

test('sample errors are thrown', async () => {
  await assert.rejects(convertImage({}, { json: async () => { throw { code: 'rate_limited' }; } }), { code: 'rate_limited' });
});

test('prompt teaches the format and rules', () => {
  const prompt = conversionPrompt();
  for (const word of ['p:名字', 'j:A.名字', 'bulge', 'viewBox', 'flip', 'group', 'repeat', '梭编', 'sorted', 'public-domain', '线团']) {
    assert.ok(prompt.includes(word), word);
  }
  assert.ok(conversionPrompt(['坏了']).includes('坏了'));
});

test('the prompt example is itself a valid pattern', () => {
  const json = conversionPrompt().match(/\{"schema":2,"id":"example".*\}/)[0];
  assert.deepEqual(validatePattern(JSON.parse(json)), []);
});

test('validatePattern catches a bad pattern', () => {
  assert.deepEqual(validatePattern(good()), []);
  assert.ok(validatePattern(bad()).length > 0);
  assert.ok(validatePattern(null).length > 0);
  assert.ok(validatePattern({ elements: [] }).length > 0);
});
