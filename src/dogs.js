// Street dogs (blender/dogs.blend): three that roam, one asleep under the chai-stall bench.
//
// A roaming dog wanders between spots on the footpath, the road edge and the lane: it walks (a
// four-beat walk: back left, front left, back right, front right) or trots (diagonal pairs together),
// stops to sniff with its head down and its tail going, sits a while, or lies down in the sun.
// When the rain comes it trots off to cover (under the parked auto, the vegetable cart, a corner of an
// awning) and lies down there; once it stops, it gets up, steps out and shakes itself dry: the body
// wrings from side to side a few times a second, the wobble dying away, droplets flung off.
// The sleeper doesn't wake for any of it, just breathes.
import * as THREE from 'three';
import { gltfLoader } from './loader.js';

const P = (x, y) => ({ x, z: -y });                 // Blender plan -> three plan
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dz, dx);

// They travel the way street dogs do, along the road's edge by the kerb (clear of the parked auto
// and the cart), and only step up onto the footpath, or into the side lane's mouth, where the way
// straight in from the kerb is clear. Where they like to go, and where they wait out the rain:
// at either end of the closed shutter under the balconies (one in through the gap between the watchman's
// chair and the milkman's bicycle, one from the lane side past the streetlight), lying out towards the street, under the kirana's awning by the sacks, and, if those
// are taken, under the parked auto. These are kept clear of the
// spots where people huddle, and of the auto's footprint, so a dog never ends up standing inside someone.
const EDGE_Z = 1.42;
const ROAM = [P(-6.9, -1.42), P(-5.2, -1.45), P(-3.4, -1.5), P(-0.9, -1.45), P(2.2, -1.45), P(6.3, -1.42), // the road edge
  P(-7.0, -0.85), P(-2.2, -0.95), P(0.4, -0.75), P(6.9, -0.95), P(4.1, -0.8)];                              // footpath, the lane mouth
const COVER = [
  { at: P(2.27, -0.28), via: [P(2.27, -0.75)], face: -1.2, cost: 0 },       // between the watchman and the bicycle          // the shutter, facing along it
  { at: P(3.3, -0.3), via: [P(3.5, -0.55)], face: -1.9, cost: 0 },          // past the bicycle, by the pillar  // the shutter, nose to nose with the first
  { at: P(-7.05, -0.42), via: [], face: -0.3, cost: 0 },                      // the kirana's awning
  { at: P(-1.3, -1.9), via: [], face: 0.2, cost: 2.5 },                         // under the auto, head poking out
];
function route(from, to, via = []) {
  const pts = [];
  const first = via.length ? via[0] : to;
  if (Math.abs(from.z - EDGE_Z) > 0.05) pts.push({ x: from.x, z: EDGE_Z });
  pts.push({ x: first.x, z: EDGE_Z });
  pts.push(...via.map((v) => ({ ...v })));
  if (Math.abs(to.z - EDGE_Z) > 0.05 || via.length) pts.push({ ...to });
  return pts;
}
const SLEEPER = { at: P(-2.78, -0.4), yaw: 0 };              // under the bench by the chai stall

function groundAt(x, z) {
  if (x > 3.62 && x < 5.58) return 0.012;          // the side lane
  if (z > 1.27) return 0.012;                      // the road
  if (z > 1.15) return 0.165;                      // the kerb
  return 0.15;                                     // the footpath
}

