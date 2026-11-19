// The street cat (blender/cat.blend): a ginger tabby who keeps the parked scooter's seat warm.
//
// Dry, she sits up on the seat, tail wrapped round her paws: her head follows whatever moves (a dog
// going by most of all, then people, the kids' ball), the tip of her tail twitches, an ear flicks now and
// then, and every so often she lifts a paw and washes her face. When the rain comes, a moment later
// she's off the seat (a ballistic leap to the footpath), darts to the building gate and sits on its step
// under the beam, washing the rain out of her fur more often than usual and flicking her ears at the
// drips. Once it's been dry a while she strolls back, hops up onto the seat (another leap) and settles.
//
// Two figures from cat.glb share the job: `cat` (standing, jointed like the dogs, for walking, running and
// leaping) and `cat_sit` (sitting, with head, tail_tip, ear_l, ear_r, paw_r and its elbow_r); she swaps from
// one to the other as she stops or sets off.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';

const P = (x, y) => ({ x, z: -y });                                // Blender plan -> three plan
const G = 4.2;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dz, dx);
const ease = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

const SEAT = { ...P(1.17, -0.75), y: 0.56, yaw: -Math.PI / 2 + 0.5 };   // on the scooter's seat, facing the street
const BESIDE = { ...P(1.2, -0.42), y: 0.15 };                            // on the footpath behind the scooter
const GATE = { ...P(1.74, 0.12), y: 0.22, yaw: -Math.PI / 2 + 0.3 };     // on the gate's step under the beam, by the watchman

function groundAt(x, z) { return x > 0.75 && x < 1.85 && z > -0.4 && z < 0.1 ? 0.22 : 0.15; }

