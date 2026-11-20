// Blender models that replace the code stand-ins.
//
// Export from Blender as glTF Binary (.glb) into public/models/ with one of the names below.
// On load, each file that exists replaces the stand-in group of the same name and keeps its
// click card. Files that don't exist are skipped, so models can be added one at a time.
//
// Placement:
// - Models from this project's Blender files carry a `native` flag on their root and are placed exactly
//   as authored (origin on the group's origin, already in scene units).
// - Any other model is scaled to the stand-in's height and centred on its footprint.
//
// Conventions the app picks up:
// - Materials whose name starts with "glow" (glow_headlight, glow_tail…) light up at night.
// - Objects named "wheel_…" spin when their vehicle drives.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';
import { loading } from './loading.js';

export const slots = [
  { name: 'rickshaw', file: 'rickshaw.glb' },
  { name: 'taxi', file: 'taxi.glb' },
  { name: 'walker', file: 'walker.glb' },
];

/** Loads every model that exists. Calls onLoad(slotName, model, group) for each one. */
export async function swapInModels(world, onLoad) {
  await Promise.all(slots.map(async (slot) => {
    const group = world.getObjectByName(slot.name);
    if (!group) return;
    const url = `${import.meta.env.BASE_URL}models/${slot.file}`;
    try {
      const res = await fetch(url);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('text/html')) return; // not made yet
      const gltf = await gltfLoader.parseAsync(await loading.read(url, res), '');
      const model = gltf.scene;
      let native = false;
      model.traverse((o) => {
        if (o.userData && o.userData.native) native = true;
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      if (native) group.add(model);
      else fit(group, model);
      // hide the stand-in pieces (lights stay, so lamps keep glowing)
      group.children.forEach((ch) => { if (ch.isMesh || (ch !== model && ch.isGroup)) ch.visible = false; });
      onLoad?.(slot.name, model, group);
    } catch (err) {
      console.warn(`[models] couldn't load ${slot.file}:`, err);
    } finally {
      loading.ready(url);
    }
  }));
}

function fit(group, model) {
  // measure the stand-in in the group's own space
  group.updateWorldMatrix(true, true);
  const inv = group.matrixWorld.clone().invert();
  const want = new THREE.Box3();
  group.traverse((o) => { if (o.isMesh) want.union(new THREE.Box3().setFromObject(o).applyMatrix4(inv)); });
  const have = new THREE.Box3().setFromObject(model);
  const s = want.getSize(new THREE.Vector3()).y / have.getSize(new THREE.Vector3()).y;
  model.scale.multiplyScalar(s);
  const fitted = new THREE.Box3().setFromObject(model);
  const c = fitted.getCenter(new THREE.Vector3());
  const wc = want.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(wc.x - c.x, want.min.y - fitted.min.y, wc.z - c.z));
  group.add(model);
}
