// The family on the motorbike (blender/bike.blend): dad driving, mum side-saddle on the pillion in her
// saree (on the left, as women ride in India), the kid perched on the tank. They ride west through the
// block every so often, keeping left (India drives on the left), which also turns mum's side to the
// street. If the taxi is ahead in the same lane they swing out and overtake on its right, leaning into
// the lane change; slower in the rain, the tyres flinging spray off a wet road.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';

const LANE_Z = 3.95, PASS_Z = 3.4; // westbound, keeping left; and the overtaking line nearer the centre
const rand = (a, b) => a + Math.random() * (b - a);

export function makeBike(parent, clipPlanes) {
  const group = new THREE.Group();
  group.name = 'bike';
  group.visible = false;
  parent.add(group);
  const wheels = [];
  const tmp = new THREE.Vector3();
  let radius = 0.13, length = 0.86, rear = null;
  // headlight beam, switched by the night glow like every other lamp
  const beam = new THREE.SpotLight('#fff1cf', 0, 0, 0.5, 0.5, 2);
  group.add(beam, beam.target);
  const drive = { wait: rand(3, 8), x: 10, z: LANE_Z, vz: 0 };
  group.rotation.y = Math.PI; // facing west

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/bike.glb`).then((gltf) => {
    const model = gltf.scene;
    group.add(model);
    let lamp = null;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        for (const m of [].concat(o.material)) { m.clippingPlanes = clipPlanes; m.clipShadows = true; }
        if ([].concat(o.material)[0].name.startsWith('glow_headlight')) lamp = o;
      }
      if (/^wheel_[fr]\d*$/.test(o.name)) wheels.push(o);
    });
    model.updateMatrixWorld(true);
    // measure: wheel radius (rolling without slipping needs it), the bike's length, the rear tyre
    const box = new THREE.Box3();
    if (wheels.length) {
      box.setFromObject(wheels[0]);
      radius = (box.max.y - box.min.y) / 2;
      rear = wheels.find((w) => w.name.startsWith('wheel_r')) || wheels[0];
    }
    length = new THREE.Box3().setFromObject(model).getSize(tmp).x;
    if (lamp) {
      new THREE.Box3().setFromObject(lamp).getCenter(beam.position);
      group.worldToLocal(beam.position);
      beam.target.position.copy(beam.position).add(new THREE.Vector3(3, -0.35, 0));
    }
    return group;
  });

  return {
    group, ready, beam,
    update(dt, t, rain, wet, impacts, taxi) {
      if (drive.wait > 0) {
        drive.wait -= dt;
        group.visible = false;
        if (drive.wait <= 0) { drive.x = 10; drive.z = LANE_Z; drive.vz = 0; group.visible = true; }
        return;
      }
      const v = 2.9 * (1 - 0.3 * rain); // ~25 km/h in town, slower in the wet
      drive.x -= v * dt;
      // overtake the taxi on its right if it's just ahead, then pull back in once past
      const gap = taxi && taxi.visible ? drive.x - taxi.position.x : 99;
      const wantZ = gap > -0.9 && gap < 2.2 ? PASS_Z : LANE_Z;
      const az = THREE.MathUtils.clamp((wantZ - drive.z) * 6 - drive.vz * 4, -2.5, 2.5); // a damped steer
      drive.vz += az * dt; drive.z += drive.vz * dt;
      group.position.set(drive.x, Math.abs(Math.sin(t * 17)) * 0.0025, drive.z);
      // a bike leans into the turn: tan(lean) = lateral acceleration / g; plus small balance corrections
      group.rotation.x = Math.atan2(az, 4.2) * 0.8 + 0.015 * Math.sin(t * 1.1) + 0.008 * Math.sin(t * 2.7);
      group.rotation.z = 0;
      for (const w of wheels) w.rotation.z -= (v * dt) / radius;  // ω = v / r
      if (wet > 0.25 && Math.abs(drive.x) < 7.6 && rear) {
        let n = wet * v * 30 * dt;
        for (; n > 0; n--) {
          if (n < 1 && Math.random() > n) break;
          rear.getWorldPosition(tmp);
          impacts.droplet(tmp.x + radius * 0.6, 0.03, tmp.z + rand(-0.03, 0.03), v * 0.3 + rand(0, 0.4), rand(0.4, 0.9), rand(-0.15, 0.15));
        }
      }
      if (drive.x < -10) drive.wait = rand(10, 24);
    },
    get length() { return length; },
  };
}
