// People on the footpath who react to the rain (models from blender/pedestrians.blend).
//
// Each person is a small state machine:
//   errand   walk along the footpath to somewhere (a shop counter, the chai stall, the thela, the
//            shrine, the post box) and linger there a while
//   rush     rain! after a moment's reaction, run for the nearest free spot under cover (an awning,
//            the chai tarp, the building gate), a hand over the head
//   shelter  wait it out, looking about; when the rain slows or stops, after a while...
//   peek     ...step out past the edge, look up and hold a palm out
//   back     still raining: go back under cover, and wait longer before the next look
//            (stopped: off they go on another errand)
// Anyone already under cover when the rain starts (at a shop counter, at the chai stall) just stays.
// Whether a spot is covered is read from the shelter map (the height of the first surface above it),
// so the shelters are where the rain really can't reach. Clothes darken while someone is out in it.
//
// Plan positions are three.js (x, z); the street was laid out in Blender (x, y) with z = -y.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';
import { gait, joints } from './gait.js';

const P = (x, y) => ({ x, z: -y }); // Blender plan -> three plan
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angTo = (dx, dz) => Math.atan2(-dz, dx); // yaw that faces a figure (+X forward) along (dx, dz)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// the walking line along the footpath, kept clear of the chai stall, stools, post box, scooter,
// milk bicycle, streetlight, tree and shrine; it crosses the side lane between x 3.6 and 5.6
const WALK = [P(-7.55, -0.75), P(-5.2, -0.85), P(-4.75, -1.05), P(-3.4, -1.05), P(-3.05, -1.12), P(-2.45, -1.15),
  P(-2.1, -0.9), P(-0.55, -0.62), P(0.15, -0.62), P(0.75, -1.08), P(1.95, -1.08), P(2.4, -0.48), P(3.45, -0.48),
  P(3.75, -0.6), P(5.45, -0.6), P(5.8, -0.85), P(6.25, -1.05), P(7.15, -1.05), P(7.55, -0.95)];
function walkZ(x) {
  if (x <= WALK[0].x) return WALK[0].z;
  for (let i = 1; i < WALK.length; i++) {
    const a = WALK[i - 1], b = WALK[i];
    if (x <= b.x) return a.z + ((x - a.x) / (b.x - a.x)) * (b.z - a.z);
  }
  return WALK[WALK.length - 1].z;
}
// footpath top 0.15; the side lane is at road level; the building gate has a step
function groundAt(x, z) {
  if (x > 3.62 && x < 5.58) return 0.012;
  if (x > 3.55 && x < 5.65) return 0.012 + 0.138 * (Math.min(Math.abs(x - 3.55), Math.abs(x - 5.65)) < 0.07 ? 1 - Math.min(Math.abs(x - 3.55), Math.abs(x - 5.65)) / 0.07 : 0);
  if (x > 0.75 && x < 1.85 && z < 0.1) return 0.22;
  return 0.15;
}

