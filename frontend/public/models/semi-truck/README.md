# Supplied truck model

`semi-truck.glb` is the founder-supplied **Truck with trailer** by Rgsdev, converted from FBX to glTF.
Source: https://opengameart.org/content/free-low-poly-vehicles-pack
Licence: CC0 - https://creativecommons.org/publicdomain/zero/1.0/

Inspected model: Y-up, metres, about 13 m long, nose toward +Z. Keep all axis, yaw, scale and screen-size
tuning in `src/drive/modelConfig.ts`. The longest edge is normalised to one unit and rendered at 72 px.
Do not replace the supplied asset without founder instructions.

The loader tries this GLB first; a compatible `scene.gltf` with its referenced binary/textures remains a
fallback. Unsupported or missing models silently retain the Tabler truck badge. No Draco/KTX decoder
downloads are used. Source bytes are cached in page memory; each Play owns a fresh parsed scene and
disposable GPU resources. Model and Three chunks are runtime-cached and excluded from PWA precache.

Verify heading, ground contact, credits and frame rate in Chrome after any model-tuning changes.
