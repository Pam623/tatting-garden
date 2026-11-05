import { canvasToJpeg } from './picture.js';
import { withDeadline } from './saved.js';
import { looksBlank, PDF_PAGE_QUALITY, pdfPageScale } from './upload-file.js';

// A fixed version, published more than two weeks before it was chosen.
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.4.299';
const LOAD_TIMEOUT_MS = 30000;
const OPEN_TIMEOUT_MS = 60000;
const PAGE_TIMEOUT_MS = 60000;

let pdfLibrary = null;

// Fetched only when someone picks a PDF, so nothing else ever loads it.
function loadPdfLibrary() {
  pdfLibrary ??= withDeadline(import(`${PDFJS_BASE}/pdf.min.mjs`), LOAD_TIMEOUT_MS)
    .then((library) => {
      library.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return library;
    })
    .catch((error) => {
      // Let the next try fetch it again.
      pdfLibrary = null;
      console.error(error);
      throw { code: 'library' };
    });
  return pdfLibrary;
}

// Opens a PDF file. The answer can tell its page count, draw a page and close itself.
export async function openPdf(file) {
  const library = await loadPdfLibrary();
  const task = library.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  let pdf;
  try {
    pdf = await withDeadline(task.promise, OPEN_TIMEOUT_MS);
  } catch (error) {
    task.destroy().catch(() => {});
    throw error;
  }
  return {
    pageCount: pdf.numPages,
    drawPage: (number) => withDeadline(drawPage(pdf, number), PAGE_TIMEOUT_MS),
    close: () => task.destroy().catch(() => {}),
  };
}

// One page as a JPEG. A page that comes out empty rejects with { code: 'blank' },
// because Claude would otherwise invent a pattern from nothing.
async function drawPage(pdf, number) {
  const page = await pdf.getPage(number);
  try {
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfPageScale(unscaled.width, unscaled.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // The default intent waits on animation frames, which stop whenever the tab or pane is hidden.
    await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise;
    if (looksBlank(context.getImageData(0, 0, canvas.width, canvas.height).data)) throw { code: 'blank' };
    return await canvasToJpeg(canvas, PDF_PAGE_QUALITY);
  } finally {
    page.cleanup();
  }
}
