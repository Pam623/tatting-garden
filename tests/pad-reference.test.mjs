import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the reference picture is a separate image and never touches the canvas or the saved data', () => {
  const source = read('js/pad-reference.js');
  assert.ok(!/getContext|toDataURL|drawImage|saveDrawing|traceDesign/.test(source));
  assert.match(read('js/draw.js'), /setupPadReference\(/);
  assert.ok(!/pad-ref|reference/.test(read('js/sketch-pad.js')), 'the pad knows nothing about it');
});
