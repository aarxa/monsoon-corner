import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// ---------- steam from the chai kettle ----------
// Each puff is a parcel of hot, wet air. Buoyancy lifts it (less and less as it mixes with cooler air),
// drag ties it to the air around it, and it can't pass through a roof: under the tarp it is pressed
// against the underside, spreads out from where it hit, creeps up the slope and spills over the edge,
// and only then rises again.
export function makeSteam(scene, origin, count = 26) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const LIFE = 2.8;
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    sp.userData = { age: (i / count) * LIFE, p: origin.clone(), v: new THREE.Vector3(0, 0.18, 0) };
    scene.add(sp); puffs.push(sp);
  }
  // roofAt(x, z): height of the first surface above that spot (the shelter map); anything clearly
  // above the kettle there is a roof
  let roofAt = null;
  const roof = (x, z) => { const h = roofAt(x, z); return h > origin.y + 0.05 ? h : Infinity; };
  const e = 0.05;
  return {
    setRoof(fn) { roofAt = fn; },
    update(dt, wind) {
      for (const sp of puffs) {
        const u = sp.userData;
        u.age += dt;
        if (u.age >= LIFE) {
          u.age -= LIFE;
          u.p.copy(origin);
          u.v.set(rand(-0.03, 0.03), 0.18, rand(-0.03, 0.03));
        }
        const f = u.age / LIFE;
        const size = 0.05 + f * 0.26;
        const buoy = 0.55 * Math.exp(-u.age / 0.9); // units/s²
        const top = roofAt ? roof(u.p.x, u.p.z) : Infinity;
        const air = top < Infinity ? wind * 0.25 : wind; // the tarp keeps most of the wind off
        u.v.y += buoy * dt;
        const kd = 1 - Math.exp(-dt * 1.8);
        u.v.x += (air - u.v.x) * kd; u.v.z -= u.v.z * kd; u.v.y -= u.v.y * kd * 0.4;
        u.p.addScaledVector(u.v, dt);
        const ceil = top - 0.02 - size * 0.55; // the whole puff stays under the sheet
        if (u.p.y > ceil) {
          u.p.y = ceil;
          // the rising jet hits the sheet and fans out from that spot...
          if (u.v.y > 0) {
            const rx = u.p.x - origin.x, rz = u.p.z - origin.z, rl = Math.hypot(rx, rz) + 1e-3;
            u.v.x += (rx / rl) * u.v.y * 0.7; u.v.z += (rz / rl) * u.v.y * 0.7; u.v.y = 0;
          }
          // ...and what lift is left pushes it along the underside, uphill, toward an edge
          const s = (x, z) => { const h = roof(x, z); return h < Infinity ? h : top; };
          const gx = (s(u.p.x + e, u.p.z) - s(u.p.x - e, u.p.z)) / (2 * e);
          const gz = (s(u.p.x, u.p.z + e) - s(u.p.x, u.p.z - e)) / (2 * e);
          u.v.x += gx * buoy * 3 * dt + (u.p.x - origin.x) * buoy * 0.6 * dt;
          u.v.z += gz * buoy * 3 * dt + (u.p.z - origin.z) * buoy * 0.6 * dt;
        }
        sp.position.copy(u.p);
        sp.scale.setScalar(size);
        sp.material.opacity = Math.min(1, f * 8) * Math.pow(1 - f, 1.2) * 0.42;
      }
    },
  };
}

