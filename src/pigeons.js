// Kabootar: a flock of rock pigeons (blender/pigeons.blend), drawn instanced, one draw per body part and
// material for the whole flock.
//
// Some peck about the grain scattered on the footpath outside the xerox shop (a little kabootar khana),
// walking with that head-bob of theirs (the head thrusts forward, then holds still while the body catches
// up), pecking, stepping aside for anyone who walks through. The rest sit along the ledges: parapets, window
// chajjas, the hoarding, AC units, balcony rails and the sagging wires, turning their heads, shuffling,
// preening now and then, and dropping down to the grain when it's quiet.
//
// Anything sudden near the grain (a dog trotting in, someone running for cover, a thunderclap) and the lot
// of them go up at once, wheel round the block a lap or so, and come back in ones and twos, some to the
// grain, some to a ledge; and every so often they go round for no reason at all, as pigeons do. When it
// rains they leave the open ledges and the grain for sills and rails under cover (read off the shelter
// map) and sit it out fluffed up; at dusk they go up to roost.
//
// The perches are the `perch` markers along each ledge in the street model (extras a, b, sag, nx, ny, kind).
import * as THREE from 'three';
import { gltfLoader } from './loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COUNT = 26;
const DANA = new THREE.Vector3(6.15, 0.15, 0.8), DANA_R = 0.3;   // the grain, on the footpath by the xerox shop
const WHEEL = { c: new THREE.Vector3(0.6, 6.3, 0.2), rx: 6.4, rz: 4.6 }; // the lap round the block
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const B3 = (v) => new THREE.Vector3(v[0], v[2], -v[1]);           // Blender -> three
const PARTS = ['body', 'head', 'fold', 'wing_l', 'wing_r'];

