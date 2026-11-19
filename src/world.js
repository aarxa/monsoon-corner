// The street comes from Blender (public/models/street.glb, exported from blender/street.blend).
// This file loads it and wires up what the names in the Blender scene mean:
//   spot_<story>   click target that opens that story card
//   sway_<axis>_*  swings in the wind around its own origin
//   light_*        where a real light goes (light_door: a doorway's light spilling out);  steam_kettle: where the chai steam rises
//   glow_*         material that lights up at night (glow_win1..6 switch on in batches)
//   *_w<NN>        material that darkens and gets damp in the rain, by NN %
//   edge_*         a point on the edge of a roof sheet (chai tarp, awnings) where runoff drips off;
//                  its parent is the roof, its `w` extra how much of the runoff leaves there
//   fan_*          an AC fan; spins about its own Y axis (Blender Z), `rpm` extra for its speed
//   perch          a ledge or wire the pigeons sit along (extras a, b, sag, nx, ny, kind)
//   room           the middle of a window pane; src/rooms.js draws the room behind it (extras w, h, nx, ny, kind)
import * as THREE from 'three';
import { gltfLoader } from './loader.js';

export const wettable = []; // { mat, color, rough, k }

/** Registers glow and wet materials found under a loaded model. */
export function registerMaterials(root, W) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of [].concat(o.material)) {
      if (m.userData.registered) continue;
      m.userData.registered = true;
      for (const t of [m.map, m.normalMap]) if (t) t.anisotropy = 8; // keeps the ground crisp at low angles
      // printed signs, posters and handbills sit a hair in front of their boards and walls; nudge them
      // forward in the depth buffer too, or the two surfaces fight over the same pixels and flicker
      if (/^(signimg_|glow_sign_|glow_billboard)/.test(m.name)) {
        m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4;
      }
      if (m.name.startsWith('glow')) {
        const win = m.name.match(/^glow_win(\d)/);
        const thr = win ? 0.46 + (+win[1] - 1) * 0.08 : m.name === 'glow_tv' ? 0.6 : null;
        // windows glow softly, like rooms lit by one tube light, not like lamps
        const max = m.emissiveIntensity * (thr != null ? 0.32 : 1);
        W.glow.push({ mat: m, max, thr });
        m.emissiveIntensity = 0;
      }
      const wet = m.name.match(/_w(\d+)$/);
      if (wet) wettable.push({ mat: m, color: m.color.clone(), rough: m.roughness, k: +wet[1] / 100 });
    }
  });
}

export function buildWorld(scene) {
  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);
  const W = { world, glow: [], sway: [], hotspots: [], spouts: [], drips: [], edges: [], fans: [], foliage: [], rooms: [], perches: [], kettleTop: new THREE.Vector3(-4.0, 0.82, 0.62) };

  // real lights; they move to the light_* markers once the street loads
  const point = (color, max) => {
    const l = new THREE.PointLight(color, 0, 0, 2); // physically based: inverse-square falloff
    world.add(l);
    W.glow.push({ light: l, max });
    return l;
  };
  const lights = {
    light_bulb: point('#ffc070', 1.6),     // 40 W bulb under the tarp
    light_shop: point('#ffd9a0', 3.0),     // kirana tube light
    light_med: point('#eaf6ff', 3.4),      // pharmacy, brightest shop on the street
    light_xerox: point('#eaf6ff', 2.2),
    light_shrine: point('#ffb347', 0.35),  // one diya
    light_thela: point('#ffcf7a', 1.0),    // a small lantern
  };
  const lamp = new THREE.SpotLight('#ffa64a', 0, 0, 1.0, 0.6, 2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0008;
  lamp.shadow.radius = 3;
  world.add(lamp, lamp.target);
  W.glow.push({ light: lamp, max: 85 });
  W.lamp = lamp;

  // vehicles: empty slots that their Blender models drop into (see models.js)
  const slot = (name, story) => {
    const g = new THREE.Group();
    g.name = name;
    g.userData.story = story;
    world.add(g);
    W.hotspots.push(g);
    return g;
  };
  W.auto = slot('rickshaw', 'rickshaw');
  W.auto.position.set(-1.25, 0, 1.9); // waiting at the kerb by the chai stall (India drives on the left)
  W.taxi = slot('taxi', 'taxi');
  W.taxi.position.set(12, 0, 4.3);
  W.taxi.rotation.y = Math.PI; // heading left, in the near lane
  W.taxi.visible = false;
  const beam = new THREE.SpotLight('#fff1cf', 0, 0, 0.55, 0.5, 2);
  beam.position.set(0.95, 0.35, 0);
  beam.target.position.set(4, 0, 0);
  W.taxi.add(beam, beam.target);
  W.glow.push({ light: beam, max: 28 });
  // someone walking along the road edge (umbrella up when it rains)
  W.walker = new THREE.Group();
  W.walker.name = 'walker';
  W.walker.position.set(-9, 0, 1.38);
  W.walker.visible = false;
  world.add(W.walker);

  W.ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/street.glb`).then((gltf) => {
    const street = gltf.scene;
    world.add(street);
    street.updateMatrixWorld(true);
    registerMaterials(street, W);
    const v = new THREE.Vector3();
    street.traverse((o) => {
      const n = o.name;
      if (o.isMesh && [].concat(o.material)[0]?.name.startsWith('leafcard')) W.foliage.push(o);
      if (n.includes('__')) return; // merged meshes are named <parent>__<material>
      if (n.startsWith('spot_')) {
        o.userData.story = n.slice(5);
        W.hotspots.push(o);
      } else if (n.startsWith('sway_')) {
        const axis = n[5];
        const amt = n.includes('cloth') ? 0.22 : n.includes('crown') ? 0.035 : 0.03;
        W.sway.push({ obj: o, axis, base: o.rotation[axis], phase: Math.random() * 6, amt });
      } else if (lights[n]) {
        o.getWorldPosition(lights[n].position);
      } else if (n.startsWith('light_door')) {
        // a lit doorway: a soft warm spot from just inside, spilling out over whoever sits in front of it
        const { nx = 0, ny = -1, color = '#ffcf8a', max = 0.9, batch = 1 } = o.userData;
        const spot = new THREE.SpotLight(color, 0, 3.5, 1.15, 1.0, 2);
        o.getWorldPosition(spot.position);
        spot.target.position.copy(spot.position).add(v.set(nx, -0.32, -ny));
        world.add(spot, spot.target);
        W.glow.push({ light: spot, max, thr: 0.46 + (batch - 1) * 0.08 }); // on with its batch of windows
      } else if (n === 'light_lamp') {
        o.getWorldPosition(lamp.position);
        lamp.target.position.copy(lamp.position).add(v.set(-0.6, -3.15, 0.5));
      } else if (n.startsWith('drip') && !o.isMesh) {
        W.drips.push(o);
      } else if (n.startsWith('edge_') && !o.isMesh) {
        W.edges.push(o);
      } else if (n.startsWith('fan_') && o.userData.rpm != null) {
        W.fans.push({ obj: o, rpm: o.userData.rpm });
      } else if (/^room\d*$/.test(n) && !o.isMesh) {
        W.rooms.push(o);
      } else if (/^perch\d*$/.test(n) && !o.isMesh) {
        W.perches.push(o);
      } else if (n.startsWith('spout_')) {
        W.spouts.push(o);
      } else if (n === 'steam_kettle') {
        o.getWorldPosition(W.kettleTop);
      }
    });
    return street;
  });
  return W;
}
