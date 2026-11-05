// Decisions about uploaded files that need no browser: what a file is, how big to draw it,
// which page numbers exist, and what to say when something fails.

export const ACCEPTED_FILES = 'image/*,application/pdf,.pdf';
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

// The saved copy of a picture is only for looking at beside the chart.
export const ORIGINAL_MAX_EDGE = 1600;
export const ORIGINAL_QUALITY = 0.85;

// A PDF page is drawn large enough for Claude to read small numbers.
export const PDF_PAGE_MAX_EDGE = 2400;
export const PDF_PAGE_MAX_SCALE = 4;
export const PDF_PAGE_QUALITY = 0.92;

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;

// 'image', 'pdf' or null. Browsers can leave the type empty, so the file name is the fallback.
export function fileKind({ type = '', name = '' } = {}) {
  const lower = type.toLowerCase();
  if (lower === 'application/pdf') return 'pdf';
  if (lower.startsWith('image/')) return 'image';
  if (lower && lower !== 'application/octet-stream') return null;
  if (/\.pdf$/i.test(name)) return 'pdf';
  return IMAGE_NAME.test(name) ? 'image' : null;
}

// Why this file can't be used, or null if it can.
export function fileProblem(file) {
  const kind = fileKind(file);
  if (!kind) return '这个文件不是图片或 PDF。请选 JPG、PNG 或 PDF 文件。';
  if (!file.size) return '这个文件是空的。请换一个文件。';
  if (kind === 'pdf' && file.size > MAX_PDF_BYTES) return 'PDF 太大了（最多 200 MB）。请只导出需要的那几页再传。';
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) return '图片太大了（最多 50 MB）。请先缩小再传。';
  return null;
}

// The size to draw at so the longer edge fits, never enlarging.
export function fitWithin(width, height, maxEdge) {
  if (!(width > 0) || !(height > 0)) throw new RangeError('A picture needs a positive size');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// The scale for drawing a PDF page. Unlike a picture a page can be enlarged, up to a limit.
export function pdfPageScale(width, height, maxEdge = PDF_PAGE_MAX_EDGE, maxScale = PDF_PAGE_MAX_SCALE) {
  if (!(width > 0) || !(height > 0)) throw new RangeError('A page needs a positive size');
  return Math.min(maxScale, maxEdge / Math.max(width, height));
}

export function pageNumbers(total) {
  return Number.isInteger(total) && total > 0 ? Array.from({ length: total }, (_, i) => i + 1) : [];
}

// The page number a picker's value stands for, or null if there is no such page.
export function readPageNumber(value, total) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= total ? page : null;
}

// True when RGBA pixels are all close to one colour, as when a page failed to draw.
export function looksBlank(pixels, tolerance = 16, minShare = 0.0001) {
  const count = Math.floor(pixels.length / 4);
  if (count === 0) return true;
  const allowed = count * minShare;
  let different = 0;
  for (let i = 0; i < count * 4; i += 4) {
    const apart = Math.abs(pixels[i] - pixels[0])
      + Math.abs(pixels[i + 1] - pixels[1])
      + Math.abs(pixels[i + 2] - pixels[2]);
    if (apart > tolerance) {
      different += 1;
      if (different > allowed) return false;
    }
  }
  return true;
}

const ORIGINAL_MESSAGES = {
  no_assets: '这个页面现在存不了原图。',
  too_large: '原图太大，存不下。',
  quota_or_state: '原图的存储空间满了，存不下。',
  rate_limited: '操作太频繁，原图这次没存上。请等一分钟。',
  not_granted: '这个页面还没有得到存原图的权限。',
  upstream_auth: '登录状态过期了，原图没存上。请刷新页面重新登录。',
  timeout: '存原图一直没有回应。请检查网络。',
};

export function originalErrorMessage(error) {
  return ORIGINAL_MESSAGES[error?.code] ?? '原图这次没存上。';
}

// What a saved row remembers about its picture. The page number is only there for PDFs.
export function describeOriginal(uploaded, { width, height, fileName = '', page = null }) {
  return {
    assetId: uploaded.id,
    width,
    height,
    bytes: uploaded.sizeBytes,
    contentType: uploaded.contentType,
    fileName,
    ...(page ? { page } : {}),
  };
}

export function originalCaption(original) {
  return [original?.fileName, original?.page ? `第 ${original.page} 页` : ''].filter(Boolean).join(' · ');
}
