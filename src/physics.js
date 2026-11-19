// The physical bits: wind, rain that lands on things, splashes and flung droplets.
//
// Scale: one storey (3 m) is 1.3 scene units, so 1 unit ≈ 2.3 m and
//   gravity        9.8 m/s²  →  4.2 units/s²
//   raindrops      fall at terminal velocity, ~8–9.5 m/s (by size) → ~3.5–4.1 units/s
//   walking pace   ~1.3 m/s → ~0.55 units/s
import * as THREE from 'three';

export const G = 4.2;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- wind
// One gusty wind for everything: rain slant, washing, tarp, tree, mist and steam all answer to it.
export function makeWind() {
  const w = { speed: 0, gust: 0 };
  w.update = (t, rain) => {
    const base = 0.12 + rain * 1.25; // units/s along +x: a breeze when dry, ~3 m/s gusting higher in a storm
    w.gust = 0.55 * Math.sin(t * 0.31) + 0.3 * Math.sin(t * 0.83 + 1.7) + 0.15 * Math.sin(t * 2.3 + 0.4);
    w.speed = base * (1 + 0.6 * w.gust);
  };
  return w;
}

// ---------------------------------------------------------------- shelter map
// Render the street once from straight above into a float target that stores the height of the
// first surface each column of rain would hit. Rain then stops on roofs, awnings, the chai tarp
// and the tree, instead of falling through them.
export function buildShelter(renderer, scene, skip) {
  const N = 384, X0 = -7.8, X1 = 7.8, Z0 = -6.0, Z1 = 5.7;
  const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cam = new THREE.OrthographicCamera(X0, X1, -Z0, -Z1, 0.1, 60); // screen up = world -z
  cam.position.set(0, 30, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const heightMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }',
  });
  const hidden = [];
  scene.traverse((o) => {
    const m = o.isMesh && [].concat(o.material)[0];
    const thin = m && /^(wire|rope|line_white|flag_)/.test(m.name); // cables and bunting don't keep rain off
    if (o.visible && (o.isLine || o.isPoints || o.isSprite || thin || skip.includes(o))) { o.visible = false; hidden.push(o); }
  });
  const prev = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  scene.overrideMaterial = heightMat;
  renderer.render(scene, cam);
  scene.overrideMaterial = null;
  renderer.setRenderTarget(prev);
  renderer.setClearColor(clear, clearA);
  hidden.forEach((o) => { o.visible = true; });
  const buf = new Float32Array(N * N * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
  rt.dispose();
  heightMat.dispose();
  return (x, z) => {
    const i = Math.floor(((x - X0) / (X1 - X0)) * N);
    const j = Math.floor(((-z + Z1) / (Z1 - Z0)) * N);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1.5;
    const o = (j * N + i) * 4;
    return buf[o + 1] > 0.5 ? buf[o] : -1.5;
  };
}

// ---------------------------------------------------------------- impacts: splash rings + droplets
export function makeImpacts(scene, rings = 260, drops = 1200) {
  // rings: a short-lived expanding ring wherever water lands
  const ringGeo = new THREE.RingGeometry(0.6, 1, 18).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#dbe8f7', transparent: true, opacity: 0.28, depthWrite: false });
  const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, rings);
  ringMesh.frustumCulled = false;
  scene.add(ringMesh);
  const R = Array.from({ length: rings }, () => ({ x: 0, y: 0, z: 0, t: 1, s: 1 }));
  let ri = 0;
  // droplets: little ballistic beads (splash crowns, tyre spray, footsteps)
  const dpos = new Float32Array(drops * 3);
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dmat = new THREE.PointsMaterial({ color: '#dce8f6', size: 0.022, transparent: true, opacity: 0.75, depthWrite: false });
  const points = new THREE.Points(dgeo, dmat);
  points.frustumCulled = false;
  scene.add(points);
  const D = Array.from({ length: drops }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), floor: 0, on: false }));
  let di = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();

  const api = {
    ring(x, y, z, size = 1) {
      const o = R[ri]; ri = (ri + 1) % rings;
      o.x = x; o.y = Math.max(y, 0.0166) + 0.002; o.z = z; o.t = 0; o.s = size;
    },
    droplet(x, y, z, vx, vy, vz, floor = 0.0166) {
      const d = D[di]; di = (di + 1) % drops;
      d.p.set(x, y, z); d.v.set(vx, vy, vz); d.floor = floor; d.on = true;
    },
    /** A raindrop (or anything) landing: a ring, and now and then a crown of droplets. */
    hit(x, y, z, size = 1, crown = 0.06) {
      api.ring(x, y, z, size);
      if (Math.random() < crown) {
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * Math.PI * 2, h = rand(0.15, 0.35);
          api.droplet(x, y + 0.01, z, Math.cos(a) * h, rand(0.35, 0.6), Math.sin(a) * h, y);
        }
      }
    },
    update(dt) {
      for (let i = 0; i < rings; i++) {
        const o = R[i];
        o.t = Math.min(1, o.t + dt / 0.35);
        const r = o.t < 1 ? (0.012 + o.t * 0.07) * o.s : 0;
        p.set(o.x, o.y, o.z); sc.set(r, 1, r);
        m.compose(p, q, sc); ringMesh.setMatrixAt(i, m);
      }
      ringMesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < drops; i++) {
        const d = D[i];
        if (d.on) {
          d.v.y -= G * dt;
          d.p.addScaledVector(d.v, dt);
          if (d.p.y < d.floor) { d.on = false; }
        }
        const o = i * 3;
        if (d.on) { dpos[o] = d.p.x; dpos[o + 1] = d.p.y; dpos[o + 2] = d.p.z; } else { dpos[o + 1] = -50; }
      }
      dgeo.attributes.position.needsUpdate = true;
    },
  };
  return api;
}

