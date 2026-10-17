import type { CustomLayerInterface } from 'maplibre-gl';
import type { Coordinate } from '../lib/geometry';
import { MODEL } from './modelConfig';
export interface TruckRenderer { layer: CustomLayerInterface; set(position: Coordinate, heading: number, bob?: number): void; dispose(): void }
const importLayer = () => import('./truckLayer');
const availableModels = new WeakMap<typeof importLayer, string>();
// Vite's SPA fallback returns index.html with status 200 for absent public files.
// Probe before importing WebGL code, and reject that HTML response silently.
export async function loadTruck(signal: AbortSignal, load = importLayer): Promise<TruckRenderer | null> {
  const known = availableModels.get(load);
  for (const url of known ? [known, ...MODEL.urls.filter(url => url !== known)] : MODEL.urls) {
    if (signal.aborted) return null;
    try {
      if (url !== known) {
        const response = await fetch(url, { method: 'HEAD', signal });
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) continue;
      }
      const module = await load();
      if (signal.aborted) return null;
      const renderer = await module.createTruckLayer(url, signal);
      if (signal.aborted) { renderer.dispose(); return null; }
      availableModels.set(load, url);
      return renderer;
    } catch { /* A missing, unsupported or corrupt asset keeps the 2D badge. */ }
  }
  return null;
}