export function makeDogs(parent, impacts) {
  const group = new THREE.Group();
  group.name = 'dogs';
  parent.add(group);
  const dogs = [];
  let sleeper = null, covered = () => false;
  const tmp = new THREE.Vector3();

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/dogs.glb`).then((gltf) => {
    const roots = [];
    gltf.scene.traverse((o) => { if (/^dog_\d+$/.test(o.name)) roots.push(o); if (o.name === 'dog_sleep') sleeper = o; });
    for (const [i, fig] of roots.entries()) {
      const holder = new THREE.Group();
      fig.position.set(0, 0, 0);
      holder.add(fig);
      group.add(holder);
      const J = {};
      fig.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
        const m = !o.isMesh && o.name.match(/^(leg_fl|leg_fr|leg_bl|leg_br|low_fl|low_fr|low_bl|low_br|head|tail)\d*$/);
        if (m) J[m[1]] = o;
      });
      const at = ROAM[(i * 4) % ROAM.length];
      dogs.push({ fig, holder, J, pos: { ...at }, yaw: rand(-3, 3), speed: 0, phase: rand(0, 6), state: 'idle', wait: rand(1, 4),
        path: [], cover: null, wet: 0, shake: 0, sniff: 0, sit: 0, lie: 0, wag: rand(0, 6), seed: rand(0, 100), look: 0 });
    }
    if (sleeper) {
      const holder = new THREE.Group();
      sleeper.position.set(0, 0, 0);
      holder.add(sleeper);
      holder.position.set(SLEEPER.at.x, 0.15, SLEEPER.at.z);
      holder.rotation.y = SLEEPER.yaw;
      group.add(holder);
      sleeper.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    }
    return group;
  });

  // follow a route; true once at its end
  function follow(d, vmax, dt) {
    while (d.path.length > 1 && Math.hypot(d.path[0].x - d.pos.x, d.path[0].z - d.pos.z) < 0.04) d.path.shift();
    return d.path.length === 0 || (moveTo(d, d.path[0], vmax, dt) && d.path.length === 1);
  }

  function moveTo(d, target, vmax, dt) {
    const dx = target.x - d.pos.x, dz = target.z - d.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.03) { d.speed = Math.max(0, d.speed - 3 * dt); return true; }
    const want = Math.min(vmax, Math.sqrt(2 * 3 * dist));
    d.speed += THREE.MathUtils.clamp(want - d.speed, -5 * dt, 4 * dt);
    d.yaw += THREE.MathUtils.clamp(wrap(yawTo(dx, dz) - d.yaw), -6 * dt, 6 * dt);
    const s = Math.min(dist, d.speed * dt);
    d.pos.x += (dx / dist) * s; d.pos.z += (dz / dist) * s;
    return false;
  }

  function think(d, dt, rain) {
    const raining = rain > 0.15;
    if (raining && d.state !== 'toCover' && d.state !== 'sheltering' && !covered(d.pos)) {
      const free = COVER.filter((c) => !dogs.some((o) => o !== d && o.cover === c));
      if (free.length) {
        const far = (c) => Math.hypot(c.at.x - d.pos.x, c.at.z - d.pos.z) + c.cost;
        d.cover = free.reduce((a, b) => (far(b) < far(a) ? b : a));
        d.state = 'toCover';
        d.path = route(d.pos, d.cover.at, d.cover.via);
      }
    }
    switch (d.state) {
      case 'toCover':
        if (follow(d, 1.6, dt)) { d.state = 'sheltering'; d.wait = rand(4, 10); d.rest = 0; }
        break;
      case 'sheltering': // turn round to settle, lie down, chin on the paws; look up now and then at the rain
        d.yaw += THREE.MathUtils.clamp(wrap(d.cover.face - d.yaw), -3 * dt, 3 * dt);
        d.rest += dt;
        if (rain < 0.05) {
          d.wait -= dt;
          if (d.wait <= 0) {
            d.state = 'out';
            const back = [...d.cover.via].reverse();
            d.path = d.pos.z > EDGE_Z ? [{ x: d.pos.x + rand(-0.15, 0.15), z: d.pos.z - 0.45 }]
              : [...back, { x: (back[back.length - 1] || d.pos).x + rand(-0.1, 0.1), z: EDGE_Z }];
          }
        }
        break;
      case 'out': // step out from under, then shake off the water
        if (follow(d, 0.45, dt)) { d.cover = null; if (d.wet > 0.15) { d.state = 'shake'; d.shake = 0; } else d.state = 'idle'; }
        break;
      case 'shake':
        d.shake += dt;
        if (d.shake > 1.3) { d.wet *= 0.25; d.state = 'idle'; d.wait = rand(1, 3); }
        break;
      case 'walk':
        if (follow(d, d.trot ? 1.0 : 0.42, dt)) {
          const r = Math.random();
          d.state = r < 0.4 ? 'sniff' : r < 0.6 ? 'sit' : r < 0.75 ? 'lie' : 'idle';
          d.wait = d.state === 'lie' ? rand(8, 20) : d.state === 'sit' ? rand(4, 10) : rand(1.5, 4);
        }
        break;
      default: // idle, sniff, sit, lie: then off somewhere else
        d.wait -= dt;
        if (d.state === 'sniff') { d.pos.x += Math.cos(d.yaw) * 0.04 * dt; d.pos.z -= Math.sin(d.yaw) * 0.04 * dt; }
        if (d.wait <= 0) {
          const next = ROAM.filter((p) => Math.hypot(p.x - d.pos.x, p.z - d.pos.z) > 0.8);
          d.path = route(d.pos, next[Math.floor(Math.random() * next.length)]);
          d.trot = Math.random() < 0.45;
          d.state = 'walk';
        }
    }
  }

  function animate(d, dt, t, rain) {
    const J = d.J;
    // legs: walk = four-beat (LH, LF, RH, RF a quarter-cycle apart); trot = diagonal pairs together
    const v = d.speed;
    const trot = THREE.MathUtils.clamp((v - 0.5) / 0.4, 0, 1);
    const a = THREE.MathUtils.clamp(v / 0.3, 0, 1);
    const cad = v < 0.02 ? 0 : 1.4 + 1.4 * trot + 0.6 * Math.min(1, v / 1.6); // strides per second
    d.phase += 2 * Math.PI * cad * dt;
    const off = { bl: 0, fl: Math.PI * (0.5 + 0.5 * trot), br: Math.PI, fr: Math.PI * (1.5 + 0.5 * trot) };
    for (const k of ['fl', 'fr', 'bl', 'br']) {
      const f = d.phase + off[k];
      const front = k[0] === 'f';
      const swing = Math.sin(f) * a * (0.38 + 0.12 * trot);
      const lift = Math.max(0, Math.cos(f)) * a * (0.5 + 0.3 * trot); // the leg folds as it swings forward
      let up = swing, low = front ? -lift : lift;
      // sitting: chest up on straight front legs, hind legs folded under the rump;
      // lying (a sphinx): front legs straight out in front, hind legs folded forward under the body
      up = THREE.MathUtils.lerp(up, front ? -0.55 : 1.6, d.sit);
      low = THREE.MathUtils.lerp(low, front ? 0 : -1.1, d.sit);
      up = THREE.MathUtils.lerp(up, front ? 1.45 : 1.35, d.lie);
      low = THREE.MathUtils.lerp(low, front ? 0 : 0.5, d.lie);
      if (J['leg_' + k]) J['leg_' + k].rotation.z = up;
      if (J['low_' + k]) J['low_' + k].rotation.z = low;
    }
    // posture blends
    const goal = (s) => (d.state === s || (s === 'lie' && d.state === 'sheltering') ? 1 : 0);
    d.sit += (goal('sit') - d.sit) * Math.min(1, dt * 3);
    d.lie += (goal('lie') - d.lie) * Math.min(1, dt * 2);
    d.sniff += ((d.state === 'sniff' ? 1 : 0) - d.sniff) * Math.min(1, dt * 3);
    d.fig.rotation.z = 0.55 * d.sit;                          // sitting: the chest up, the rump down
    // (tilting about the middle lifts the front; drop it back so the front paws stay planted)
    d.fig.position.y = -0.075 * d.sit - 0.1 * d.lie + a * 0.008 * Math.abs(Math.sin(d.phase * 2));
    // the shake: the body wrings side to side ~5 times a second, dying away; droplets fly off
    let roll = 0;
    if (d.state === 'shake') {
      const s = d.shake;
      roll = 0.55 * Math.sin(s * 2 * Math.PI * 5) * Math.exp(-s * 1.6) * Math.min(1, s * 6);
      if (Math.random() < d.wet * 0.9) {
        d.fig.localToWorld(tmp.set(rand(-0.1, 0.1), 0.17, 0));
        const sp = Math.abs(roll) * 4;
        impacts.droplet(tmp.x, tmp.y, tmp.z, rand(-sp, sp), rand(0.2, 0.6), rand(-sp, sp));
      }
    }
    d.fig.rotation.x = roll;
    // head: sniffing the ground, looking about, nodding along when trotting; sheltering, the chin goes down
    // on the paws once settled, lifting now and then to look out at the rain
    const glance = d.state === 'sheltering' && Math.sin(t * 0.23 + d.seed) > 0.75;
    const chin = d.state === 'sheltering' && d.rest > 2.5 && !glance ? 1 : 0;
    d.chin = (d.chin || 0) + (chin - (d.chin || 0)) * Math.min(1, dt * 1.5);
    d.look += ((d.state === 'idle' || d.state === 'sit' ? 0.7 * Math.sin(t * 0.4 + d.seed) : glance ? 0.6 * Math.sin(d.seed) : 0) - d.look) * Math.min(1, dt * 2);
    if (J.head) J.head.rotation.set(-roll * 0.8, d.look, -1.1 * d.sniff + 0.05 * a * Math.sin(d.phase * 2) - 0.2 * d.lie - 0.35 * d.sit - 0.45 * d.chin);
    // tail: wags when sniffing or idle, held up when trotting, tucked low when wet and sheltering
    d.wag += dt * (d.state === 'sniff' || d.state === 'idle' ? 9 : 3);
    if (J.tail) J.tail.rotation.set(0, (d.state === 'sniff' || d.state === 'idle' ? 0.5 : 0.15) * Math.sin(d.wag), d.state === 'sheltering' || d.wet > 0.5 ? 0.6 : 0);
    d.holder.position.set(d.pos.x, groundAt(d.pos.x, d.pos.z), d.pos.z);
    d.holder.rotation.y = d.yaw;
  }

  return {
    group, ready,
    setShelter(fn) { covered = (p) => fn(p.x, p.z) > groundAt(p.x, p.z) + 0.3; },
    get dogs() { return dogs; },
    update(dt, t, rain, others = []) {
      for (const d of dogs) {
        const out = rain > 0.05 && !covered(d.pos);
        d.wet = THREE.MathUtils.clamp(d.wet + (out ? rain * 0.1 : -0.003) * dt, 0, 1);
        think(d, dt, rain);
        // step round people (and each other) rather than through them
        for (const o of d.state === 'sheltering' ? [] : others.concat(dogs)) {
          if (o === d || !o.pos) continue;
          const dx = d.pos.x - o.pos.x, dz = d.pos.z - o.pos.z, r = Math.hypot(dx, dz), min = 0.22;
          if (r < min && r > 1e-4) { const k = Math.min(1, (min - r) / r) * Math.min(1, dt * 8); d.pos.x += dx * k; d.pos.z += dz * k; }
        }
        animate(d, dt, t, rain);
      }
      if (sleeper) sleeper.scale.y = 1 + 0.025 * Math.sin(t * 1.7); // slow breathing
    },
  };
}