// errands: where to stand and what to face
const ERRANDS = [
  { at: P(-5.2, -0.12), look: P(-5.2, 0.3) }, { at: P(-4.85, -0.16), look: P(-4.9, 0.3) },   // kirana counter
  { at: P(-3.85, -1.05), look: P(-3.85, -0.6) }, { at: P(-4.2, -1.04), look: P(-4.15, -0.6) }, // chai stall
  { at: P(-1.5, -0.1), look: P(-1.5, 0.3) }, { at: P(-0.9, -0.12), look: P(-0.9, 0.3) },       // medical counter
  { at: P(6.15, -0.1), look: P(6.15, 0.3) },                                                    // xerox
  { at: P(-6.55, -1.1), look: P(-6.55, -1.85) }, { at: P(-6.2, -1.1), look: P(-6.45, -1.85) },  // the thela
  { at: P(7.08, -0.66), look: P(7.375, -0.28) },                                                // the shrine
  { at: P(-0.2, -0.72), look: P(-0.2, -0.95) },                                                 // post box
];
// places to wait out the rain: where to stand, and where to step out to look at the sky
const SLOTS = [
  ...[P(-6.6, -0.5), P(-5.75, -0.3), P(-5.35, -0.42), P(-4.95, -0.3)].map((at) => ({ at, out: { x: at.x, z: at.z + 0.5 } })), // kirana awning
  { at: P(-4.3, -1.0), out: P(-4.85, -1.0) }, { at: P(-3.95, -1.06), out: P(-4.85, -1.08) }, { at: P(-3.6, -1.02), out: P(-2.95, -1.14) }, // chai tarp
  ...[P(-2.45, -0.3), P(-2.05, -0.22), P(-1.6, -0.3), P(-1.15, -0.22), P(-0.6, -0.3), P(0.2, -0.25)].map((at) => ({ at, out: { x: at.x, z: at.z + 0.5 } })), // medical awning
  { at: P(1.05, 0.12), out: P(0.85, -0.6), via: [P(0.85, -0.6)] },                              // the building gate
  { at: P(5.95, -0.22), out: P(5.95, -0.72) }, { at: P(6.3, -0.18), out: P(6.3, -0.68) },       // xerox awning
];

const RAIN_ON = 0.15;   // heavier than this and people run for cover
const RAIN_OFF = 0.05;  // lighter than this counts as stopped

