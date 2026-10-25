// Shared by the volunteer crop result and management upload preview.
export async function prepareImages(file) {
  const bitmap = await createImageBitmap(file);
  const encode = async (width, height, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error('照片轉換失敗，請換一張照片'))),
        'image/jpeg',
        quality
      )
    );
  };
  try {
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const original = await encode(
      Math.max(1, Math.round(bitmap.width * ratio)),
      Math.max(1, Math.round(bitmap.height * ratio)),
      0.85
    );
    if (original.size > 2 * 1024 * 1024) throw Error('照片太大，請裁切後重試');
    let thumb = null;
    try {
      const scale = Math.min(1, 300 / Math.min(bitmap.width, bitmap.height));
      thumb = await encode(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
        0.8
      );
      if (thumb.size > 512 * 1024) thumb = null;
    } catch {
      /* The original is the explicit fallback when thumbnail creation fails. */
    }
    return { original, thumb };
  } finally {
    bitmap.close();
  }
}
export function imageForm({ original, thumb }) {
  const form = new FormData();
  form.append('photo', original, 'photo.jpg');
  if (thumb) form.append('thumb', thumb, 'thumb.jpg');
  return form;
}
