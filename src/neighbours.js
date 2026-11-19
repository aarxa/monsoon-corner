// The neighbours (blender/neighbours.blend), placed where they live in the street's own coordinates.
//
// Uncle sits on his first-floor balcony in his banian and lungi with a glass of cutting chai. Every so
// often he brings it up to his lips (the elbow comes in front of his chest, the forearm folds up, his head
// tips back a touch), holds it there for a sip, and lowers it again, sometimes to rest at his chest a
// while. He watches the street: the motorbike as it goes by, the kids' ball, or nothing in particular;
// and in a downpour he looks up at the sky. He's under the balcony above, so the rain doesn't move him.
//
// The aunty upstairs has her washing out on the roof. When the rain comes, a moment later the door of
// the stair room bangs open and she hurries out, pulls each piece off the line into her arms, and hurries
// back in. Once it's been dry a while she brings it all out again in her bucket and pegs it back up, one
// piece at a time, arms up to the line. At dusk she takes it in anyway, unhurried, and in the morning it
// goes out again.
//
// Pivots (three.js, as for the walkers): arm_*.rotation.z > 0 swings the arm forward and up, elbow_*.z > 0
// bends it; arm_r.rotation.x < 0 brings the right arm in across the body (x > 0 for the left); arm.y
// turns the raised arm inward; head.rotation.z > 0 tips the head up, .y turns it to the left.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';
import { gait, joints } from './gait.js';
import { makeSway } from './physics.js';

const P = (x, y, z = 0) => new THREE.Vector3(x, z, -y);   // Blender -> three
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// found by searching joint angles in Blender until the glass reached his lips / her hands the line
const SIP = { arm: [-0.3, 1.05, 0.95], elbow: 1.35 };
const HOLD = { arm: [-0.15, 0.55, 0.5], elbow: 1.05 };         // the glass held at his chest
const REACH = { r: [0.09, 0, 2.04], l: [-0.09, 0, 2.04], elbow: 0.6 };
const HUG = { r: [-0.35, 0, 0.55], l: [0.35, 0, 0.55], elbow: 1.55 }; // an armful of washing against her

const RZ = 4 * 1.3 + 0.03;                       // the roof
const LINE_Y = 2.1, STAND_Y = LINE_Y - 0.12;     // the line, and where she stands to reach it (Blender y)
const WASH_X = [0.8, 0.42, -0.02, -0.48, -0.85, -1.25, -1.55];
const DOOR_OUT = P(2.15, 2.95, RZ), DOOR_IN = P(2.15, 3.2, RZ), BUCKET_AT = P(1.25, 1.85, RZ);
const CORNER = P(1.42, 1.92, RZ);                // round the end of the line, clear of its post
const BY_BUCKET = P(1.38, 1.74, RZ);
const FACE_LINE = Math.PI / 2;                   // facing +Blender y: the line, her back to the street