export function makeCrowd(parent) {
  const group = new THREE.Group();
  group.name = 'crowd';
  parent.add(group);
  const people = [];
  let heightAt = null;
  let rainPeak = 0;
  const tmp = new THREE.Vector3();

  const covered = (p) => heightAt ? heightAt(p.x, p.z) > groundAt(p.x, p.z) + 0.8 : false;

  // from wherever they are, onto the walking line, along it, and off it to where they're going
  // (via: the way into a tucked-away spot like the gate, walked backwards on the way out)
  function route(from, to, viaFrom = [], viaTo = []) {
    const pts = [...viaFrom].reverse();
    const s = pts.length ? pts[pts.length - 1] : from;
    const e = viaTo.length ? viaTo[0] : to;
    const a = { x: s.x, z: walkZ(s.x) }, b = { x: e.x, z: walkZ(e.x) };
    if (dist(a, s) > 0.05) pts.push(a);
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    const mid = WALK.filter((w) => w.x > lo + 0.02 && w.x < hi - 0.02);
    if (b.x < a.x) mid.reverse();
    pts.push(...mid);
    if (dist(b, e) > 0.05) pts.push(b);
    pts.push(...viaTo, to);
    return pts;
  }

  // somewhere just out from under the cover, to look at the sky from
  function findOut(home) {
    for (const [dx, dz] of [[0, 0.5], [0, 0.7], [-0.6, 0], [0.6, 0], [-0.9, 0.1], [0.9, 0.1]]) {
      const q = { x: home.x + dx, z: Math.min(1.12, home.z + dz) };
      if (!covered(q)) return q;
    }
    return { x: home.x, z: Math.min(1.12, home.z + 0.5) };
  }

  function goErrand(p) {
    const free = ERRANDS.filter((e) => !people.some((q) => q !== p && q.errand === e));
    const choices = free.filter((e) => dist(e.at, p.pos) > 0.6);
    if (Math.random() < 0.3 || !choices.length) { // or just stroll somewhere along the footpath
      const x = rand(-7.3, 7.3);
      p.errand = null;
      p.goal = { at: { x, z: walkZ(x) }, look: null };
    } else {
      p.errand = choices[Math.floor(Math.random() * choices.length)];
      p.goal = p.errand;
    }
    p.path = route(p.pos, p.goal.at, p.slot?.via || []);
    p.releaseSlot();
    p.state = 'errand'; p.moving = true; p.run = false;
  }

  function goShelter(p) {
    const free = SLOTS.filter((s) => s.ok !== false && !people.some((q) => q.slot === s));
    if (!free.length) return false;
    free.sort((a, b) => (Math.abs(a.at.x - p.pos.x) + Math.abs(a.at.z - p.pos.z)) - (Math.abs(b.at.x - p.pos.x) + Math.abs(b.at.z - p.pos.z)));
    p.releaseSlot();
    p.slot = free[0];
    p.errand = null;
    p.path = route(p.pos, p.slot.at, [], p.slot.via || []);
    p.state = 'rush'; p.moving = true; p.run = true;
    return true;
  }

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/pedestrians.glb`).then((gltf) => {
    const roots = [];
    gltf.scene.traverse((o) => { if (/^ped_\d+$/.test(o.name)) roots.push(o); });
    roots.forEach((fig, i) => {
      const holder = new THREE.Group();
      fig.position.set(0, 0, 0);
      holder.add(fig);
      group.add(holder);
      const J = joints(fig);
      const mats = [];
      fig.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          o.material = o.material.clone(); // each person gets wet on their own
          mats.push({ m: o.material, c: o.material.color.clone(), r: o.material.roughness });
        }
      });
      const e = ERRANDS[i % ERRANDS.length];
      const old = i === 0, small = fig.scale.x < 0.9, saree = !J.leg_l;
      const p = {
        holder, fig, J, mats, i,
        pos: { x: e.at.x + rand(-0.3, 0.3), z: walkZ(e.at.x) }, yaw: rand(-3, 3), speed: 0, g: { phase: rand(0, 6) },
        walkSpeed: old ? 0.42 : small ? 0.58 : rand(0.48, 0.56), runSpeed: old ? 0.85 : saree ? 1.1 : small ? 1.35 : rand(1.35, 1.6),
        state: 'errand', path: [], goal: null, errand: null, slot: null, moving: false, run: false,
        wait: 0, alarm: -1, peekIn: 0, patience: 1, wet: 0, shield: 0, look: 0, palm: 0, seed: rand(0, 100),
        releaseSlot() { this.slot = null; },
      };
      people.push(p);
      goErrand(p);
    });
    return group;
  });

  function setShelter(fn) {
    heightAt = fn;
    for (const s of SLOTS) {
      s.ok = covered(s.at);
      if (!s.ok) console.warn('[crowd] not actually covered, skipping shelter spot', s.at);
    }
  }

  function step(p, dt, rain) {
    // where to next on the path, and how fast
    let target = p.path[0];
    while (target && dist(p.pos, target) < 0.05 && p.path.length > 1) { p.path.shift(); target = p.path[0]; }
    const vmax = p.run ? p.runSpeed : p.walkSpeed * (rain > RAIN_OFF && !covered(p.pos) ? 1.2 : 1);
    if (p.moving && target) {
      const remaining = p.path.reduce((s, q, k) => s + dist(k ? p.path[k - 1] : p.pos, q), 0);
      const brake = Math.sqrt(2 * 2.6 * remaining); // slow down in time to stop where they mean to
      const want = Math.min(vmax, brake);
      const acc = want > p.speed ? (p.run ? 3.2 : 1.6) : 3.5;
      p.speed += THREE.MathUtils.clamp(want - p.speed, -acc * dt, acc * dt);
      const d = dist(p.pos, target);
      if (d > 1e-4) {
        const dx = (target.x - p.pos.x) / d, dz = (target.z - p.pos.z) / d;
        const yaw = angTo(dx, dz);
        p.yaw += THREE.MathUtils.clamp(wrap(yaw - p.yaw), -(p.run ? 9 : 6) * dt, (p.run ? 9 : 6) * dt);
        const s = Math.min(d, p.speed * dt);
        p.pos.x += dx * s; p.pos.z += dz * s;
      }
      if (p.path.length === 1 && dist(p.pos, target) < 0.02) { p.moving = false; p.path = []; }
    } else {
      p.speed = Math.max(0, p.speed - 3.5 * dt);
    }
  }

  function arrive(p) {
    const face = (pt) => pt && (p.faceYaw = angTo(pt.x - p.pos.x, pt.z - p.pos.z));
    if (p.state === 'errand') { p.state = 'linger'; p.wait = p.errand ? rand(3, 9) : rand(0.6, 2); face(p.goal.look); }
    else if (p.state === 'rush' || p.state === 'back') { p.state = 'shelter'; p.run = false; p.peekIn = rand(4, 9) * p.patience; p.faceYaw = angTo(0, 1); }
    else if (p.state === 'peek') { p.state = 'check'; p.wait = rand(1.6, 2.6); p.faceYaw = angTo(0, 1); }
  }

  function think(p, dt, rain) {
    const raining = rain > RAIN_ON;
    rainPeak = Math.max(rainPeak * Math.exp(-dt / 20), rain); // the recent heaviest, fading over ~20 s
    const easing = rain < rainPeak * 0.6 || rain < 0.3;

    if ((p.state === 'errand' || p.state === 'linger') && raining) {
      if (p.state === 'linger' && covered(p.pos)) { // already under cover: stay put
        p.state = 'shelter'; p.slot = null; p.home = { ...p.pos }; p.peekIn = rand(6, 12); return;
      }
      if (p.alarm < 0) p.alarm = rand(0.3, 1.4) / (0.5 + rain); // a moment to notice and decide
      p.alarm -= dt;
      if (p.alarm <= 0) { p.alarm = -1; goShelter(p); }
      return;
    }
    p.alarm = -1;
    if (p.state === 'linger') { p.wait -= dt; if (p.wait <= 0) goErrand(p); return; }
    if (p.state === 'shelter') {
      if (!easing && rain > RAIN_OFF) { p.peekIn = Math.max(p.peekIn, rand(3, 6) * p.patience); return; }
      p.peekIn -= dt;
      if (p.peekIn <= 0) { // step out and look
        const home = p.slot ? p.slot.at : p.home;
        const out = p.slot ? p.slot.out : findOut(home);
        p.state = 'peek'; p.moving = true; p.run = false; p.path = [out];
      }
      return;
    }
    if (p.state === 'check') {
      p.wait -= dt;
      if (rain > 0.35) { p.state = 'back'; p.run = true; p.moving = true; p.path = [p.slot ? p.slot.at : p.home]; return; }
      if (p.wait <= 0) {
        if (rain < RAIN_OFF) { p.patience = 1; goErrand(p); } // it's stopped: on with the day
        else { p.state = 'back'; p.moving = true; p.patience = Math.min(3, p.patience * 1.4); p.path = [p.slot ? p.slot.at : p.home]; }
      }
    }
    if ((p.state === 'peek' || p.state === 'back') && rain > 0.35) p.run = true;
  }

  function separate() {
    for (let a = 0; a < people.length; a++) {
      for (let b = a + 1; b < people.length; b++) {
        const A = people[a], B_ = people[b];
        const d = dist(A.pos, B_.pos), min = 0.17;
        if (d < min && d > 1e-4) {
          const k = (min - d) / d * 0.5;
          const dx = (A.pos.x - B_.pos.x) * k, dz = (A.pos.z - B_.pos.z) * k;
          if (A.moving) { A.pos.x += dx; A.pos.z += dz; }
          if (B_.moving) { B_.pos.x -= dx; B_.pos.z -= dz; }
        }
      }
    }
  }

  function animate(p, dt, t, rain, streetWet, impacts) {
    const { J } = p;
    const { run, a, swing, elbow, strikes } = gait(p.g, J, p.fig, p.speed, dt);
    for (const k of strikes) { // a heel strikes the wet footpath: splash
      if (streetWet < 0.25) break;
      p.fig.localToWorld(tmp.set(0.12 + 0.08 * run, 0, k === 'l' ? -0.04 : 0.04));
      impacts.ring(tmp.x, tmp.y + 0.002, tmp.z, 0.7 + run * 0.5);
      for (let i = 0; i < 2 + run * 4; i++) impacts.droplet(tmp.x, tmp.y + 0.02, tmp.z, rand(-0.25, 0.15) - run * 0.3 * Math.cos(p.yaw), rand(0.25, 0.5 + run * 0.3), rand(-0.2, 0.2));
    }
    // arms swing against the legs, elbows bending to ~90° in a run. Running through rain, the right hand
    // goes over the head; checking the sky, the left is held out palm up
    const shieldGoal = p.run && rain > RAIN_OFF && !covered(p.pos) ? 1 : 0;
    p.shield += (shieldGoal - p.shield) * Math.min(1, dt * 6);
    const palmGoal = p.state === 'check' ? 1 : 0;
    p.palm += (palmGoal - p.palm) * Math.min(1, dt * 4);
    const L = THREE.MathUtils.lerp;
    if (J.arm_l) J.arm_l.rotation.set(L(0, 0.3, p.palm), 0, L(-swing, 1.05 + 0.05 * Math.sin(t * 3), p.palm));
    if (J.elbow_l) J.elbow_l.rotation.z = L(elbow + 0.15 * run * Math.max(0, -Math.sin(p.g.phase)), 0.6, p.palm);
    if (J.arm_r) J.arm_r.rotation.set(L(0, -0.55, p.shield), 0, L(swing, 2.6, p.shield));
    if (J.elbow_r) J.elbow_r.rotation.z = L(elbow + 0.15 * run * Math.max(0, Math.sin(p.g.phase)), 1.75, p.shield);
    // head: duck in the rain, look up at the sky to check it, look about while waiting
    const idle = p.state === 'shelter' || p.state === 'linger';
    const lookGoal = p.state === 'check' ? 0.5 : p.shield > 0.5 ? -0.18 : idle ? 0.08 * Math.sin(t * 0.21 + p.seed) + (p.state === 'shelter' ? 0.12 : 0) : 0;
    p.look += (lookGoal - p.look) * Math.min(1, dt * 3);
    if (J.head) {
      J.head.rotation.z = p.look;
      J.head.rotation.y = idle ? 0.55 * Math.sin(t * 0.33 + p.seed) * Math.sin(t * 0.12 + p.seed * 2) : 0;
    }
    p.fig.rotation.z -= 0.06 * p.shield; // hunched a little under the rain
    // turn to face what they came for once they've stopped
    if (!p.moving && p.faceYaw != null) p.yaw += THREE.MathUtils.clamp(wrap(p.faceYaw - p.yaw), -3 * dt, 3 * dt);
    p.holder.position.set(p.pos.x, groundAt(p.pos.x, p.pos.z), p.pos.z);
    p.holder.rotation.y = p.yaw;
  }

  function soak(p, dt, rain) {
    // clothes and hair darken as they soak (~15 s in a downpour) and dry over a few minutes
    const out = rain > RAIN_OFF && !covered(p.pos);
    p.wet = THREE.MathUtils.clamp(p.wet + (out ? rain * 0.07 : -0.004) * dt, 0, 1);
    if (Math.abs(p.wet - (p.wetShown ?? -1)) < 0.01) return;
    p.wetShown = p.wet;
    const e = 1 + 0.7 * p.wet, k = 1 - 0.1 * p.wet;
    for (const { m, c, r } of p.mats) {
      m.color.setRGB(c.r ** e * k, c.g ** e * k, c.b ** e * k);
      m.roughness = THREE.MathUtils.lerp(r, Math.min(r, 0.45), p.wet);
    }
  }

  return {
    group, ready, setShelter, people,
    update(dt, t, rain, streetWet, impacts) {
      for (const p of people) {
        think(p, dt, rain);
        step(p, dt, rain);
        if (!p.moving && p.path.length === 0 && ['errand', 'rush', 'back', 'peek'].includes(p.state)) arrive(p);
      }
      separate();
      for (const p of people) { animate(p, dt, t, rain, streetWet, impacts); soak(p, dt, rain); }
    },
  };
}
