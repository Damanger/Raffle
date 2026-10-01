export async function optimizeImage(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Selecciona imágenes PNG, JPEG o WebP de hasta 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const factor = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * factor)); canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Tu navegador no puede procesar la imagen.');
    ctx.fillStyle = '#fffefb'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [.86,.72,.58,.42]) { const base64 = canvas.toDataURL('image/jpeg',quality); if (base64.length <= 700000) return base64; }
    throw new Error('Esta imagen es demasiado grande. Usa una foto de menor resolución.');
  } catch (error) { throw new Error((error as Error).message || 'No se pudo leer la imagen.'); }
  finally { URL.revokeObjectURL(url); }
}

export function setupCoverUpload(prefix: string, callbacks: {
  isBusy: () => boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const input = document.getElementById(`${prefix}-cover-file`) as HTMLInputElement;
  const preview = document.getElementById(`${prefix}-cover-preview`)!;
  const image = document.getElementById(`${prefix}-cover-image`) as HTMLImageElement;
  const remove = document.getElementById(`${prefix}-cover-remove`) as HTMLButtonElement;
  let value = '';
  function setValue(next: string) {
    value = next; preview.hidden = !next; input.value = '';
    if (next) image.src = next;
    else image.removeAttribute('src');
  }
  input.addEventListener('change', async () => {
    if (callbacks.isBusy()) return;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    callbacks.onBusy(true);
    try { setValue(await optimizeImage(file)); }
    catch (error) { callbacks.onError((error as Error).message); }
    finally { callbacks.onBusy(false); }
  });
  remove.addEventListener('click', () => { if (!callbacks.isBusy()) setValue(''); });
  return {
    get value() { return value; }, setValue,
    setDisabled(disabled: boolean) { input.disabled = remove.disabled = disabled; },
  };
}