export function makeCat(parent, impacts) {
  const group = new THREE.Group();
  group.name = 'cat';
  parent.add(group);
  const tmp = new THREE.Vector3();
  let C = null;

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/cat.glb`).then((gltf) => {
    const find = (n) => gltf.scene.getObjectByName(n);
    const walkFig = find('cat'), sitFig = find('cat_sit');
    const holder = new THREE.Group();
    group.add(holder);
    const J = {};
    for (const fig of [walkFig, sitFig]) {
      fig.position.set(0, 0, 0);
      holder.add(fig);
      fig.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
        const m = !o.isMesh && o.name.match(/^(leg_fl|leg_fr|leg_bl|leg_br|low_fl|low_fr|low_bl|low_br|head|tail|tail_tip|ear_l|ear_r|paw_r|elbow_r)\d*$/);
        if (m) J[(fig === sitFig ? 's_' : '') + m[1]] = o;
      });
    }
    C = { holder, walkFig, sitFig, J, pos: { x: SEAT.x, z: SEAT.z }, y: SEAT.y, yaw: SEAT.yaw, speed: 0, phase: 0,
      state: 'seat', wait: 0, path: [], leap: null, look: 0, groom: rand(8, 20), groomT: -1, ear: { l: 0, r: 0 }, flick: 0, dry: 0 };
    sitFig.visible = true; walkFig.visible = false;
    return group;
  });

  function moveTo(target, vmax, dt) {
    const dx = target.x - C.pos.x, dz = target.z - C.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { C.speed = Math.max(0, C.speed - 4 * dt); return true; }
    const want = Math.min(vmax, Math.sqrt(2 * 4 * d));
    C.speed += THREE.MathUtils.clamp(want - C.speed, -6 * dt, 6 * dt);
    C.yaw += THREE.MathUtils.clamp(wrap(yawTo(dx, dz) - C.yaw), -9 * dt, 9 * dt);
    const s = Math.min(d, C.speed * dt);
    C.pos.x += (dx / d) * s; C.pos.z += (dz / d) * s;
    return false;
  }

  function startLeap(to, after) {
    // a ballistic leap: v_y chosen so she lands on `to.y` after T seconds
    const d = Math.hypot(to.x - C.pos.x, to.z - C.pos.z);
    const T = 0.28 + d * 0.35 + Math.max(0, to.y - C.y) * 0.6;
    C.leap = { x0: C.pos.x, z0: C.pos.z, y0: C.y, to, T, t: 0, vy: (to.y - C.y + 0.5 * G * T * T) / T, after };
    C.yaw = yawTo(to.x - C.pos.x, to.z - C.pos.z);
    C.state = 'leap';
  }

  function think(dt, rain) {
    const raining = rain > 0.12;
    C.dry = rain < 0.04 ? C.dry + dt : 0;
    switch (C.state) {
      case 'seat':
        C.wait = raining ? C.wait + dt : 0;
        if (C.wait > 0.7) startLeap(BESIDE, 'run');
        break;
      case 'leap': {
        const L = C.leap;
        L.t += dt;
        const k = Math.min(1, L.t / L.T);
        C.pos.x = THREE.MathUtils.lerp(L.x0, L.to.x, k); C.pos.z = THREE.MathUtils.lerp(L.z0, L.to.z, k);
        C.y = L.y0 + L.vy * L.t - 0.5 * G * L.t * L.t;
        if (k >= 1) {
          C.y = L.to.y; C.leap = null;
          if (L.after === 'run') { C.state = 'run'; C.path = [{ x: 1.72, z: 0.3 }, { x: GATE.x, z: GATE.z }]; C.speed = 0.6; }
          else { C.state = 'seat'; C.yaw = SEAT.yaw; C.speed = 0; }
        }
        break;
      }
      case 'run': case 'stroll': {
        const fast = C.state === 'run';
        while (C.path.length > 1 && Math.hypot(C.path[0].x - C.pos.x, C.path[0].z - C.pos.z) < 0.04) C.path.shift();
        if (moveTo(C.path[0], fast ? 1.35 : 0.32, dt) && C.path.length === 1) {
          if (fast) { C.state = 'shelter'; C.speed = 0; }
          else startLeap(SEAT, 'seat');
        }
        C.y = groundAt(C.pos.x, C.pos.z);
        break;
      }
      case 'shelter':
        C.yaw += THREE.MathUtils.clamp(wrap(GATE.yaw - C.yaw), -4 * dt, 4 * dt);
        if (C.dry > 10) { C.state = 'stroll'; C.path = [{ x: 1.72, z: 0.3 }, { x: BESIDE.x, z: BESIDE.z }]; }
        break;
    }
  }

  function pose(dt, t, rain, watch) {
    const J = C.J;
    const sitting = C.state === 'seat' || C.state === 'shelter';
    C.sitFig.visible = sitting; C.walkFig.visible = !sitting;
    if (!sitting) {
      // walk (lateral sequence) when slow, trot (diagonals) when quick; stretched out in a leap
      const v = C.speed, trot = THREE.MathUtils.clamp((v - 0.35) / 0.4, 0, 1), a = THREE.MathUtils.clamp(v / 0.2, 0, 1);
      C.phase += 2 * Math.PI * (v < 0.02 ? 0 : 1.6 + 1.8 * trot) * dt;
      const off = { bl: 0, fl: Math.PI * (0.5 + 0.5 * trot), br: Math.PI, fr: Math.PI * (1.5 + 0.5 * trot) };
      const L = C.leap, lk = L ? Math.min(1, L.t / L.T) : 0;
      for (const k of ['fl', 'fr', 'bl', 'br']) {
        const f = C.phase + off[k], front = k[0] === 'f';
        let up = Math.sin(f) * a * (0.4 + 0.15 * trot);
        let low = (front ? -1 : 1) * Math.max(0, Math.cos(f)) * a * (0.55 + 0.3 * trot);
        if (L) { // launch: hind legs drive back; flight: stretched; landing: front paws reach for the ground
          up = front ? 0.9 * Math.sin(Math.PI * lk) + 0.4 * lk : -0.9 * Math.sin(Math.PI * Math.min(1, lk * 1.4));
          low = front ? -0.2 : 0.2;
        }
        if (J['leg_' + k]) J['leg_' + k].rotation.z = up;
        if (J['low_' + k]) J['low_' + k].rotation.z = low;
      }
      C.walkFig.rotation.z = L ? 0.35 * Math.cos(Math.PI * lk) * (L.to.y > L.y0 ? 1 : -0.6) : 0;
      if (J.head) J.head.rotation.set(0, 0, L ? 0.15 : 0.05 * a * Math.sin(C.phase * 2));
      // the tail swishes side to side (rotation.x on this rig), held low and straight out when she runs
      if (J.tail) J.tail.rotation.set(0.25 * Math.sin(t * 3), 0, C.state === 'run' ? 0.9 : 0);
    } else {
      // watching: turn the head to whatever is moving nearby, else a slow look about
      let want = 0.6 * Math.sin(t * 0.17 + 1) * Math.sin(t * 0.07);
      if (watch) {
        C.sitFig.worldToLocal(tmp.copy(watch));
        want = THREE.MathUtils.clamp(Math.atan2(-tmp.z, tmp.x), -1.4, 1.4);
      }
      // grooming: the paw comes up to the mouth, head down to meet it, a few licks; more often when wet
      C.groom -= dt;
      if (C.groom <= 0 && C.groomT < 0) C.groomT = 0;
      let gk = 0;
      if (C.groomT >= 0) {
        C.groomT += dt;
        gk = ease(C.groomT / 0.5) * (1 - ease((C.groomT - 3.2) / 0.5));
        if (C.groomT > 3.7) { C.groomT = -1; C.groom = C.state === 'shelter' ? rand(5, 12) : rand(14, 32); }
      }
      C.look += ((gk > 0.1 ? 0 : want) - C.look) * Math.min(1, dt * 3);
      // (the model's lick pose: head -0.2, paw_r (-0.35, 0, 1.0), elbow_r 1.5 puts the pads at her mouth)
      const lick = gk * 0.06 * Math.max(0, Math.sin(t * 9));
      if (J.s_head) J.s_head.rotation.set(0, C.look, -0.2 * gk - lick + (rain > 0.3 && C.state === 'shelter' ? 0.15 * Math.max(0, Math.sin(t * 0.3)) : 0));
      if (J.s_paw_r) J.s_paw_r.rotation.set(-0.35 * gk, 0, 1.0 * gk);
      if (J.s_elbow_r) J.s_elbow_r.rotation.z = 1.5 * gk;
      // the tail tip twitches; ears flick now and then (at the drips, in the rain)
      C.flick += dt * (2 + 6 * Math.max(0, Math.sin(t * 0.7)));
      // (tail_tip: y < 0 swishes it out along the ground, y > 0 in towards her paws; z > 0 lifts it, never below 0)
      if (J.s_tail_tip) J.s_tail_tip.rotation.set(0, -0.12 + 0.28 * Math.sin(C.flick) * Math.max(0.3, Math.sin(t * 0.37)), 0.3 * Math.max(0, Math.sin(t * 0.9 + 2)) ** 3);
      for (const s of ['l', 'r']) {
        if (Math.random() < dt * (rain > 0.12 ? 0.8 : 0.15)) C.ear[s] = 1;
        C.ear[s] = Math.max(0, C.ear[s] - dt * 6);
        if (J['s_ear_' + s]) J['s_ear_' + s].rotation.x = (s === 'l' ? -1 : 1) * 0.5 * Math.sin(Math.PI * C.ear[s]); // a flick out and back
      }
    }
    C.holder.position.set(C.pos.x, C.y, C.pos.z);
    C.holder.rotation.y = C.yaw;
  }

  return {
    group, ready,
    get cat() { return C; },
    /** for the stories: back on the scooter's seat at once */
    home() {
      if (!C) return;
      Object.assign(C, { state: 'seat', pos: { x: SEAT.x, z: SEAT.z }, y: SEAT.y, yaw: SEAT.yaw, speed: 0, leap: null, path: [], wait: 0 });
    },
    /** watch: a world point she should look at (a passing dog, someone close by), or null */
    update(dt, t, rain, watch) {
      if (!C) return;
      think(dt, rain);
      pose(dt, t, rain, watch);
    },
  };
}
