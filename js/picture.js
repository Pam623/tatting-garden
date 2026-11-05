import { fitWithin, ORIGINAL_MAX_EDGE, ORIGINAL_QUALITY } from './upload-file.js';

export function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The canvas gave no picture'));
    }, 'image/jpeg', quality);
  });
}

// A smaller JPEG of any picture the browser can open. Throws if it can't open it.
export async function shrinkPicture(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, ORIGINAL_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    // JPEG has no transparency; without this a clear background turns black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return { blob: await canvasToJpeg(canvas, ORIGINAL_QUALITY), width, height };
  } finally {
    bitmap.close();
  }
}
