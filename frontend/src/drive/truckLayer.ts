// This module and three.js are reached only after the first preview with a model.
import { MercatorCoordinate } from 'maplibre-gl';
import type { Map, CustomLayerInterface } from 'maplibre-gl';
import { Box3, Vector3, Matrix4, Camera, Scene, Group, HemisphereLight, DirectionalLight, WebGLRenderer, Mesh, Texture, Color, LoadingManager, DataTexture, PlaneGeometry, MeshBasicMaterial, LinearFilter } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL } from './modelConfig';
import type { TruckRenderer } from './loadTruck';
import { modelBytes } from './modelAssets';

export async function createTruckLayer(url: string, signal: AbortSignal): Promise<TruckRenderer> {
  const bytes = await modelBytes(url, signal), decoder = new TextDecoder();
  const binary = url.endsWith('.glb');
  const json = binary ? decoder.decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))) : decoder.decode(bytes);
  const manifest = JSON.parse(json) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  const base = new URL('.', new URL(url, location.href)).href;
  const resources = new globalThis.Map<string, string>();
  const manager = new LoadingManager(); manager.setURLModifier(path => resources.get(new URL(path, base).href) ?? path);
  // Fetch glTF sidecars ourselves so closing a preview aborts every network request.
  // GLTFLoader receives temporary blob URLs only; none are stored or deployed.
  let gltf;
  try {
    const uris = [...new Set([...(manifest.buffers ?? []), ...(manifest.images ?? [])].flatMap(entry => entry.uri && !entry.uri.startsWith('data:') ? [entry.uri] : []))];
    const results = await Promise.allSettled(uris.map(async uri => {
      const absolute = new URL(uri, base).href, data = await modelBytes(absolute, signal);
      const type = /\.png$/i.test(uri) ? 'image/png' : /\.jpe?g$/i.test(uri) ? 'image/jpeg' : 'application/octet-stream';
      const blob = new Blob([data], { type }); signal.throwIfAborted(); resources.set(absolute, URL.createObjectURL(blob));
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    signal.throwIfAborted();
    gltf = await new GLTFLoader(manager).parseAsync(binary ? bytes : json, base);
  } finally { resources.forEach(objectUrl => URL.revokeObjectURL(objectUrl)); }
  const scene = new Scene(), camera = new Camera();
  scene.add(gltf.scene);
  let renderer: WebGLRenderer | undefined, map: Map | undefined, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const textures = new Set<Texture>();
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        Object.values(material).forEach(value => { if (value instanceof Texture) textures.add(value); });
        material.dispose();
      }
    });
    textures.forEach(texture => { texture.dispose(); const data = texture.source?.data; if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close(); });
    renderer?.dispose(); scene.clear();
    // Never forceContextLoss(): MapLibre owns this shared WebGL context.
  };
  if (signal.aborted) { dispose(); throw new DOMException('Aborted', 'AbortError'); }
  const bounds = new Box3().setFromObject(gltf.scene), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  const length = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(length) || length <= 0) { dispose(); throw new Error('Empty model'); }
  const normalized = new Group(); normalized.add(gltf.scene);
  normalized.position.set(-center.x / length, -bounds.min.y / length, -center.z / length);
  normalized.scale.setScalar(1 / length);
  const groundY = normalized.position.y;
  // One tiny radial texture and unlit ground plane; no shadow map or extra render pass.
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const falloff = Math.max(0, 1 - Math.hypot((x - 15.5) / 16, (y - 15.5) / 16));
    pixels[(y * 32 + x) * 4 + 3] = Math.round(115 * falloff * falloff);
  }
  const shadowTexture = new DataTexture(pixels, 32, 32); shadowTexture.minFilter = shadowTexture.magFilter = LinearFilter; shadowTexture.needsUpdate = true;
  const shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .001;
  shadow.scale.set(size.x / length + .18, size.z / length + .14, 1);
  shadow.renderOrder = -1;
  const brand = new Color(getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#145D68');
  gltf.scene.traverse(object => {
    if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if ('color' in material && material.color instanceof Color) material.color.lerp(brand, .06);
    }
  });
  const sunlight = new DirectionalLight(0xffffff, 2.4); sunlight.position.set(0, -70, 100);
  scene.add(shadow, normalized, new HemisphereLight(0xffffff, 0x334455, 2), sunlight);
  const pose = { lng: 0, lat: 0, heading: 0 };
  const mc = MercatorCoordinate.fromLngLat([0, 0]);
  const rotation = new Matrix4().makeRotationX(MODEL.upRotationX), yaw = new Matrix4(), model = new Matrix4(), projection = new Matrix4(), scale = new Vector3();
  const layer: CustomLayerInterface = {
    id: 'drive-truck', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      if (disposed) return;
      map = m;
      renderer = new WebGLRenderer({ canvas: m.getCanvas(), context: gl as WebGL2RenderingContext, antialias: false });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      if (!map || !renderer || disposed) return;
      const metresPerPx = 78271.517 * Math.cos(pose.lat * Math.PI / 180) / 2 ** map.getZoom();
      const s = mc.meterInMercatorCoordinateUnits() * MODEL.lengthPixels * metresPerPx * MODEL.scale;
      yaw.makeRotationY(MODEL.yawSign * pose.heading * Math.PI / 180 + MODEL.forwardAxisYaw);
      model.makeTranslation(mc.x, mc.y, mc.z).scale(scale.set(s, -s, s)).multiply(rotation).multiply(yaw);
      camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(model));
      renderer.resetState();
      // MapLibre owns canvas resizing; update only our viewport, never its canvas size.
      renderer.setViewport(0, 0, map.getCanvas().width, map.getCanvas().height);
      renderer.render(scene, camera); renderer.resetState();
    },
    // Style swaps remove the GPU renderer; keep asset geometry for re-add until preview ends.
    onRemove() { renderer?.dispose(); renderer = undefined; map = undefined; },
  };
  return { layer, set(position, heading, bob = 0) {
    normalized.position.y = groundY + size.y / length * bob;
    pose.lng = position[0]; pose.lat = position[1]; pose.heading = heading;
    mc.x = (180 + pose.lng) / 360;
    mc.y = (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + pose.lat * Math.PI / 360))) / 360;
  }, dispose };
}
