// Cache source bytes, never disposed Three objects or GPU resources. Each Play parses a fresh scene.
const assets = new Map<string, ArrayBuffer>();
export async function modelBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const cached = assets.get(url);
  if (cached) return cached;
  const response = await fetch(url, { signal });
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Model unavailable');
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  assets.set(url, bytes);
  return bytes;
}