export function makePigeons(parent) {
  const group = new THREE.Group();
  group.name = 'pigeons';
  parent.add(group);
  const birds = [], slots = [];
  const mesh = {}, pivot = {};
  let covered = () => false, startle = 0, nextLap = rand(30, 60);
  // a scratch skeleton to pose one bird at a time
  const root = new THREE.Object3D(), head = new THREE.Object3D(), wingL = new THREE.Object3D(), wingR = new THREE.Object3D();
  root.add(head, wingL, wingR);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  // the grain: a scatter of tiny yellow-white seeds on the footpath
  {
    const g = new THREE.BoxGeometry(0.006, 0.003, 0.006);
    const seeds = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#e3cf8a', roughness: 0.8 }), 140);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 140; i++) {
      const r = DANA_R * Math.sqrt(Math.random()) * 0.95, a = rand(0, 2 * Math.PI);
      q.setFromAxisAngle(tmp.set(0, 1, 0), rand(0, 3));
      m.compose(tmp2.set(DANA.x + r * Math.cos(a), DANA.y + 0.0015, DANA.z + r * Math.sin(a)), q, tmp.set(1, 1, 1));
      seeds.setMatrixAt(i, m);
    }
    seeds.receiveShadow = true;
    group.add(seeds);
  }

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/pigeons.glb`).then((gltf) => {
    const tints = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [0.66, 0.67, 0.7], [1.38, 1.36, 1.32], [1.1, 0.96, 0.86], [0.85, 0.86, 0.9]];
    for (const p of PARTS) {
      const node = gltf.scene.getObjectByName(`pigeon_${p}`);
      pivot[p] = node.position.clone();
      const geoms = [], mats = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        if (o !== node) g.applyMatrix4(o.matrix);
        geoms.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
        mats.push(o.material);
      });
      const im = new THREE.InstancedMesh(mergeGeometries(geoms, true), mats, COUNT);
      im.castShadow = p === 'body' || p === 'fold';
      im.frustumCulled = false;
      for (let i = 0; i < COUNT; i++) im.setColorAt(i, new THREE.Color(...tints[i % tints.length]));
      group.add(im);
      mesh[p] = im;
    }
    head.position.copy(pivot.head); wingL.position.copy(pivot.wing_l); wingR.position.copy(pivot.wing_r);
    return group;
  });

  // ---------------------------------------------------------------- perches: slots ~13 cm apart along each ledge
  function setPerches(markers) {
    for (const o of markers) {
      const { a, b, sag = 0, nx = 0, ny = -1, kind } = o.userData;
      if (!a) continue;
      const A = B3(a), B = B3(b), len = A.distanceTo(B);
      const n = Math.max(1, Math.floor(len / 0.13));
      let face = new THREE.Vector3(nx, 0, -ny);
      if (kind === 'wire') { face.set(-(B.z - A.z), 0, B.x - A.x).normalize(); if (face.z < 0) face.negate(); }
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const p = A.clone().lerp(B, t);
        p.y -= sag * 4 * t * (1 - t);
        if (kind === 'wire') p.y -= 0.004; else p.y += 0.003;
        slots.push({ p, face: face.clone(), yaw: Math.atan2(-face.z, face.x), kind, bird: null, covered: false });
      }
    }
  }

  function setShelter(heightAt) {
    covered = (p) => heightAt(p.x, p.z) > p.y + 0.12;
    for (const s of slots) s.covered = covered(s.p);
  }

  // ---------------------------------------------------------------- flight
  function freeSlot(bird, wantCover, near) {
    const free = slots.filter((s) => !s.bird && (!wantCover || s.covered));
    if (!free.length) return null;
    if (near) free.sort((a, b) => a.p.distanceTo(near) - b.p.distanceTo(near));
    const pool = near ? free.slice(0, 6) : free;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function danaPoint() {
    const r = DANA_R * 0.8 * Math.sqrt(Math.random()), a = rand(0, 2 * Math.PI);
    return new THREE.Vector3(DANA.x + r * Math.cos(a), DANA.y, DANA.z + r * Math.sin(a));
  }
  function release(b) { if (b.slot) { b.slot.bird = null; b.slot = null; } }

  // a flight from where it is to a point: up and out first, then in from above and in front of where it lands
  function flyTo(b, to, outward, then) {
    const A = b.pos.clone(), d = A.distanceTo(to);
    const out = b.slot ? b.slot.face.clone() : new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
    const c1 = A.clone().addScaledVector(out, Math.min(0.5, 0.15 + d * 0.15)).add(new THREE.Vector3(0, 0.2 + d * 0.06, 0));
    const c2 = to.clone().addScaledVector(outward, Math.min(0.6, 0.2 + d * 0.12)).add(new THREE.Vector3(0, 0.3 + d * 0.05, 0));
    release(b);
    b.state = 'fly';
    b.fl = { A, c1, c2, B: to.clone(), T: 0.9 + d / 3.2, t: 0, then };
  }
  const bez = (f, t, out) => {
    const u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(f.A, u * u * u).addScaledVector(f.c1, 3 * u * u * t).addScaledVector(f.c2, 3 * u * t * t).addScaledVector(f.B, t * t * t);
  };
  function land(b, target) {
    if (target.slot) {
      const s = target.slot;
      if (s.bird && s.bird !== b) { const alt = freeSlot(b, target.cover, s.p); if (alt) return goSlot(b, alt); }
      s.bird = b; b.slot = s; b.state = 'perch'; b.yaw = s.yaw + rand(-0.3, 0.3); b.pos.copy(s.p); b.wait = rand(8, 30);
    } else {
      b.state = 'ground'; b.pos.copy(target.point); b.wait = rand(1, 3); b.goal = null;
    }
  }
  function goSlot(b, s) {
    const tgt = { slot: s, cover: s.covered };
    flyTo(b, s.p, s.face, tgt);   // (lets go of the ledge it was on)
    s.bird = b;                   // and holds the one it's going to
    b.fl.reserve = s;
  }
  function goGround(b) {
    const p = danaPoint();
    flyTo(b, p, new THREE.Vector3(rand(-1, 1), 0, 1).normalize(), { point: p });
  }
  function goWheel(b) {
    // join the lap: fly to a point on it a little ahead, then go round
    b.wh = { a: Math.atan2((b.pos.z - WHEEL.c.z) / WHEEL.rz, (b.pos.x - WHEEL.c.x) / WHEEL.rx) + rand(0.2, 0.5),
      dr: rand(-0.5, 0.5), dy: rand(-0.4, 0.4), ph: rand(0, 6), laps: rand(0.9, 1.5), done: 0 };
    const p = wheelPoint(b, b.wh.a + 0.4, new THREE.Vector3());
    flyTo(b, p, new THREE.Vector3(0, -1, 0), { wheel: true });
  }
  function wheelPoint(b, a, out) {
    const w = b.wh;
    return out.set(WHEEL.c.x + (WHEEL.rx + w.dr) * Math.cos(a), WHEEL.c.y + w.dy + 0.35 * Math.sin(a * 2 + w.ph), WHEEL.c.z + (WHEEL.rz + w.dr) * Math.sin(a));
  }
  function leaveWheel(b, rain, night) {
    const calm = rain < 0.12 && night < 0.55 && startle <= 0;
    if (calm && Math.random() < 0.55 && birds.filter((o) => o.state === 'ground' || o.fl?.then?.point).length < 14) return goGround(b);
    const s = freeSlot(b, rain > 0.12, null);
    if (s) goSlot(b, s); else goGround(b);
  }

  // ---------------------------------------------------------------- the flock's mind
  function scare(all) {
    startle = 6;
    for (const b of birds) {
      if (b.state === 'ground' || (all && b.state === 'perch' && Math.random() < 0.5)) {
        b.state = 'wait'; b.wait = rand(0, 0.25); b.after = 'wheel'; // they go up almost together
      }
    }
  }

  function think(b, dt, rain, night) {
    const raining = rain > 0.12;
    switch (b.state) {
      case 'wait':
        b.wait -= dt;
        if (b.wait <= 0) { if (b.after === 'wheel') goWheel(b); }
        break;
      case 'perch':
        b.wait -= dt;
        if (raining && !b.slot.covered) { const s = freeSlot(b, true, b.pos); if (s) goSlot(b, s); break; }
        if (b.wait <= 0) {
          b.wait = rand(10, 35);
          const calm = !raining && night < 0.55 && startle <= 0;
          const onGround = birds.filter((o) => o.state === 'ground').length;
          if (calm && onGround < 12 && Math.random() < 0.45) goGround(b);
          else if (Math.random() < 0.25) { const s = freeSlot(b, raining, b.pos); if (s && s.p.distanceTo(b.pos) > 0.1) goSlot(b, s); }
        }
        break;
      case 'ground': {
        if (raining || night > 0.55) { const s = freeSlot(b, raining, null); if (s) goSlot(b, s); break; }
        // wander about the grain, pecking
        b.wait -= dt;
        if (!b.goal && b.wait <= 0) { b.goal = danaPoint(); b.goal.lerp(b.pos, 0.6); }
        if (b.goal) {
          tmp.subVectors(b.goal, b.pos); tmp.y = 0;
          const d = tmp.length();
          if (d < 0.01) { b.goal = null; b.wait = rand(0.6, 2.5); b.speed = 0; }
          else {
            b.speed = Math.min(b.hurry ? 0.4 : 0.11, d * 3);
            b.yaw += THREE.MathUtils.clamp(wrap(Math.atan2(-tmp.z, tmp.x) - b.yaw), -8 * dt, 8 * dt);
            b.pos.addScaledVector(tmp.normalize(), b.speed * dt);
          }
        } else b.speed = 0;
        b.hurry = false;
        break;
      }
      case 'fly': {
        const f = b.fl;
        f.t += dt / f.T;
        if (f.then.wheel && f.t >= 1) { b.state = 'wheel'; break; }
        if (f.t >= 1) { if (f.reserve) f.reserve.bird = null; land(b, f.then); break; }
        break;
      }
      case 'wheel': {
        const w = b.wh;
        const da = (3.2 / ((WHEEL.rx + WHEEL.rz) / 2)) * dt;
        w.a += da; w.done += da / (2 * Math.PI);
        if (w.done > w.laps) leaveWheel(b, rain, night);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- posing
  function pose(b, i, dt, t, rain, night) {
    let flap = 0, wingsOut = false, pitch = 0, bank = 0, hx = 0, hp = 0, hy = 0;
    const fluff = 1 + 0.1 * Math.max(rain > 0.12 ? 1 : 0, night > 0.6 ? 1 : 0);
    if (b.state === 'fly' || b.state === 'wheel') {
      wingsOut = true;
      const prev = b.pos.clone();
      let k = 0;
      if (b.state === 'fly') { k = Math.min(1, b.fl.t); bez(b.fl, k, b.pos); }
      else wheelPoint(b, b.wh.a, b.pos);
      const v = tmp.subVectors(b.pos, prev);
      const hz = Math.hypot(v.x, v.z);
      if (hz > 1e-5) {
        const yaw = Math.atan2(-v.z, v.x);
        const turn = wrap(yaw - b.yaw) / Math.max(dt, 1e-3);
        b.yaw = yaw;
        bank = THREE.MathUtils.clamp(-turn * 0.18, -0.7, 0.7);
        pitch = THREE.MathUtils.clamp(Math.atan2(v.y, hz) * 0.8, -0.6, 0.7);
      }
      // flapping: hard on take-off and to brake for landing, a glide with the wings in a V coming down
      const landing = b.state === 'fly' && !b.fl.then.wheel && k > 0.8;
      const gliding = v.y < -0.004 && !landing && (b.state === 'wheel' ? Math.sin(t * 0.7 + i) > 0.3 : k > 0.4);
      b.wing += dt * 2 * Math.PI * (landing || k < 0.25 ? 8.5 : 6.5);
      flap = gliding ? 0.38 : 0.15 + 0.95 * Math.sin(b.wing);
      if (landing) pitch = 0.65 * (k - 0.8) / 0.2 + pitch * (1 - (k - 0.8) / 0.2);
      hp = -pitch * 0.6;
    } else {
      // perched or on the ground: head turns, bobs, pecks; a preen now and then
      const walking = b.state === 'ground' && b.speed > 0.02;
      if (walking) {
        b.step = (b.step + dt * (b.speed > 0.2 ? 6 : 3.4)) % 1;
        hx = 0.009 * (b.step < 0.3 ? b.step / 0.3 : 1 - (b.step - 0.3) / 0.7) - 0.004; // thrust, then hold
      }
      b.peckT -= dt;
      if (b.state === 'ground' && !walking && b.peckT <= 0) { b.peckT = rand(0.35, 1.2); b.peckK = 0; }
      b.peckK = Math.min(1, b.peckK + dt / 0.28);
      const peck = b.state === 'ground' && !walking ? Math.sin(Math.PI * b.peckK) : 0;
      b.lookT -= dt;
      if (b.lookT <= 0) { b.lookT = rand(0.6, 3); b.lookTo = rand(-1.2, 1.2); if (b.state === 'perch' && Math.random() < 0.08) b.preen = 1.6; }
      b.look += (b.lookTo - b.look) * Math.min(1, dt * 10); // pigeons look in quick little snaps
      b.preen = Math.max(0, (b.preen || 0) - dt);
      hy = b.preen > 0 ? 2.4 * Math.sin(Math.PI * Math.min(1, b.preen / 1.6)) : b.look;
      hp = -1.15 * peck - (b.preen > 0 ? 0.6 * Math.sin(Math.PI * Math.min(1, b.preen / 1.6)) : 0) - (fluff > 1 ? 0.25 : 0);
      pitch = b.state === 'ground' ? -0.08 - 0.25 * peck : 0.05;
    }
    root.position.copy(b.pos);
    root.rotation.set(bank, b.yaw, pitch, 'YZX');
    root.scale.setScalar(b.size * (wingsOut ? 1 : fluff));
    head.position.set(pivot.head.x + hx, pivot.head.y - (fluff > 1 && !wingsOut ? 0.006 : 0), pivot.head.z);
    head.rotation.set(0, hy, hp, 'YZX');
    wingL.rotation.set(flap, 0, 0);
    wingR.rotation.set(-flap, 0, 0);
    root.updateMatrixWorld(true);
    mesh.body.setMatrixAt(i, root.matrixWorld);
    mesh.fold.setMatrixAt(i, wingsOut ? zero : root.matrixWorld);
    mesh.head.setMatrixAt(i, head.matrixWorld);
    mesh.wing_l.setMatrixAt(i, wingsOut ? wingL.matrixWorld : zero);
    mesh.wing_r.setMatrixAt(i, wingsOut ? wingR.matrixWorld : zero);
  }

  let started = false;
  function start() {
    // a dozen on the grain, the rest along the ledges
    for (let i = 0; i < COUNT; i++) {
      const b = { pos: new THREE.Vector3(), yaw: rand(-3, 3), state: 'ground', wait: rand(0, 3), goal: null, speed: 0, step: 0,
        peckT: rand(0, 1), peckK: 1, look: 0, lookTo: 0, lookT: rand(0, 2), wing: rand(0, 6), slot: null, size: rand(0.93, 1.07), hurry: false };
      birds.push(b);
      const s = i >= 12 && freeSlot(b, false, null);
      if (s) land(b, { slot: s }); else land(b, { point: danaPoint() });
    }
    started = true;
  }

  return {
    group, ready, setPerches, setShelter,
    get birds() { return birds; }, get slots() { return slots; },
    /** threats: things that move about near the grain ({ pos, speed?, run? }); flash: lightning this frame */
    update(dt, t, rain, night, threats, flash) {
      if (!mesh.body || !slots.length) return;
      if (!started) start();
      startle -= dt;
      // the grain's visitors: a dog trotting in or someone running and they all go; someone walking
      // through and they just shuffle out of the way
      let burst = flash;
      for (const o of threats) {
        if (!o.pos) continue;
        const dd = Math.hypot(o.pos.x - DANA.x, o.pos.z - DANA.z);
        if (dd > DANA_R + 0.6) continue;
        const fast = o.run || (o.J?.leg_fl && (o.speed || 0) > 0.15);
        if (fast && dd < DANA_R + 0.45) burst = true;
        for (const b of birds) {
          if (b.state !== 'ground') continue;
          const d = Math.hypot(b.pos.x - o.pos.x, b.pos.z - o.pos.z);
          if (d < 0.2) { b.goal = tmp2.set(b.pos.x + (b.pos.x - o.pos.x) / (d + 1e-3) * 0.25, DANA.y, b.pos.z + (b.pos.z - o.pos.z) / (d + 1e-3) * 0.25).clone(); b.hurry = true; }
        }
      }
      nextLap -= dt;
      if (nextLap <= 0) { nextLap = rand(50, 110); if (rain < 0.12 && night < 0.55) burst = true; }
      if (burst && startle <= 0 && birds.some((b) => b.state === 'ground')) scare(flash);
      // keep the walkers apart a little
      for (const a of birds) for (const b of birds) {
        if (a === b || a.state !== 'ground' || b.state !== 'ground') continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.07 && d > 1e-4) { a.pos.x += dx / d * (0.07 - d) * 0.5; a.pos.z += dz / d * (0.07 - d) * 0.5; }
      }
      birds.forEach((b, i) => { think(b, dt, rain, night); pose(b, i, dt, t, rain, night); });
      for (const p of PARTS) mesh[p].instanceMatrix.needsUpdate = true;
    },
  };
}