// ---------------------------------------------------------------- rain
// Drops fall at terminal velocity, drift with the wind, and stop on the first surface below them
// (from the shelter map), splashing there.
export function makeRain(scene, impacts, count = 7500) {
  const XA = -7.6, XB = 7.6, ZA = -5.7, ZB = 5.4; // over the block only, never into the void around it
  const pos = new Float32Array(count * 6);
  const col = new Float32Array(count * 8);
  const drops = [];
  for (let i = 0; i < count; i++) {
    drops.push({ x: rand(XA, XB), y: rand(0, 13), z: rand(ZA, ZB), v: rand(3.5, 4.1) });
    const a = rand(0.25, 0.85), b = rand(0.8, 1);
    col.set([b, b, b, a, b, b, b, 0], i * 8); // bright head, clear tail: motion blur
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const mat = new THREE.LineBasicMaterial({ color: '#d4e2f4', vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  let heightAt = () => 0.01;
  const SHUTTER = 1 / 22; // streak length = distance travelled while the "shutter" is open

  return {
    setShelter(fn) { heightAt = fn; },
    update(dt, rain, wind) {
      const n = Math.floor(count * rain * rain);
      geo.setDrawRange(0, n * 2);
      lines.visible = n > 0;
      mat.opacity = 0.35 + rain * 0.45;
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        d.x += wind * dt;
        if (d.x > XB) d.x -= XB - XA;
        const floor = heightAt(d.x, d.z);
        if (d.y <= floor) {
          if (floor > -1 && Math.random() < 0.22) impacts.hit(d.x, floor, d.z, rand(0.7, 1.2));
          d.y = rand(10, 14); d.x = rand(XA, XB); d.z = rand(ZA, ZB); // well above the frame, so the top of the rain never shows
        }
        const o = i * 6;
        pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z;
        pos[o + 3] = d.x - wind * SHUTTER; pos[o + 4] = d.y + d.v * SHUTTER; pos[o + 5] = d.z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- swaying things as damped springs
// Each sway_ object is a pendulum-ish spring pushed by the wind (plus a little turbulence), so it
// leans with gusts, overshoots and settles instead of ticking back and forth on a sine wave.
export function makeSway(items) {
  for (const s of items) {
    const n = s.obj.name;
    s.f = n.includes('crown') ? 0.55 : n.includes('tarp') ? 2.2 : n.includes('flag') ? 2.6 : 1.3; // natural frequency, Hz
    s.k = (2 * Math.PI * s.f) ** 2;
    s.c = 2 * 0.16 * 2 * Math.PI * s.f; // light damping
    s.ang = 0; s.vel = 0;
  }
  return (dt, t, wind) => {
    for (const s of items) {
      const turb = Math.sin(t * (1.7 + s.f) + s.phase) * 0.35 + Math.sin(t * 4.1 + s.phase * 2) * 0.15;
      const target = s.amt * wind * (1 + turb) * 1.4;
      const acc = s.k * (target - s.ang) - s.c * s.vel;
      s.vel += acc * dt;
      s.ang += s.vel * dt;
      s.obj.rotation[s.axis] = s.base + s.ang;
    }
  };
}