export function makeNeighbours(parent) {
  const group = new THREE.Group();
  group.name = 'neighbours';
  parent.add(group);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  let U = null, A = null, door = null, sway = null;
  const wash = [];

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/neighbours.glb`).then((gltf) => {
    group.add(gltf.scene);
    const find = (n) => gltf.scene.getObjectByName(n);
    gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const ufig = find('uncle');
    U = { fig: ufig, J: joints(ufig), t: rand(2, 6), phase: 'rest', k: 0, from: null, look: 0, lookUp: 0 };
    const afig = find('aunty'), bundle = find('aunty_bundle');
    const holder = new THREE.Group();          // she walks about the roof in a holder; the figure sits at its origin
    group.add(holder);
    afig.position.set(0, 0, 0); afig.rotation.set(0, 0, 0);
    holder.add(afig);
    A = { holder, fig: afig, J: joints(afig), g: { phase: 0 }, bundle, bucket: find('aunty_bucket'),
      heap: find('aunty_bucket_heap'), pos: DOOR_IN.clone(), yaw: -Math.PI / 2, speed: 0, state: 'in', wait: rand(1, 2),
      path: [], task: null, i: 0, k: 0, full: 0, carrying: false, arms: 0, dry: 99 };
    A.bucketHome = A.bucket.position.clone();
    A.mats = [];  // her clothes and hair darken when she's caught in the rain
    afig.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); A.mats.push({ m: o.material, c: o.material.color.clone() }); } });
    A.wet = 0;
    A.bucket.visible = false;
    A.bundle.scale.setScalar(0.001);
    holder.visible = false;
    door = find('roof_door');
    for (let i = 0; i < WASH_X.length; i++) {
      const o = find(`wash_${i}`);
      wash.push({ obj: o, on: true });
    }
    sway = makeSway(wash.map((w, i) => ({ obj: w.obj, axis: 'x', base: w.obj.rotation.x, phase: i * 1.7, amt: 0.22 })));
    return group;
  });

  // ---------------------------------------------------------------- uncle
  function setArm(J, side, a, elbow) {
    if (J['arm_' + side]) J['arm_' + side].rotation.set(a[0], a[1], a[2]);
    if (J['elbow_' + side]) J['elbow_' + side].rotation.z = elbow;
  }
  const lerp3 = (a, b, k) => [0, 1, 2].map((i) => THREE.MathUtils.lerp(a[i], b[i], k));
  const REST = { arm: [0, 0, 0], elbow: 0 };

  function uncle(dt, t, rain, focus) {
    // sip cycle: rest -> raise -> sip -> (hold at the chest a while | rest)
    U.t -= dt;
    const pose = { rest: REST, hold: HOLD, sip: SIP };
    if (U.t <= 0 && U.k >= 1) {
      U.from = U.phase;
      U.phase = U.phase === 'sip' ? (Math.random() < 0.4 ? 'hold' : 'rest') : U.phase === 'hold' ? (Math.random() < 0.6 ? 'sip' : 'rest') : 'sip';
      U.t = U.phase === 'sip' ? rand(2.3, 3.3) : U.phase === 'hold' ? rand(3, 6) : rand(5, 11); // a sip lasts a breath or two once the glass is up
      U.k = 0;
    }
    U.k = Math.min(1, U.k + dt / (U.phase === 'sip' ? 0.9 : 1.1));
    const a = pose[U.from || 'rest'], b = pose[U.phase], k = ease(U.k);
    setArm(U.J, 'r', lerp3(a.arm, b.arm, k), THREE.MathUtils.lerp(a.elbow, b.elbow, k));
    // his head: follows whatever's going on, tips back for the sip, looks up at a downpour now and then
    let want = 0.35 * Math.sin(t * 0.13) + 0.25 * Math.sin(t * 0.31 + 1);
    if (focus) {
      U.fig.worldToLocal(tmp.copy(focus));
      want = THREE.MathUtils.clamp(Math.atan2(-tmp.z, tmp.x), -1.1, 1.1);
    }
    U.look += (want - U.look) * Math.min(1, dt * 2.5);
    const skyward = rain > 0.4 && Math.sin(t * 0.21) > 0.6 ? 0.35 : 0;
    U.lookUp += ((U.phase === 'sip' ? 0.18 * k : 0) + skyward - U.lookUp) * Math.min(1, dt * 3);
    if (U.J.head) U.J.head.rotation.set(0, U.look * (1 - 0.6 * (U.phase === 'sip' ? k : 0)), U.lookUp - 0.05);
  }

  // ---------------------------------------------------------------- aunty
  const anyOn = () => wash.some((w) => w.on);
  const spot = (i) => P(WASH_X[i], STAND_Y, RZ);

  function walk(dt, vmax) {
    // along her path; true once at the end of it
    while (A.path.length > 1 && A.pos.distanceTo(A.path[0]) < 0.03) A.path.shift();
    const target = A.path[0];
    if (!target) { A.speed = Math.max(0, A.speed - 3 * dt); return true; }
    tmp.subVectors(target, A.pos); tmp.y = 0;
    const d = tmp.length();
    if (d < 0.02 && A.path.length === 1) { A.path = []; A.speed = Math.max(0, A.speed - 3 * dt); return true; }
    const want = Math.min(vmax, Math.sqrt(2 * 2.5 * d));
    A.speed += THREE.MathUtils.clamp(want - A.speed, -4 * dt, 3 * dt);
    A.yaw += THREE.MathUtils.clamp(wrap(Math.atan2(-tmp.z, tmp.x) - A.yaw), -7 * dt, 7 * dt);
    A.pos.addScaledVector(tmp.normalize(), Math.min(d, A.speed * dt));
    return false;
  }
  const turnTo = (yaw, dt) => { A.yaw += THREE.MathUtils.clamp(wrap(yaw - A.yaw), -6 * dt, 6 * dt); return Math.abs(wrap(yaw - A.yaw)) < 0.1; };

  function aunty(dt, t, rain, night) {
    const raining = rain > 0.12;
    A.dry = rain < 0.04 ? A.dry + dt : 0;
    const vmax = A.hurry ? 0.95 : 0.42;
    switch (A.state) {
      case 'in': { // indoors: what needs doing?
        A.holder.visible = false;
        A.wait -= dt;
        if (A.wait > 0) break;
        if (anyOn() && (raining || night > 0.55)) {
          A.task = 'collect'; A.hurry = raining; A.order = WASH_X.map((_, i) => i).filter((i) => wash[i].on);
        } else if (!anyOn() && A.dry > 12 && night < 0.45 && rain < 0.04) {
          A.task = 'hang'; A.hurry = false; A.order = WASH_X.map((_, i) => i);
        } else { A.wait = 0.5; break; }
        A.state = 'out'; A.pos.copy(DOOR_IN); A.yaw = -Math.PI / 2; A.path = [DOOR_OUT.clone(), CORNER.clone()];
        A.holder.visible = true;
        A.bucket.visible = A.task === 'hang';
        if (A.task === 'hang') { A.heap.visible = true; A.path.push(BY_BUCKET.clone()); }
        else A.path.push(spot(A.order[0]));
        A.i = 0;
        break;
      }
      case 'out': // through the door and over to the line (with the bucket, to hang)
        if (walk(dt, vmax)) {
          if (A.task === 'hang') { A.state = 'gather'; A.k = 0; } else { A.state = 'reach'; A.k = 0; }
        }
        break;
      case 'gather': // set the bucket down, lift the washing out into her arms
        A.k += dt / 1.2;
        turnTo(FACE_LINE, dt);
        if (A.k > 0.4 && A.heap.visible) { A.heap.visible = false; A.full = 1; }
        if (A.k >= 1) { A.state = 'next'; }
        break;
      case 'next': // to the next piece
        if (A.i >= A.order.length) { A.state = 'home'; A.path = A.task === 'hang' ? [BY_BUCKET.clone()] : []; A.path.push(CORNER.clone(), DOOR_OUT.clone(), DOOR_IN.clone()); break; }
        A.path = [spot(A.order[A.i])];
        A.state = 'toPiece';
        break;
      case 'toPiece':
        if (walk(dt, vmax)) { A.state = 'reach'; A.k = 0; }
        break;
      case 'reach': { // arms up to the line: peg it up, or pull it off
        const dur = A.hurry ? 0.55 : 1.4;
        const done = turnTo(FACE_LINE, dt);
        if (!done && A.k === 0) break;
        A.k += dt / dur;
        const w = wash[A.order[A.i]];
        if (A.k > 0.6 && (A.task === 'hang') !== w.on) {
          w.on = A.task === 'hang';
          w.obj.visible = w.on;
          if (w.on) w.obj.rotation.x += 0.5; // a shake as it goes up
          const n = A.order.length;
          A.full = A.task === 'hang' ? 1 - (A.i + 1) / n : (A.i + 1) / n;
        }
        if (A.k >= 1) { A.i++; A.state = 'next'; }
        break;
      }
      case 'home': // back in, the door shut behind her (picking the bucket up on the way, after hanging)
        if (A.task === 'hang' && A.pos.distanceTo(BY_BUCKET) < 0.08) A.carrying = true;
        if (walk(dt, vmax)) { A.state = 'in'; A.wait = rand(2, 4); A.carrying = false; A.bucket.visible = false; A.task = null; A.full = 0; }
        break;
    }

    // her arms: up to the line while reaching, round the washing while she has an armful, swinging otherwise
    const { swing, a } = gait(A.g, A.J, A.fig, A.speed, dt, 0.95);
    const reachK = A.state === 'reach' ? Math.sin(Math.PI * Math.min(1, A.k)) : 0;
    const hugK = THREE.MathUtils.clamp(A.full * 3, 0, 1) * (1 - reachK);
    A.arms += (hugK - A.arms) * Math.min(1, dt * 6);
    const sw = swing * (1 - A.arms) * (1 - reachK);
    for (const s of ['r', 'l']) {
      const free = [0, 0, s === 'r' ? sw : -sw];
      let arm = lerp3(free, HUG[s], A.arms), el = THREE.MathUtils.lerp(0.15 + 0.2 * a, HUG.elbow, A.arms);
      arm = lerp3(arm, REACH[s], reachK); el = THREE.MathUtils.lerp(el, REACH.elbow, reachK);
      if (s === 'r' && (A.carrying || (A.task === 'hang' && A.state === 'out'))) { arm = [0.05, 0, 0]; el = 0.05; }
      setArm(A.J, s, arm, el);
    }
    if (A.J.head) A.J.head.rotation.set(0, 0, reachK * 0.35 + (A.hurry && A.state !== 'reach' ? -0.12 : 0));
    A.fig.rotation.z -= (A.state === 'gather' ? 0.45 * Math.sin(Math.PI * Math.min(1, A.k)) : 0);
    A.bundle.scale.setScalar(Math.max(0.001, Math.min(1, A.full * 1.4)));
    A.holder.position.copy(A.pos);
    A.holder.rotation.y = A.yaw;
    // the bucket: in her right hand while she carries it, set down by the line while she works
    if (A.bucket.visible) {
      if (A.carrying || (A.task === 'hang' && A.state === 'out')) {
        A.J.elbow_r.updateWorldMatrix(true, false);
        A.J.elbow_r.localToWorld(tmp.set(...(A.J.elbow_r.userData.hand || [0, 0, -0.1])).set(tmp.x, tmp.z, -tmp.y));
        A.bucket.parent.worldToLocal(tmp);
        A.bucket.position.set(tmp.x, tmp.y - 0.125, tmp.z);
      } else {
        A.bucket.position.copy(A.bucketHome);
      }
    }
    // soaked running about in the rain, drying slowly indoors
    A.wet = THREE.MathUtils.clamp(A.wet + (A.holder.visible && rain > 0.05 ? rain * 0.12 : -0.004) * dt, 0, 1);
    if (Math.abs(A.wet - (A.wetShown ?? -1)) > 0.01) {
      A.wetShown = A.wet;
      const e = 1 + 0.7 * A.wet, kk = 1 - 0.1 * A.wet;
      for (const { m, c } of A.mats) m.color.setRGB(c.r ** e * kk, c.g ** e * kk, c.b ** e * kk);
    }
    // the door swings open as she comes through, and shuts behind her
    const near = A.holder.visible && A.pos.distanceTo(DOOR_OUT) < 0.4;
    door.userData.open = THREE.MathUtils.clamp((door.userData.open || 0) + (near ? 4 : -2.5) * dt, 0, 1);
    door.rotation.y = -1.75 * ease(door.userData.open);
  }

  return {
    group, ready,
    get uncle() { return U; }, get aunty() { return A; },
    /** focus: a world point uncle watches (or null) */
    update(dt, t, rain, night, windSpeed, focus) {
      if (!U) return;
      uncle(dt, t, rain, focus);
      aunty(dt, t, rain, night);
      sway?.(dt, t, windSpeed);
    },
  };
}