// ---------- the wet road: one mirror plane with puddles and ripples ----------
const puddleShader = {
  name: 'PuddleShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uWet: { value: 0 },
    uRain: { value: 0 },
    uSize: { value: new THREE.Vector2(15.4, 4) },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vPlane;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vPlane = uv;
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime, uWet, uRain;
    uniform vec2 uSize;
    varying vec4 vUv;
    varying vec2 vPlane;
    #include <logdepthbuf_pars_fragment>

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

    // one expanding ring per grid cell, each on its own clock.
    // xy: how much the ring bends the reflection, z: how bright the ring is
    vec3 ripples(vec2 p) {
      vec3 g = vec3(0.0);
      for (int k = 0; k < 2; k++) {
        vec2 q = p * 3.2 + float(k) * 17.3;
        vec2 cell = floor(q), f = fract(q);
        float h = hash(cell + float(k));
        float t = fract(uTime * 0.8 + h);
        vec2 c = vec2(hash(cell + 3.1), hash(cell + 9.7)) * 0.6 + 0.2;
        vec2 d = f - c;
        float r = length(d);
        float wave = sin((r - t * 0.45) * 70.0) * smoothstep(0.08, 0.0, abs(r - t * 0.45)) * (1.0 - t);
        g.xy += normalize(d + 1e-4) * wave;
        g.z += abs(wave);
      }
      return g;
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vPlane * uSize;
      float n = fbm(p * 0.55 + 3.0);
      float edge = 0.66 - uWet * 0.2;
      float puddle = smoothstep(edge, edge + 0.04, n);

      vec3 rip = ripples(p);
      vec4 uv = vUv;
      uv.xy += rip.xy * 0.012 * uRain * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;

      // puddles mirror the street; the rest of the road only catches light where a drop lands
      float glint = clamp(rip.z, 0.0, 1.0) * uRain;
      float alpha = (0.8 * puddle + 0.6 * glint * (1.0 - puddle)) * uWet;
      gl_FragColor = vec4(mix(color, refl, 0.88), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function makeWetRoad(scene) {
  const geo = new THREE.PlaneGeometry(15.4, 4);
  const mirror = new Reflector(geo, {
    shader: puddleShader,
    color: new THREE.Color('#3a3f46'),
    textureWidth: Math.min(1024, window.innerWidth * devicePixelRatio * 0.6),
    textureHeight: Math.min(1024, window.innerHeight * devicePixelRatio * 0.6),
    clipBias: 0.003,
  });
  // don't redo the reflection when another pass (ambient occlusion) re-renders the scene
  const reflect = mirror.onBeforeRender;
  mirror.onBeforeRender = function (...args) { if (!args[1].overrideMaterial) reflect.apply(this, args); };
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set(0, 0.014, 3.25);
  mirror.material.transparent = true;
  mirror.material.depthWrite = false;
  mirror.renderOrder = 1;
  scene.add(mirror);
  const u = mirror.material.uniforms;
  return {
    mirror,
    update(t, wet, rain) {
      u.uTime.value = t; u.uWet.value = wet; u.uRain.value = rain;
      mirror.visible = wet > 0.01;
    },
  };
}

// ---------- roof spouts: water pouring off the roofs in the rain ----------
// Each spout pours a continuous rope of water along its arc (out at ~0.4-0.6 units/s, then falling
// under gravity), drawn as a ribbon turned to face the camera with streaks running down it. As the water
// speeds up the rope thins (the same flow moving faster needs less width: width ∝ 1/√v) and, lower down,
// breaks up into slugs and drops (Plateau-Rayleigh). Those drops are real particles shed along the lower
// stream at a steady rate (never all at once, so they don't fall in lockstep), and they're what lands:
// spray and foam where the stream hits, and water onto the tarp for its runoff.
export function makeSpouts(scene, spouts, ground, impacts, runoff, splash) {
  const G = 4.2;       // gravity in scene units (1 unit ≈ 2.3 m)
  const SEG = 32;      // segments along each stream's ribbon
  const DROPS = 60;    // drop slots per stream
  const streams = [];
  const down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster();
  for (const s of spouts) {
    const tip = s.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(s.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    // where does the water land? follow the arc: it leaves at ~0.55 units/s and falls for t = √(2h/g),
    // so look down from that far out (twice, since the height it falls depends on what it lands on)
    let hit = null, floor = 0;
    for (let k = 0; k < 3; k++) {
      const t = Math.sqrt((2 * Math.max(0.05, tip.y - floor)) / G);
      ray.set(tip.clone().addScaledVector(dir, 0.55 * t).setY(tip.y - 0.05), down);
      hit = ray.intersectObject(ground, true)[0];
      floor = hit ? hit.point.y : 0.01;
    }
    // pouring onto a roof sheet (the chai tarp)? then that water runs off the sheet's edges later
    const roof = hit ? runoff?.roofOf(hit.object) : null;
    streams.push({ tip, dir, roof, floor: hit ? hit.point.y : 0.01, T: 1, v0: 0.5, acc: Math.random(), seed: Math.random() * 50,
      drops: Array.from({ length: DROPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), on: false })) });
  }

  // the ropes of water
  const nv = streams.length * (SEG + 1) * 2;
  const rpos = new Float32Array(nv * 3), rflow = new Float32Array(nv * 3), ridx = [];
  streams.forEach((st, k) => {
    const b = k * (SEG + 1) * 2;
    for (let i = 0; i <= SEG; i++) {
      for (let side = 0; side < 2; side++) rflow.set([side, i / SEG, st.seed], (b + i * 2 + side) * 3);
      if (i < SEG) { const a = b + i * 2; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  });
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rgeo.setAttribute('aFlow', new THREE.BufferAttribute(rflow, 3));
  rgeo.setIndex(ridx);
  const U = { uTime: { value: 0 }, uFlow: { value: 0 } };
  const rmat = new THREE.MeshBasicMaterial({ color: '#dce9f7', transparent: true, depthWrite: false, side: THREE.DoubleSide });
  rmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFlow; varying vec3 vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uFlow; varying vec3 vFlow;
        float h1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
        float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        {
          float x = vFlow.x * 2.0 - 1.0, y = vFlow.y, seed = vFlow.z;
          float body = sqrt(max(0.0, 1.0 - x * x));                         // a round rope: solid in the middle, clear at the edges
          float streak = 0.5 * n1(vFlow.x * 6.0 + seed) + 0.5 * n1(y * 10.0 - uTime * 5.0 + vFlow.x * 11.0 + seed);
          float a = body * (0.35 + 0.65 * streak);                           // streaks running down with the water
          float slugs = smoothstep(0.3, 0.7, n1(y * 24.0 - uTime * 13.0 + seed * 3.0));
          a *= mix(1.0, slugs, smoothstep(0.5, 1.0, y) * 0.9);                // lower down it breaks into slugs
          diffuseColor.a *= a * uFlow * smoothstep(1.0, 0.94, y);
        }`);
  };
  const ropes = new THREE.Mesh(rgeo, rmat);
  ropes.frustumCulled = false;
  ropes.userData.noAO = true; // see-through water: the ambient-occlusion pass would shade it like a solid pole
  ropes.renderOrder = 2;
  scene.add(ropes);

  // the drops it breaks into
  const n = streams.length * DROPS;
  const pos = new Float32Array(n * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#dce9f7', transparent: true, opacity: 0.75, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);

  const P = new THREE.Vector3(), V = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  const at = (st, t, out) => out.copy(st.tip).addScaledVector(st.dir, st.v0 * t).setY(st.tip.y - 0.5 * G * t * t);
  const velAt = (st, t, out) => out.copy(st.dir).multiplyScalar(st.v0).setY(-G * t);
  let time = 0;

  return {
    /** light: how lit the water looks (lower at night) */
    update(dt, rain, camera, light = 1) {
      time += dt;
      const rate = rain > 0.2 ? (rain - 0.2) / 0.8 : 0;
      U.uTime.value = time;
      U.uFlow.value = 0.85 * THREE.MathUtils.smoothstep(rate, 0.05, 0.35); // a light rain only dribbles
      rmat.color.set('#dce9f7').multiplyScalar(light);
      mat.color.set('#dce9f7').multiplyScalar(light);
      let i = 0;
      streams.forEach((st, k) => {
        // this stream's arc for the current flow: how fast it leaves, and when it lands (twice, since where it
        // lands decides how far it falls)
        st.v0 = 0.4 + 0.2 * rate;
        let floor = st.floor;
        for (let it = 0; it < 2; it++) {
          st.T = Math.sqrt((2 * Math.max(0.02, st.tip.y - floor)) / G);
          if (splash) floor = splash.floorBelow(at(st, st.T, P), st.floor);
        }
        // the rope, a ribbon facing the camera
        const b = k * (SEG + 1) * 2, w0 = 0.03 * (0.7 + 0.3 * rate);
        for (let s = 0; s <= SEG; s++) {
          const t = (st.T * s) / SEG;
          at(st, t, P); velAt(st, t, V);
          const w = w0 * Math.max(0.6, Math.sqrt(st.v0 / Math.max(st.v0, V.length())));
          side.crossVectors(V, toCam.subVectors(camera.position, P)).normalize().multiplyScalar(w / 2);
          rpos.set([P.x - side.x, P.y - side.y, P.z - side.z, P.x + side.x, P.y + side.y, P.z + side.z], (b + s * 2) * 3);
        }
        // drops shed along the lower stream at a steady rate (a trickle sheds from the top)
        st.acc += rate * 45 * dt;
        const lo = THREE.MathUtils.lerp(0, 0.3, Math.min(1, rate * 3));
        while (st.acc >= 1) {
          st.acc -= 1;
          const d = st.drops.find((o) => !o.on);
          if (!d) { st.acc = 0; break; }
          const t = st.T * (lo + (0.95 - lo) * Math.random());
          at(st, t, d.p).add(side.set((Math.random() - 0.5) * 0.015, 0, (Math.random() - 0.5) * 0.015));
          velAt(st, t, d.v).add(side.set((Math.random() - 0.5) * 0.2, Math.random() * 0.1, (Math.random() - 0.5) * 0.2));
          d.on = true;
        }
        for (const d of st.drops) {
          if (d.on) {
            d.v.y -= G * dt;
            d.p.addScaledVector(d.v, dt);
            const fl = splash ? splash.floorBelow(d.p, st.floor) : st.floor; // exactly the surface under it
            if (d.p.y < fl) {
              d.on = false;
              if (st.roof) runoff.add(st.roof, 0.05);
              d.p.y = fl;
              if (splash) splash.land(d.p, d.v, 1); else impacts?.hit(d.p.x, fl, d.p.z, 1.6, 0.3);
            }
          }
          const o = i * 6;
          if (d.on) {
            pos[o] = d.p.x; pos[o + 1] = d.p.y; pos[o + 2] = d.p.z;
            pos[o + 3] = d.p.x - d.v.x * 0.025; pos[o + 4] = d.p.y - d.v.y * 0.025; pos[o + 5] = d.p.z - d.v.z * 0.025;
          } else pos.fill(0, o, o + 6);
          i++;
        }
      });
      rgeo.attributes.position.needsUpdate = true;
      geo.attributes.position.needsUpdate = true;
      ropes.visible = U.uFlow.value > 0.001;
      lines.visible = rate > 0 || streams.some((st) => st.drops.some((d) => d.on));
    },
  };
}

// ---------- where poured water lands: spray, a churn of white water, a sheet running off ----------
// A stream landing isn't a string of separate raindrops: each slug of water hitting a surface throws a
// crown of droplets up and out (faster the harder it lands), keeps a patch of white, aerated water churning
// where the stream strikes, and the rest runs off as a thin sheet: downhill across a sloping tarp, spreading
// out on flat ground. Surfaces come from the shelter map (the height of what's below), so the water lands
// exactly on the tarp's slope or the footpath, not at some guessed height.
export function makeSplash(scene, impacts) {
  const G = 4.2, MAXS = 900, MAXF = 600, FOAMS = 28;
  let heightAt = null;
  const spray = Array.from({ length: MAXS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), floor: 0, on: false }));
  const sheet = Array.from({ length: MAXF }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), floor: 0, life: 0, on: false }));
  let si = 0, fi = 0;
  const streaks = (n, color, opacity) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    l.frustumCulled = false;
    scene.add(l);
    return l;
  };
  const sprayLines = streaks(MAXS, '#eef5fd', 0.7), sheetLines = streaks(MAXF, '#dfeaf6', 0.45);
  // the churn: soft white blotches lying on the surface, re-shuffled every frame so they boil
  const foamTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * 6.28, r = Math.random() * 20, x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r, rr = 3 + Math.random() * 7;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 6.28); g.fill();
    }
    return new THREE.CanvasTexture(c);
  })();
  const foamGeo = new THREE.PlaneGeometry(1, 1);
  const foams = Array.from({ length: FOAMS }, () => {
    const m = new THREE.Mesh(foamGeo, new THREE.MeshLambertMaterial({ map: foamTex, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, // lit, so it dims at night
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.visible = false;
    scene.add(m);
    return { m, p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), k: 0, size: 0.1 };
  });
  const tmp = new THREE.Vector3(), t2 = new THREE.Vector3();

  // the surface under (x, z), if it's the same one we're on (within reach of `near`): height and normal
  function surface(x, z, near, out) {
    let y = near;
    if (heightAt) {
      const h = heightAt(x, z);
      if (Math.abs(h - near) < 0.15) y = h;
    }
    const e = 0.04;
    let hx0 = y, hx1 = y, hz0 = y, hz1 = y;
    if (heightAt) {
      const f = (a, b) => { const h = heightAt(a, b); return Math.abs(h - y) < 0.12 ? h : y; };
      hx0 = f(x - e, z); hx1 = f(x + e, z); hz0 = f(x, z - e); hz1 = f(x, z + e);
    }
    out.set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
    return y;
  }

  const api = {
    setShelter(fn) { heightAt = fn; },
    /** The surface a falling drop at p would meet, or `fallback` if nothing's found below it. */
    floorBelow(p, fallback) {
      if (!heightAt) return fallback;
      const h = heightAt(p.x, p.z);
      return h < p.y + 0.02 && h > -1 ? h : fallback;
    },
    /** A slug of water landing at p (on the surface) with velocity v. */
    land(p, v, strength = 1) {
      const n = t2;
      const y = surface(p.x, p.z, p.y, n);
      const speed = v.length(), k = THREE.MathUtils.clamp(speed / 3, 0.45, 1.25) * strength;
      // a crown of droplets, thrown up off the surface and out, carrying a little of the stream's own drift
      const count = 2 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const d = spray[si]; si = (si + 1) % MAXS;
        const a = Math.random() * Math.PI * 2, out = 0.08 + Math.random() * 0.24, up = 0.35 + Math.random() * 0.4;
        tmp.set(Math.cos(a), 0, Math.sin(a)).addScaledVector(n, -n.dot(tmp.set(Math.cos(a), 0, Math.sin(a)))).normalize();
        d.v.copy(tmp).multiplyScalar(out * k).addScaledVector(n, up * k);
        d.v.x += v.x * 0.25; d.v.z += v.z * 0.25;
        d.p.set(p.x, y + 0.01, p.z);
        d.floor = y; d.on = true;
      }
      // and the rest runs off as a sheet: downhill on a slope, spreading out on the flat
      const f = sheet[fi]; fi = (fi + 1) % MAXF;
      const slope = Math.hypot(n.x, n.z);
      if (slope > 0.05) { f.v.set(n.x, 0, n.z).normalize().multiplyScalar(0.25 + Math.random() * 0.3); f.v.x += (Math.random() - 0.5) * 0.15; f.v.z += (Math.random() - 0.5) * 0.15; }
      else { const a = Math.random() * Math.PI * 2; f.v.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.1 + Math.random() * 0.22); }
      f.p.set(p.x + (Math.random() - 0.5) * 0.03, y + 0.004, p.z + (Math.random() - 0.5) * 0.03);
      f.floor = y; f.life = 0.35 + Math.random() * 0.55; f.on = true;
      // the churn where it strikes, and only now and then a ring
      let best = null;
      for (const fo of foams) if (fo.k > 0 && fo.p.distanceToSquared(tmp.set(p.x, y, p.z)) < 0.0036) { best = fo; break; }
      if (!best) best = foams.reduce((a, b) => (b.k < a.k ? b : a));
      if (best.k <= 0) { best.p.set(p.x, y, p.z); best.n.copy(n); }
      best.k = Math.min(1, best.k + 0.18 * strength);
      best.size = Math.min(0.16, 0.06 + best.k * 0.1);
      if (Math.random() < 0.025) impacts?.ring(p.x, y, p.z, 0.7);
    },
    update(dt) {
      const sp = sprayLines.geometry.attributes.position.array;
      let any = false;
      for (let i = 0; i < MAXS; i++) {
        const d = spray[i], o = i * 6;
        if (d.on) {
          d.v.y -= G * dt;
          d.v.multiplyScalar(1 - 0.6 * dt);
          d.p.addScaledVector(d.v, dt);
          if (d.p.y < d.floor) d.on = false; // spray this fine just rejoins the water
        }
        if (d.on) {
          any = true;
          tmp.copy(d.v).multiplyScalar(1 / 22);
          if (tmp.lengthSq() < 0.012 * 0.012) tmp.setLength(0.012);
          sp[o] = d.p.x; sp[o + 1] = d.p.y; sp[o + 2] = d.p.z; sp[o + 3] = d.p.x - tmp.x; sp[o + 4] = d.p.y - tmp.y; sp[o + 5] = d.p.z - tmp.z;
        } else sp.fill(0, o, o + 6);
      }
      sprayLines.geometry.attributes.position.needsUpdate = true;
      sprayLines.visible = any;
      const sh = sheetLines.geometry.attributes.position.array;
      any = false;
      for (let i = 0; i < MAXF; i++) {
        const f = sheet[i], o = i * 6;
        if (f.on) {
          f.life -= dt;
          const y = surface(f.p.x + f.v.x * dt, f.p.z + f.v.z * dt, f.floor, t2);
          if (f.life <= 0 || y < f.floor - 0.03) f.on = false; // gone, or off the edge (the runoff takes it from there)
          else {
            // gravity along the slope, friction against the surface
            f.v.x += t2.x * G * 0.5 * dt; f.v.z += t2.z * G * 0.5 * dt;
            f.v.multiplyScalar(1 - 2.2 * dt);
            f.p.x += f.v.x * dt; f.p.z += f.v.z * dt; f.p.y = y + 0.004; f.floor = y;
          }
        }
        if (f.on) {
          any = true;
          tmp.set(f.v.x, 0, f.v.z);
          const len = THREE.MathUtils.clamp(tmp.length() * 0.18, 0.012, 0.05) * Math.min(1, f.life * 3);
          tmp.setLength(len);
          sh[o] = f.p.x; sh[o + 1] = f.p.y; sh[o + 2] = f.p.z; sh[o + 3] = f.p.x - tmp.x; sh[o + 4] = f.p.y; sh[o + 5] = f.p.z - tmp.z;
        } else sh.fill(0, o, o + 6);
      }
      sheetLines.geometry.attributes.position.needsUpdate = true;
      sheetLines.visible = any;
      for (const fo of foams) {
        fo.k = Math.max(0, fo.k - dt / 0.45);
        fo.m.visible = fo.k > 0.01;
        if (!fo.m.visible) continue;
        fo.m.position.copy(fo.p).addScaledVector(fo.n, 0.003);
        fo.m.lookAt(tmp.copy(fo.m.position).add(fo.n));
        fo.m.rotateZ(Math.random() * Math.PI * 2);              // it boils: a new shuffle every frame
        const s = fo.size * (0.85 + Math.random() * 0.3);
        fo.m.scale.set(s, s, 1);
        fo.m.material.opacity = Math.min(0.62, fo.k * 0.75);
      }
    },
  };
  return api;
}

// ---------- splash mist: in a downpour, drops shattering on the road throw up a knee-high haze ----------
export function makeMist(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) { // a soft, lumpy blob
    const x = 64 + rand(-30, 30), y = 64 + rand(-14, 14), r = rand(18, 40);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  const white = new THREE.Color('#ffffff');
  const puffs = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    sp.scale.set(rand(3, 5), rand(0.22, 0.36), 1);
    sp.position.set(rand(-9, 9), rand(0.07, 0.13), Math.random() < 0.8 ? rand(1.4, 5.2) : rand(0.1, 1.2));
    sp.userData.v = rand(0.12, 0.3);
    scene.add(sp); puffs.push(sp);
  }
  return {
    update(dt, rain, fogColor, wind = 0.3) {
      const k = Math.pow(Math.max(0, rain - 0.4) / 0.6, 1.4) * 0.35;
      for (const sp of puffs) {
        sp.position.x += (sp.userData.v * 0.4 + wind * 0.5) * dt;
        if (sp.position.x > 9.5) sp.position.x = -9.5;
        const edge = THREE.MathUtils.clamp((9 - Math.abs(sp.position.x)) / 2, 0, 1);
        sp.material.opacity = k * edge;
        sp.material.color.copy(fogColor).lerp(white, 0.3);
        sp.visible = k > 0.001;
      }
    },
  };
}

// ---------- drops dripping off the chajjas and balcony ledges ----------
export function makeDrips(scene, points, ground, impacts) {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const src = points.map((p) => {
    const tip = p.getWorldPosition(new THREE.Vector3());
    ray.set(tip.clone().add(new THREE.Vector3(0, -0.03, 0)), down);
    const hit = ray.intersectObject(ground, true)[0];
    return { tip, floor: hit ? hit.point.y : 0, t: Math.random() * 2, drops: [0, 1].map(() => ({ p: new THREE.Vector3(), v: 0, on: false })) };
  });
  const pos = new Float32Array(src.length * 2 * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#dfeaf7', transparent: true, opacity: 0.8, depthWrite: false }));
  lines.frustumCulled = false;
  scene.add(lines);
  const G = 4.2;
  return {
    update(dt, rain) {
      lines.visible = rain > 0.2;
      if (!lines.visible) return;
      let i = 0;
      for (const s of src) {
        s.t -= dt;
        if (s.t <= 0) {
          const d = s.drops.find((d) => !d.on);
          if (d) { d.on = true; d.p.copy(s.tip); d.v = 0; }
          s.t = (0.3 + Math.random() * 1.4) / (0.2 + rain);
        }
        for (const d of s.drops) {
          const o = i * 6;
          if (d.on) {
            d.v += G * dt;
            d.p.y -= d.v * dt;
            if (d.p.y < s.floor) { d.on = false; impacts?.hit(d.p.x, s.floor, d.p.z, 1.0, 0.3); }
          }
          if (d.on) {
            const len = 0.02 + Math.min(0.12, d.v * 0.03);
            pos[o] = d.p.x; pos[o + 1] = d.p.y; pos[o + 2] = d.p.z;
            pos[o + 3] = d.p.x; pos[o + 4] = d.p.y + len; pos[o + 5] = d.p.z;
          } else pos.fill(0, o, o + 6);
          i++;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- runoff: water that lands on a roof sheet leaves over its edges ----------
// Each roof (the chai tarp, the shop awnings) is a small reservoir. Rain and any spout pouring onto it
// fill it; a shallow pool forms in the sag first, then water spills over the edges, most at the low
// points (each edge_ marker's `w`), and falls under gravity to whatever is below.
export function makeRunoff(scene, edges, ground, impacts, max = 700, splash = null) {
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const roofs = new Map();
  for (const e of edges) {
    const R = roofs.get(e.parent) || { obj: e.parent, pts: [], V: 0, area: e.parent.userData.area ?? 0.5, pool: e.parent.userData.pool ?? 0.2 };
    roofs.set(e.parent, R);
    const tip = e.getWorldPosition(new THREE.Vector3());
    ray.set(tip.clone().add(new THREE.Vector3(0, -0.03, 0)), down);
    const hit = ray.intersectObject(ground, true)[0];
    R.pts.push({ obj: e, w: e.userData.w ?? 1, floor: hit ? hit.point.y : 0.0166, debt: Math.random(), out: new THREE.Vector3() });
  }
  for (const R of roofs.values()) {
    // outward = away from the middle of the sheet, so water leaves the edge moving outward
    const mid = new THREE.Vector3();
    R.pts.forEach((p) => mid.add(p.obj.getWorldPosition(p.out)));
    mid.divideScalar(R.pts.length);
    R.pts.forEach((p) => p.out.sub(mid).setY(0).normalize());
    R.W = R.pts.reduce((a, p) => a + p.w, 0);
  }
  const D = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), floor: 0, on: false }));
  let di = 0;
  const pos = new Float32Array(max * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#eef5fc', transparent: true, opacity: 0.9, depthWrite: false }));
  lines.frustumCulled = false;
  scene.add(lines);
  const G = 4.2, TAU = 1.4, PER_VOL = 26, RAIN_IN = 1.0; // runoff time constant (s), drops per unit volume
  const tmp = new THREE.Vector3();
  return {
    /** The roof a hit object belongs to, if any. */
    roofOf(o) { while (o) { if (roofs.has(o)) return roofs.get(o); o = o.parent; } return null; },
    add(R, vol) { R.V += vol; },
    update(dt, rain) {
      let active = 0;
      for (const R of roofs.values()) {
        R.V += rain * R.area * RAIN_IN * dt;
        // fast overflow once the pool is full, plus a slow seep that keeps the edges dripping for a minute
        // or so after the rain stops, until the sag has drained
        const Q = Math.max(0, R.V - R.pool) / TAU + R.V * 0.02; // volume per second
        R.V = Math.max(0, R.V - Q * dt);
        const surge = Math.min(1, Q / 3);
        for (const p of R.pts) {
          p.debt += Q * (p.w / R.W) * PER_VOL * dt;
          while (p.debt >= 1) {
            p.debt -= 1;
            const d = D[di]; di = (di + 1) % max;
            p.obj.getWorldPosition(d.p);
            d.p.x += (Math.random() - 0.5) * 0.03; d.p.z += (Math.random() - 0.5) * 0.03;
            const sp = 0.06 + surge * 0.3 * Math.random(); // a heavier flow shoots off the edge faster
            d.v.set(p.out.x * sp, -0.05, p.out.z * sp);
            d.floor = p.floor; d.on = true;
          }
        }
      }
      for (let i = 0; i < max; i++) {
        const d = D[i];
        const o = i * 6;
        if (d.on) {
          d.v.y -= G * dt;
          d.p.addScaledVector(d.v, dt);
          if (d.p.y < d.floor) {
            d.on = false;
            d.p.y = d.floor;
            if (splash) { if (Math.random() < 0.7) splash.land(d.p, d.v, 0.7); }
            else if (Math.random() < 0.6) impacts?.hit(d.p.x, d.floor, d.p.z, 1.0, 0.25);
          }
        }
        if (d.on) {
          active++;
          tmp.copy(d.v).multiplyScalar(1 / 22); // blurred over the same 1/22 s "shutter" as the rain
          const len = Math.max(0.025, tmp.length());
          tmp.setLength(len);
          pos[o] = d.p.x; pos[o + 1] = d.p.y; pos[o + 2] = d.p.z;
          pos[o + 3] = d.p.x - tmp.x; pos[o + 4] = d.p.y - tmp.y; pos[o + 5] = d.p.z - tmp.z;
        } else pos.fill(0, o, o + 6);
      }
      lines.visible = active > 0;
      geo.attributes.position.needsUpdate = true;
    },
    /** Water currently held on each roof (for checking). */
    get levels() { return [...roofs.values()].map((R) => ({ name: R.obj.name, V: +R.V.toFixed(2), edges: R.pts.length })); },
  };
}

function rand(a, b) { return a + Math.random() * (b - a); }
