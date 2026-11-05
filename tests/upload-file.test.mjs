import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACCEPTED_FILES, describeOriginal, fileKind, fileProblem, fitWithin, looksBlank, MAX_IMAGE_BYTES, MAX_PDF_BYTES,
  originalCaption, originalErrorMessage, pageNumbers, pdfPageScale, readPageNumber,
} from '../js/upload-file.js';

test('the file box takes pictures and PDFs', () => {
  assert.ok(ACCEPTED_FILES.includes('image/*'));
  assert.ok(ACCEPTED_FILES.includes('application/pdf'));
  assert.ok(ACCEPTED_FILES.includes('.pdf'));
});

test('fileKind reads the type first', () => {
  assert.equal(fileKind({ type: 'application/pdf', name: 'a.pdf' }), 'pdf');
  assert.equal(fileKind({ type: 'APPLICATION/PDF', name: 'a' }), 'pdf');
  assert.equal(fileKind({ type: 'image/jpeg', name: 'a.jpg' }), 'image');
  assert.equal(fileKind({ type: 'image/heic', name: 'a.heic' }), 'image');
  assert.equal(fileKind({ type: 'image/png', name: 'looks-like.pdf' }), 'image');
});

test('fileKind falls back to the name when the type says nothing', () => {
  assert.equal(fileKind({ type: '', name: '书.PDF' }), 'pdf');
  assert.equal(fileKind({ type: 'application/octet-stream', name: 'scan.pdf' }), 'pdf');
  assert.equal(fileKind({ type: '', name: 'photo.JPEG' }), 'image');
  assert.equal(fileKind({ type: '', name: 'photo.heic' }), 'image');
});

test('fileKind refuses everything else', () => {
  assert.equal(fileKind({ type: 'text/plain', name: 'a.txt' }), null);
  assert.equal(fileKind({ type: 'text/plain', name: 'a.pdf' }), null);
  assert.equal(fileKind({ type: '', name: 'a.docx' }), null);
  assert.equal(fileKind({ type: '', name: 'noextension' }), null);
  assert.equal(fileKind({}), null);
});

test('fileProblem explains what to do', () => {
  assert.equal(fileProblem({ type: 'image/png', name: 'a.png', size: 10 }), null);
  assert.equal(fileProblem({ type: 'application/pdf', name: 'a.pdf', size: 10 }), null);
  assert.match(fileProblem({ type: 'text/plain', name: 'a.txt', size: 10 }), /JPG、PNG 或 PDF/);
  assert.match(fileProblem({ type: 'image/png', name: 'a.png', size: 0 }), /空的/);
  assert.match(fileProblem({ type: 'image/png', name: 'a.png', size: MAX_IMAGE_BYTES + 1 }), /图片太大/);
  assert.match(fileProblem({ type: 'application/pdf', name: 'a.pdf', size: MAX_PDF_BYTES + 1 }), /PDF 太大/);
  assert.equal(fileProblem({ type: 'application/pdf', name: 'a.pdf', size: MAX_IMAGE_BYTES + 1 }), null);
});

test('fitWithin shrinks the long edge and keeps the shape', () => {
  assert.deepEqual(fitWithin(3200, 1600, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitWithin(1600, 3200, 1600), { width: 800, height: 1600 });
  assert.deepEqual(fitWithin(4000, 3001, 1600), { width: 1600, height: 1200 });
});

test('fitWithin never enlarges and never reaches zero', () => {
  assert.deepEqual(fitWithin(300, 200, 1600), { width: 300, height: 200 });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitWithin(10000, 1, 1600), { width: 1600, height: 1 });
});

test('fitWithin refuses an impossible size', () => {
  assert.throws(() => fitWithin(0, 10, 1600), RangeError);
  assert.throws(() => fitWithin(10, NaN, 1600), RangeError);
});

test('a PDF page is drawn large, within limits', () => {
  assert.equal(pdfPageScale(600, 800), 3);
  assert.equal(pdfPageScale(200, 300), 4);
  assert.equal(pdfPageScale(4800, 2400), 0.5);
  assert.throws(() => pdfPageScale(0, 800), RangeError);
});

test('page numbers run from one to the total', () => {
  assert.deepEqual(pageNumbers(3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(1), [1]);
  assert.deepEqual(pageNumbers(0), []);
  assert.deepEqual(pageNumbers(1.5), []);
  assert.deepEqual(pageNumbers(undefined), []);
});

test('a page number must exist', () => {
  assert.equal(readPageNumber('2', 3), 2);
  assert.equal(readPageNumber(3, 3), 3);
  assert.equal(readPageNumber('1', 1), 1);
  for (const bad of ['0', '4', '-1', '1.5', 'x', null, undefined]) {
    assert.equal(readPageNumber(bad, 3), null, String(bad));
  }
  assert.equal(readPageNumber('', 3), null);
});

function pixels(count, paint = () => [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) data.set(paint(i), i * 4);
  return data;
}

test('a page of one colour looks blank', () => {
  assert.equal(looksBlank(pixels(1000)), true);
  assert.equal(looksBlank(pixels(1000, () => [0, 0, 0, 255])), true);
  assert.equal(looksBlank(new Uint8ClampedArray(0)), true);
});

test('faint noise still looks blank, but thin lines do not', () => {
  assert.equal(looksBlank(pixels(1000, (i) => (i % 2 ? [250, 250, 250, 255] : [255, 255, 255, 255]))), true);
  assert.equal(looksBlank(pixels(100000, (i) => (i < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255]))), false);
  assert.equal(looksBlank(pixels(100000, (i) => (i === 500 ? [0, 0, 0, 255] : [255, 255, 255, 255]))), true);
});

test('an original is described without its picture', () => {
  const uploaded = { id: 'abc', url: '/x', sizeBytes: 12, contentType: 'image/jpeg' };
  assert.deepEqual(describeOriginal(uploaded, { width: 3, height: 4, fileName: 'a.jpg' }), {
    assetId: 'abc', width: 3, height: 4, bytes: 12, contentType: 'image/jpeg', fileName: 'a.jpg',
  });
  assert.equal(describeOriginal(uploaded, { width: 3, height: 4, fileName: 'a.pdf', page: 2 }).page, 2);
});

test('the caption names the file and page', () => {
  assert.equal(originalCaption({ fileName: 'a.pdf', page: 2 }), 'a.pdf · 第 2 页');
  assert.equal(originalCaption({ fileName: 'a.jpg' }), 'a.jpg');
  assert.equal(originalCaption(null), '');
});

test('every way an original can fail to store has a message', () => {
  for (const code of ['no_assets', 'too_large', 'quota_or_state', 'rate_limited', 'not_granted', 'upstream_auth', 'timeout']) {
    assert.notEqual(originalErrorMessage({ code }), originalErrorMessage({ code: 'new_code' }), code);
  }
});
