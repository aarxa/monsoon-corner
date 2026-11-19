// Gully cricket in the side lane: a bowler, a batsman at a brick-and-stick wicket, and a fielder.
//
// The ball is a tennis ball (6.5 cm, as gully cricket uses) under real physics at the scene's scale
// (1 unit ≈ 2.3 m, g = 4.2 units/s²): quadratic air drag, bounces that lose speed (less bounce when
// it's wet, a splash in the puddles), rolling friction, the lane's walls, the hump of the speed breaker.
//
// One ball, round and round:
//   reset    the bowler walks back to his mark with the ball; the batsman takes guard
//   runup    a short run, the arm windmills over, the ball's let go to pitch just short of the bat
//   flight   the batsman times his swing to the ball: mostly he hits it back down the lane, sometimes
//            he misses (and sometimes the stumps go flying)
//   play     the fielder runs it down, picks it up and throws it back; a missed ball the batsman
//            fetches from behind the wicket himself
//   return   the throw comes in to the bowler
// They keep playing in the rain (Mumbai's kids do), and go home when it gets dark.
// Plan positions are three.js (x, z): the lane runs from the road (z ≈ 1.25) back into the block (-z).
import * as THREE from 'three';
import { gltfLoader } from './loader.js';
import { gait, joints } from './gait.js';

const G = 4.2;
const R = 0.0143 * 1.25;          // tennis ball radius (a touch larger so it reads on screen)
const DRAG = 0.046;               // quadratic drag per unit: terminal velocity ~22 m/s for a tennis ball
const WALL_L = 3.62, WALL_R = 5.58;
const STUMPS = { x: 5.0, z: -3.35 };
const SPOT = { bat: { x: 5.0, z: -3.12 }, mark: { x: 5.0, z: 0.25 }, release: { x: 5.0, z: -0.7 }, field: { x: 5.25, z: -1.9 }, out: { x: 4.6, z: 1.55 } };
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dz, dx);

// the lane is road level, with the speed breaker's hump across it at z ≈ -1.25
function ground(z) {
  const d = z + 1.25;
  return Math.abs(d) < 0.2 ? Math.max(0.012, Math.sqrt(0.09 - d * d) - 0.22) : 0.012;
}
function groundSlope(z) { return (ground(z + 0.005) - ground(z - 0.005)) / 0.01; }

