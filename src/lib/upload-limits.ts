// Leave room below Vercel's 4.5 MB request limit for platform overhead.
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_LENGTH = 360000;
export const UPLOAD_LIMIT_MESSAGE = 'Las imágenes y los boletos superan el límite de 4 MB. Reduce las imágenes o la cantidad de boletos importados e intenta otra vez.';

export function serializeRequest(data: unknown): string {
  const body = JSON.stringify(data);
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) throw new Error(UPLOAD_LIMIT_MESSAGE);
  return body;
}
