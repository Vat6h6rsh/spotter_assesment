import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTruckLayer } from './truckLayer';
import { loadTruck } from './loadTruck';

// A real, minimal GLB triangle exercises GLTFLoader and CPU/GPU resource ownership without WebGL.
function triangleGlb() {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]);
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: vertices.byteLength }], bufferViews: [{ buffer: 0, byteLength: vertices.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }] });
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const bytes = new ArrayBuffer(28 + text.length + vertices.byteLength), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(bytes, 20, text.length).set(text);
  view.setUint32(20 + text.length, vertices.byteLength, true); view.setUint32(24 + text.length, 0x004e4942, true); new Uint8Array(bytes, 28 + text.length).set(new Uint8Array(vertices.buffer));
  return bytes;
}
afterEach(() => vi.unstubAllGlobals());
describe('cached model source and fresh preview resources', () => {
  it('loads and disposes a real scene, then creates another layer from cached GLB bytes without a HEAD or GET refetch', async () => {
    const fetch = vi.fn(async () => new Response(triangleGlb(), { headers: { 'content-type': 'model/gltf-binary' } })); vi.stubGlobal('fetch', fetch);
    const load = vi.fn(async () => ({ createTruckLayer }));
    const first = await loadTruck(new AbortController().signal, load);
    expect(first?.layer.id).toBe('drive-truck'); first!.dispose();
    const second = await loadTruck(new AbortController().signal, load);
    expect(second?.layer.id).toBe('drive-truck'); expect(second!.layer).not.toBe(first!.layer);
    expect(fetch).toHaveBeenCalledTimes(2); // First HEAD and GET only; parsed Three scenes are never reused.
    second!.dispose(); second!.dispose();
  });
});