export function makeCricket(parent) {
  const group = new THREE.Group();
  group.name = 'cricket';
  parent.add(group);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const ball = {
    mesh: new THREE.Mesh(new THREE.SphereGeometry(R, 14, 10), new THREE.MeshStandardMaterial({ color: '#d4ee3a', roughness: 0.85 })),
    p: new THREE.Vector3(5.0, 0.3, 0.2), v: new THREE.Vector3(), held: null, rolling: false,
  };
  ball.mesh.castShadow = true;
  group.add(ball.mesh);
  let kids = null, stumps = null, stumpsTilt = 0, stumpsKick = 0;
  const game = { state: 'reset', t: 0, swing: -1, decided: false, hit: false, wind: 0, released: false, throwT: -1, home: false };

  const ready = gltfLoader.loadAsync(`${import.meta.env.BASE_URL}models/kids.glb`).then((gltf) => {
    const find = (n) => { let f = null; gltf.scene.traverse((o) => { if (o.name === n) f = o; }); return f; };
    const make = (name, at, size) => {
      const fig = find(name);
      const holder = new THREE.Group();
      fig.position.set(0, 0, 0);
      holder.add(fig);
      group.add(holder);
      fig.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      const J = joints(fig);
      // where the right hand holds things, from the hand position stored on the elbow in the model (Blender axes)
      const h = J.elbow_r?.userData.hand || [0, 0, -0.1];
      return { name, fig, holder, J, size, hand: new THREE.Vector3(h[0], h[2], -h[1]), g: { phase: 0 },
        pos: { ...at }, yaw: yawTo(0, 1), speed: 0, look: 0 };
    };
    kids = { bowl: make('kid_bowl', SPOT.mark, 0.78), bat: make('kid_bat', SPOT.bat, 0.76), field: make('kid_field', SPOT.field, 0.72) };
    kids.bowl.yaw = yawTo(0, -1);
    stumps = find('stumps');
    stumps.position.set(STUMPS.x, 0.012, STUMPS.z);
    stumps.rotation.set(0, Math.PI / 2, 0);
    group.add(stumps);
    stumps.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    ball.held = kids.bowl;
    return group;
  });

  const handPos = (k, out) => (k.J.elbow_r ? k.J.elbow_r.localToWorld(out.copy(k.hand)) : k.fig.localToWorld(out.set(0.05, 0.4, 0.1)));

  // walk/run toward a point with human acceleration and braking; returns true on arrival
  function moveTo(k, target, vmax, dt, faceAfter = null) {
    const dx = target.x - k.pos.x, dz = target.z - k.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.02) {
      k.speed = Math.max(0, k.speed - 3 * dt);
      if (faceAfter != null) k.yaw += THREE.MathUtils.clamp(wrap(faceAfter - k.yaw), -4 * dt, 4 * dt);
      return true;
    }
    const want = Math.min(vmax, Math.sqrt(2 * 3.0 * d));
    k.speed += THREE.MathUtils.clamp(want - k.speed, -4 * dt, 3.2 * dt);
    k.yaw += THREE.MathUtils.clamp(wrap(yawTo(dx, dz) - k.yaw), -9 * dt, 9 * dt);
    const s = Math.min(d, k.speed * dt);
    k.pos.x += (dx / d) * s; k.pos.z += (dz / d) * s;
    return false;
  }

  function launch(from, to, flight) {
    // a ballistic throw from `from` that arrives at `to` after `flight` seconds (drag is small over this)
    ball.held = null; ball.rolling = false;
    ball.p.copy(from);
    ball.v.set((to.x - from.x) / flight, (to.y - from.y + 0.5 * G * flight * flight) / flight, (to.z - from.z) / flight);
  }

  function stepBall(dt, wet, impacts) {
    if (ball.held) { handPos(ball.held, ball.p); return; }
    const e = 0.72 - 0.22 * wet;               // a wet ball on a wet lane barely bounces
    const roll = 0.35 + 0.45 * wet;            // rolling friction, units/s²
    const sub = 3;
    for (let i = 0; i < sub; i++) {
      const h = dt / sub, sp = ball.v.length();
      if (!ball.rolling) {
        ball.v.y -= G * h;
        ball.v.addScaledVector(ball.v, -DRAG * sp * h);
      } else {
        const hs = Math.hypot(ball.v.x, ball.v.z);
        if (hs > 1e-3) { const k = Math.max(0, hs - roll * h) / hs; ball.v.x *= k; ball.v.z *= k; }
        ball.v.z -= groundSlope(ball.p.z) * G * 0.7 * h; // rolls back off the hump
        ball.v.y = 0;
      }
      ball.p.addScaledVector(ball.v, h);
      const gy = ground(ball.p.z) + R;
      if (ball.p.y < gy) {
        ball.p.y = gy;
        if (!ball.rolling) {
          // bounce off the ground's normal (tilted on the hump): restitution along it, friction across it
          const n = tmp2.set(0, 1, -groundSlope(ball.p.z)).normalize();
          const vn = ball.v.dot(n);
          if (vn < 0) {
            const tangential = tmp.copy(ball.v).addScaledVector(n, -vn).multiplyScalar(0.82);
            ball.v.copy(tangential).addScaledVector(n, -vn * e);
            if (-vn > 0.4 && wet > 0.2) impacts?.hit(ball.p.x, ball.p.y - R, ball.p.z, 0.9, 0.5);
          }
          if (Math.abs(ball.v.y) < 0.25) ball.rolling = true;
        }
      }
      // the lane's walls
      if (ball.p.x < WALL_L + R && ball.v.x < 0) { ball.p.x = WALL_L + R; ball.v.x *= -0.55; ball.v.z *= 0.9; }
      if (ball.p.x > WALL_R - R && ball.v.x > 0) { ball.p.x = WALL_R - R; ball.v.x *= -0.55; ball.v.z *= 0.9; }
      // the back of the lane and the road edge: it stops in the gutter
      if (ball.p.z < -5.2 && ball.v.z < 0) { ball.p.z = -5.2; ball.v.z *= -0.4; }
      if (ball.p.z > 1.45 && ball.v.z > 0) { ball.v.z *= -0.3; ball.v.x *= 0.5; }
      // the stumps
      if (stumps && stumpsTilt < 0.05 && Math.abs(ball.p.x - STUMPS.x) < 0.05 + R && Math.abs(ball.p.z - STUMPS.z) < 0.012 + R && ball.p.y < 0.27) {
        stumpsKick = Math.sign(-ball.v.z) * Math.min(1.2, Math.abs(ball.v.z) * 0.6) + 0.3;
        ball.v.z *= -0.25; ball.v.x += rand(-0.3, 0.3);
        game.bowled = true;
      }
    }
    ball.mesh.position.copy(ball.p);
    ball.mesh.rotation.x += ball.v.z * dt / R; ball.mesh.rotation.z -= ball.v.x * dt / R;
  }

  const ballSettled = () => !ball.held && ball.rolling && Math.hypot(ball.v.x, ball.v.z) < 0.25;

  function think(dt) {
    const { bowl, bat, field } = kids;
    game.t += dt;
    const faceBat = yawTo(0, -1), faceRoad = yawTo(0, 1);
    switch (game.state) {
      case 'reset': {
        const atMark = moveTo(bowl, SPOT.mark, 0.5, dt, faceBat);
        moveTo(bat, SPOT.bat, 0.5, dt, faceRoad);
        moveTo(field, SPOT.field, 0.5, dt, yawTo(-0.3, 1));
        if (atMark && ball.held === bowl && game.t > 1.2) { game.state = 'runup'; game.t = 0; game.wind = 0; game.released = false; }
        break;
      }
      case 'runup': {
        const toGo = Math.hypot(SPOT.release.x - bowl.pos.x, SPOT.release.z - bowl.pos.z);
        moveTo(bowl, SPOT.release, 1.1, dt, faceBat);
        if (toGo < 0.5 || game.wind > 0) game.wind += dt / 0.5; // the arm comes over in the last strides
        if (!game.released && game.wind > 0.62) {
          // let go just past the top: pitch it a little short of the batsman, at kids' pace (~7–8 m/s)
          handPos(bowl, tmp);
          const pitch = new THREE.Vector3(SPOT.bat.x + rand(-0.07, 0.07), R, SPOT.bat.z + rand(0.45, 0.75));
          launch(tmp, pitch, Math.hypot(pitch.x - tmp.x, pitch.z - tmp.z) / rand(3.0, 3.5));
          game.released = true; game.decided = false; game.hit = false; game.swing = -1; game.bowled = false; game.cheered = false;
        }
        if (game.wind >= 1) { game.state = 'flight'; game.t = 0; }
        break;
      }
      case 'flight': {
        moveTo(bowl, { x: SPOT.release.x, z: SPOT.release.z - 0.25 }, 0.6, dt, faceBat); // follow-through
        const contactZ = bat.pos.z + 0.17;
        const tta = ball.v.z < -0.1 ? (ball.p.z - contactZ) / -ball.v.z : 99;
        if (!game.decided && tta < 0.22) { game.decided = true; game.willHit = Math.random() < 0.68; game.swing = 0; }
        if (game.swing >= 0) game.swing += dt / 0.36;
        if (game.willHit && !game.hit && ball.p.z <= contactZ && ball.p.z > bat.pos.z - 0.05 && ball.p.y < 0.45 && Math.abs(ball.p.x - bat.pos.x - 0.04) < 0.28) {
          // off the bat and back down the lane
          const sp = rand(2.2, 4.0), lat = rand(-0.5, 0.5), el = rand(0.08, 0.55);
          ball.v.set(Math.sin(lat) * Math.cos(el) * sp, Math.sin(el) * sp, Math.cos(lat) * Math.cos(el) * sp);
          ball.rolling = false; game.hit = true;
          game.state = 'play'; game.t = 0;
        } else if (ball.p.z < bat.pos.z - 0.35 || (game.t > 3 && ballSettled())) {
          game.state = 'fetch'; game.t = 0; // missed: the batsman goes and gets it
        }
        break;
      }
      case 'play': {
        // the fielder runs to where the ball is heading and gathers it once it's low
        const lead = Math.min(0.6, game.t * 0.4);
        const aim = { x: THREE.MathUtils.clamp(ball.p.x + ball.v.x * lead, WALL_L + 0.1, WALL_R - 0.1), z: Math.min(1.42, ball.p.z + ball.v.z * lead) };
        moveTo(field, aim, 1.25, dt);
        moveTo(bowl, { x: SPOT.release.x - 0.2, z: SPOT.release.z + 0.3 }, 0.5, dt, yawTo(field.pos.x - bowl.pos.x, field.pos.z - bowl.pos.z));
        moveTo(bat, SPOT.bat, 0.4, dt, faceRoad);
        if (Math.hypot(ball.p.x - field.pos.x, ball.p.z - field.pos.z) < 0.16 && ball.p.y < 0.2) {
          ball.held = field; game.state = 'throw'; game.t = 0; game.throwT = -1; game.thrower = field;
        }
        break;
      }
      case 'fetch': {
        // the batsman fetches a ball that got past him
        const got = moveTo(bat, { x: ball.p.x, z: ball.p.z + 0.1 }, 0.9, dt);
        if (got && ball.p.y < 0.2) { ball.held = bat; game.state = 'throw'; game.t = 0; game.throwT = -1; game.thrower = bat; }
        if (game.bowled && !game.cheered) { bowl.cheer = 1.5; game.cheered = true; }
        moveTo(bowl, { x: SPOT.release.x - 0.2, z: SPOT.release.z + 0.1 }, 0.5, dt, yawTo(bat.pos.x - bowl.pos.x, bat.pos.z - bowl.pos.z));
        break;
      }
      case 'throw': {
        const th = game.thrower;
        th.speed = Math.max(0, th.speed - 4 * dt);
        th.yaw += THREE.MathUtils.clamp(wrap(yawTo(bowl.pos.x - th.pos.x, bowl.pos.z - th.pos.z) - th.yaw), -6 * dt, 6 * dt);
        if (game.t > 0.35 && game.throwT < 0) game.throwT = 0;
        if (game.throwT >= 0) {
          game.throwT += dt / 0.32;
          if (ball.held === th && game.throwT > 0.45) {
            handPos(th, tmp);
            const dist = Math.hypot(bowl.pos.x - tmp.x, bowl.pos.z - tmp.z);
            handPos(bowl, tmp2); tmp2.y += 0.05;
            launch(tmp, tmp2, 0.25 + dist / 3.2);
            game.state = 'return'; game.t = 0;
          }
        }
        break;
      }
      case 'return': {
        if (game.throwT >= 0) game.throwT += dt / 0.32;
        handPos(bowl, tmp);
        if (ball.p.distanceTo(tmp) < 0.16) { ball.held = bowl; game.state = 'reset'; game.t = 0; game.throwT = -1; }
        else if (ballSettled() || game.t > 3) { // dropped it: go and pick it up
          if (moveTo(bowl, { x: ball.p.x, z: ball.p.z + 0.1 }, 0.7, dt) && ball.p.y < 0.2) { ball.held = bowl; game.state = 'reset'; game.t = 0; }
        }
        break;
      }
      case 'home': { // dusk: everyone walks off out of the lane, the bowler with the ball and the batsman with his bat
        const a = moveTo(bowl, SPOT.out, 0.5, dt), b = moveTo(bat, { x: SPOT.out.x + 0.25, z: SPOT.out.z + 0.1 }, 0.5, dt),
          c = moveTo(field, { x: SPOT.out.x - 0.25, z: SPOT.out.z }, 0.5, dt);
        if (!ball.held) ball.held = bowl;
        if (a && b && c) { group.visible = false; game.state = 'gone'; }
        break;
      }
    }
  }

  function pose(dt, t, wet, impacts) {
    const { bowl, bat, field } = kids;
    for (const k of [bowl, bat, field]) {
      const { swing, elbow, strikes } = gait(k.g, k.J, k.fig, k.speed, dt, k.size);
      const J = k.J;
      if (J.arm_l) J.arm_l.rotation.set(0, 0, -swing);
      if (J.elbow_l) J.elbow_l.rotation.z = elbow;
      if (J.arm_r) J.arm_r.rotation.set(0, 0, swing);
      if (J.elbow_r) J.elbow_r.rotation.z = elbow;
      // eyes on the ball
      if (J.head) {
        const want = wrap(yawTo(ball.p.x - k.pos.x, ball.p.z - k.pos.z) - k.yaw);
        k.look += (THREE.MathUtils.clamp(want, -1.1, 1.1) - k.look) * Math.min(1, dt * 5);
        J.head.rotation.set(0, k.look, 0.05);
      }
      for (const s of strikes) {
        if (wet < 0.25) break;
        k.fig.localToWorld(tmp.set(0.1, 0, s === 'l' ? -0.03 : 0.03));
        impacts.ring(tmp.x, tmp.y + 0.002, tmp.z, 0.6);
        for (let i = 0; i < 3; i++) impacts.droplet(tmp.x, tmp.y + 0.02, tmp.z, rand(-0.2, 0.2), rand(0.25, 0.45), rand(-0.2, 0.2));
      }
    }
    // the bowler's arm windmills over (straight, as the law says), the other arm up to aim
    if (game.state === 'runup' && game.wind > 0) {
      const w = Math.min(1, game.wind);
      bowl.J.arm_r.rotation.set(0, 0, -2 * Math.PI * w);
      bowl.J.elbow_r.rotation.z = 0.05;
      bowl.J.arm_l.rotation.set(0.2, 0, 1.7 * Math.sin(Math.PI * Math.min(1, w * 1.3)));
      bowl.J.elbow_l.rotation.z = 0.4;
    }
    // the batsman: on guard, bat lifted as the ball comes, then the swing through
    const B = bat.J;
    if (game.state === 'flight' || game.state === 'runup' || game.state === 'reset') {
      const lift = game.state === 'reset' ? 0 : game.state === 'runup' ? Math.min(1, game.wind * 1.2) : 1;
      let arm = 0.2 - 1.35 * lift, el = 0.35 + 0.55 * lift;
      if (game.swing >= 0) { const s = Math.min(1, game.swing); arm = -1.15 + 2.75 * s * s * (3 - 2 * s); el = 0.9 - 0.7 * s; }
      B.arm_r.rotation.set(-0.1, 0, arm); B.elbow_r.rotation.z = el;
      B.arm_l.rotation.set(0.15, 0, 0.45 + 0.3 * lift); B.elbow_l.rotation.z = 0.9;
      bat.fig.rotation.z = -0.12; // knees bent, leaning in
    } else if (game.state === 'play' && game.t < 1.2) {
      B.arm_r.rotation.set(-0.1, 0, 1.6 - game.t * 0.8); B.elbow_r.rotation.z = 0.2; // the follow-through
    }
    // a throw: the arm cocks back then whips through
    if (game.throwT >= 0 && (game.state === 'throw' || game.state === 'return')) {
      const th = game.thrower, s = Math.min(1, game.throwT);
      th.J.arm_r.rotation.set(-0.2, 0, s < 0.45 ? -2.4 * (s / 0.45) : -2.4 + 3.6 * ((s - 0.45) / 0.55));
      th.J.elbow_r.rotation.z = s < 0.45 ? 1.2 : 1.2 - 1.0 * ((s - 0.45) / 0.55);
    }
    // a bent-down pickup
    for (const k of [field, bat, bowl]) {
      const near = !ball.held && Math.hypot(ball.p.x - k.pos.x, ball.p.z - k.pos.z) < 0.35 && ball.p.y < 0.2 && k.speed < 0.6;
      k.stoop = (k.stoop || 0) + ((near ? 1 : 0) - (k.stoop || 0)) * Math.min(1, dt * 6);
      if (k.stoop > 0.01) { k.fig.rotation.z -= 0.7 * k.stoop; k.J.arm_r.rotation.z = THREE.MathUtils.lerp(k.J.arm_r.rotation.z, 0.9, k.stoop); }
    }
    // a wicket! the bowler throws his arms up
    if (bowl.cheer > 0) {
      bowl.cheer -= dt;
      bowl.J.arm_r.rotation.set(-0.4, 0, 2.9); bowl.J.arm_l.rotation.set(0.4, 0, 2.9);
      bowl.fig.position.y += Math.max(0, Math.sin(t * 12)) * 0.03;
    }
    for (const k of [bowl, bat, field]) {
      k.holder.position.set(k.pos.x, ground(k.pos.z), k.pos.z);
      k.holder.rotation.y = k.yaw;
    }
    // the stumps rock back when hit, then are set up again for the next ball
    if (stumpsKick) { stumpsTilt += stumpsKick * 0.25; stumpsKick = 0; }
    if (game.state === 'reset') stumpsTilt *= Math.exp(-dt * 3);
    stumpsTilt = Math.min(stumpsTilt, 1.2);
    if (stumps) stumps.rotation.z = -stumpsTilt;
  }

  return {
    group, ready,
    debug: { game, ball, get kids() { return kids; } },
    update(dt, t, rain, wet, night, impacts) {
      if (!kids) return;
      // kids go home at dusk and are back in the morning
      if (night > 0.7 && game.state !== 'home' && game.state !== 'gone') { game.state = 'home'; ball.held = kids.bowl; }
      if (game.state === 'gone') {
        if (night > 0.6) return;
        group.visible = true;
        for (const [k, dx] of [[kids.bowl, 0], [kids.bat, 0.25], [kids.field, -0.25]]) { k.pos = { x: SPOT.out.x + dx, z: SPOT.out.z }; }
        game.state = 'reset'; game.t = 0; ball.held = kids.bowl;
      }
      think(dt);
      stepBall(dt, wet, impacts);
      pose(dt, t, wet, impacts);
    },
  };
}
