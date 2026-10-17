import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTruck } from './loadTruck';
afterEach(() => vi.unstubAllGlobals());
describe('optional licensed model loading', () => {
  it('silently keeps the 2D fallback on 404 without importing three', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 })); vi.stubGlobal('fetch', fetch);
    const load = vi.fn();
    expect(await loadTruck(new AbortController().signal, load)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2); expect(load).not.toHaveBeenCalled();
  });
  it('recognises the Vite HTML fallback and tries glTF after a missing GLB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'model/gltf+json' } })));
    const renderer = { layer: { id: 'drive-truck' }, set: vi.fn(), dispose: vi.fn() };
    const createTruckLayer = vi.fn(async () => renderer);
    expect(await loadTruck(new AbortController().signal, vi.fn(async () => ({ createTruckLayer })) as never)).toBe(renderer);
    expect(createTruckLayer).toHaveBeenCalledWith('/models/semi-truck/scene.gltf', expect.any(AbortSignal));
  });
  it('falls back after corrupt or unsupported model data and stops after cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    const loader = vi.fn(async () => { throw new Error('bad texture'); });
    expect(await loadTruck(new AbortController().signal, loader)).toBeNull();
    const abort = new AbortController(); abort.abort();
    loader.mockClear(); expect(await loadTruck(abort.signal, loader)).toBeNull(); expect(loader).not.toHaveBeenCalled();
  });
});
