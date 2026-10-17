// Asset: rgsdev "Truck with trailer" (CC0), converted FBX -> GLB. Inspected: Y-up after node rotation, metres,
// ~13 m long, nose toward +Z (front wheels at larger Z). Tune only these constants if the heading looks wrong.
export const MODEL = {
  urls: ['/models/semi-truck/semi-truck.glb', '/models/semi-truck/scene.gltf'],
  lengthPixels: 72, // longest bounding-box edge is normalized to one unit, then screen scaled
  upRotationX: Math.PI / 2, // glTF +Y up -> Mercator +Z up
  forwardAxisYaw: Math.PI, // assumed +Z nose: turn it north after Y-up/reflection; tune for the real asset
  yawSign: -1, // clockwise compass heading in the reflected Mercator coordinate system
  scale: 1,
} as const;
export const TRUCK_SOURCE = 'https://opengameart.org/content/free-low-poly-vehicles-pack';
export const TRUCK_CREDIT = '"Truck with trailer" by Rgsdev';
export const TRUCK_LICENSE = 'https://creativecommons.org/publicdomain/zero/1.0/';
export const TRUCK_MODIFICATIONS = 'Converted to glTF.';
