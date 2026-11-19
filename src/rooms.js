// Life behind the windows. Every window pane on the street has a room behind it, drawn in the glass by
// interior mapping: the view ray is traced on into a box-shaped room behind the pane, so the room has real
// depth and shifts with parallax as the camera moves, all on one flat quad per window.
//
// Each room gets its own distemper wall colour and floor (pastel walls, red-oxide or mosaic floors), a
// steel almirah, a calendar or a garlanded photo, a sofa or a bed, a tube light and a ceiling fan. At
// night its light comes on with its batch of windows (the same thresholds as the glow_win materials),
// in that household's kind of light: a warm bulb, a cool tube light. In some rooms someone walks across
// now and then; in the TV rooms (glow_tv) the light is the TV's, flickering with the scene cuts, and
// someone sits watching with their back to the window. By day the rooms are dim, lit only from the
// window, behind the glass's own reflections. The rooms of glass_dark windows stay dark: nobody's home.
//
// The rooms come from the `room` markers at each pane in the street model (extras: w, h, nx, ny, kind).
// A few balcony doors are lit from within by a lamp of their own (extras: lamp, a colour, and gain): a warm
// yellow room with cream walls and a bulb, whose light also spills out over the balcony (world.js).
//
// In a power cut (uPower < 1) the lights and TVs go off, except in the one flat with an inverter (uInv), and
// over the next few seconds (uCut: time since the cut) a candle is lit in some homes and a phone torch goes
// round others, its pool of light sliding over the walls, until someone finds a candle there too.
import * as THREE from 'three';

// lamp colour (sRGB) and strength for each batch of windows (glow_win1..6), as in the street model's window glass
const LAMPS = [['#ffc77a', 0.95], ['#f4f6ff', 1.1], ['#ff9f45', 0.75], ['#ffe6b0', 1.25], ['#ffb866', 0.65], ['#eef4ff', 1.0]];

export function makeRooms(parent) {
  const uniforms = {
    uTime: { value: 0 }, uLvl: { value: 0 }, uDay: { value: 1 }, uPower: { value: 1 }, uCut: { value: 0 }, uInv: { value: -1 },
    uLamp: { value: LAMPS.map(([c, k]) => { const v = new THREE.Color(c); return new THREE.Vector4(v.r, v.g, v.b, k); }) },
  };
  // dark glass with the sky in it; the room is added as emitted light from behind the pane
  const mat = new THREE.MeshStandardMaterial({ color: '#1f2a33', roughness: 0.07, metalness: 0 });
  mat.name = 'room_glass';
  mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRoom, aLamp; attribute vec2 aRoomUv;
        varying vec4 vRoom, vLamp; varying vec2 vRUv; varying vec3 vRPos; varying vec3 vRN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vRoom = aRoom; vLamp = aLamp; vRUv = aRoomUv;
        vRPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${ROOM_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += roomColour();`);
  };

  let mesh = null;
  const tmp = new THREE.Vector3();
  function build(markers) {
    const pos = [], nrm = [], uv = [], room = [], lampA = [], idx = [];
    const lc = new THREE.Color();
    let invScore = Infinity;
    parent.updateMatrixWorld(true);
    markers.forEach((o, i) => {
      const { w, h, nx, ny, kind, lamp, gain = 0 } = o.userData;
      lc.set(lamp || '#000000');
      if (w == null) return;
      parent.worldToLocal(o.getWorldPosition(tmp));
      const N = new THREE.Vector3(nx, 0, -ny).normalize();      // Blender (x, y) -> three (x, -z)
      const T = new THREE.Vector3(N.z, 0, -N.x);                 // across the pane, left to right from outside
      const k = kind === 'glow_tv' ? 7 : kind === 'glass_dark' ? 0 : +(String(kind).match(/glow_win(\d)/)?.[1] || 0);
      const seed = (i * 0.6180339 + 0.137) % 1 * 97.0;
      const base = pos.length / 3;
      for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        pos.push(tmp.x + T.x * (a - 0.5) * w, tmp.y + (b - 0.5) * h, tmp.z + T.z * (a - 0.5) * w);
        nrm.push(N.x, N.y, N.z);
        uv.push(a, b);
        room.push(w, h, seed, k);
        lampA.push(lc.r, lc.g, lc.b, lamp ? gain : 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // the flat with the inverter: a TV room on the front, as near the middle of the street as there is
      if (kind === 'glow_tv' && N.z > 0.7) {
        const score = Math.abs(tmp.x) + Math.abs(tmp.y - 3.4);
        if (score < invScore) { invScore = score; uniforms.uInv.value = seed; }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aRoomUv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRoom', new THREE.Float32BufferAttribute(room, 4));
    g.setAttribute('aLamp', new THREE.Float32BufferAttribute(lampA, 4));
    g.setIndex(idx);
    mesh = new THREE.Mesh(g, mat);
    mesh.name = 'rooms';
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  return {
    build, material: mat,
    get mesh() { return mesh; },
    /** lvl: how far into the evening the windows are (as for the glow_win batches); day: daylight 0..1;
     *  power: the mains, 0..1; cut: seconds since the power last went */
    update(t, lvl, day, power = 1, cut = 0) {
      uniforms.uTime.value = t;
      uniforms.uLvl.value = lvl;
      uniforms.uDay.value = day;
      uniforms.uPower.value = power;
      uniforms.uCut.value = cut;
    },
  };
}

const ROOM_GLSL = /* glsl */`
uniform float uTime, uLvl, uDay, uPower, uCut, uInv;
uniform vec4 uLamp[6];
varying vec4 vRoom, vLamp; varying vec2 vRUv; varying vec3 vRPos; varying vec3 vRN;

float rh(float n) { return fract(sin(n * 127.1 + 0.31) * 43758.5453); }
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
// 1 inside an axis-aligned rectangle, with a hair of antialiasing
float rect(vec2 p, vec2 lo, vec2 hi) { vec2 d = max(lo - p, p - hi); return 1.0 - smoothstep(-0.003, 0.003, max(d.x, d.y)); }
float disc(vec2 p, vec2 c, float r) { return 1.0 - smoothstep(r - 0.004, r + 0.004, length(p - c)); }
vec3 pick(float r, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec3 f) {
  return r < 0.17 ? a : r < 0.33 ? b : r < 0.5 ? c : r < 0.67 ? d : r < 0.83 ? e : f;
}

// a person seen from the front (or the back), feet at q.y = 0, 0.72 tall; returns coverage, and sets part:
// 0 legs or skirt, 1 shirt, 2 skin, 3 hair
float person(vec2 q, float saree, float stride, out float part) {
  float legs = saree > 0.5
    ? rect(q, vec2(-0.075 - 0.03 * (0.36 - q.y) / 0.36, 0.0), vec2(0.075 + 0.03 * (0.36 - q.y) / 0.36, 0.38))
    : max(rect(q, vec2(-0.065 - stride, 0.0), vec2(-0.008 - stride * 0.4, 0.38)), rect(q, vec2(0.008 + stride * 0.4, 0.0), vec2(0.065 + stride, 0.38)));
  float torso = rect(q, vec2(-0.085, 0.36), vec2(0.085, 0.58)) * (1.0 - smoothstep(0.56, 0.6, q.y) * smoothstep(0.06, 0.085, abs(q.x)));
  float arms = max(rect(q, vec2(-0.112, 0.34), vec2(-0.088, 0.57)), rect(q, vec2(0.088, 0.34), vec2(0.112, 0.57)));
  float hands = max(disc(q, vec2(-0.1, 0.33), 0.018), disc(q, vec2(0.1, 0.33), 0.018));
  float neck = rect(q, vec2(-0.02, 0.57), vec2(0.02, 0.61));
  float head = disc(q * vec2(1.0, 0.85), vec2(0.0, 0.645 * 0.85), 0.048);
  float hair = head * smoothstep(0.645, 0.665, q.y);
  part = hair > 0.5 ? 3.0 : (head + neck + hands) > 0.5 ? 2.0 : (torso + arms) > 0.5 ? 1.0 : 0.0;
  return clamp(legs + torso + arms + hands + neck + head, 0.0, 1.0);
}

vec3 roomColour() {
  float W = vRoom.x, H = vRoom.y, seed = vRoom.z, kind = vRoom.w;
  bool lit = vLamp.a > 0.0;                               // a lamp-lit room behind a balcony door
  vec3 N = normalize(vRN), U = vec3(0.0, 1.0, 0.0), T = normalize(cross(U, N));
  vec3 V = normalize(vRPos - cameraPosition);
  vec3 d = vec3(dot(V, T), dot(V, U), -dot(V, N));
  d.z = max(d.z, 0.02);
  // the room: wider than the window, the floor below the sill, the ceiling just above the lintel
  float hw = W * 0.5 + 0.14 + 0.1 * rh(seed + 1.0), yF = -0.3, yC = H + 0.1, D = 0.6 + 0.25 * rh(seed + 2.0);
  vec3 p = vec3((vRUv.x - 0.5) * W, vRUv.y * H, 0.0);
  float tx = d.x > 1e-4 ? (hw - p.x) / d.x : d.x < -1e-4 ? (-hw - p.x) / d.x : 1e5;
  float ty = d.y > 1e-4 ? (yC - p.y) / d.y : d.y < -1e-4 ? (yF - p.y) / d.y : 1e5;
  float tz = (D - p.z) / d.z;
  float t = min(tx, min(ty, tz));
  vec3 h = p + d * t;

  // this household
  vec3 wall = lin(pick(rh(seed + 3.0), vec3(0.64, 0.84, 0.76), vec3(0.6, 0.76, 0.9), vec3(0.9, 0.7, 0.75),
                       vec3(0.92, 0.86, 0.58), vec3(0.75, 0.69, 0.87), vec3(0.92, 0.88, 0.78)));
  if (lit) wall = lin(mix(vec3(0.96, 0.88, 0.66), vec3(0.97, 0.8, 0.62), rh(seed + 3.0)));   // cream or peach distemper
  float fr = rh(seed + 4.0);
  vec3 floorC = lin(fr < 0.35 ? vec3(0.55, 0.24, 0.18) : fr < 0.7 ? vec3(0.62, 0.6, 0.56) : vec3(0.84, 0.82, 0.78));
  vec3 cloth = lin(pick(rh(seed + 5.0), vec3(0.62, 0.16, 0.2), vec3(0.2, 0.32, 0.6), vec3(0.75, 0.55, 0.2),
                        vec3(0.3, 0.5, 0.35), vec3(0.55, 0.3, 0.55), vec3(0.4, 0.25, 0.18)));
  float tvSide = rh(seed + 6.0) < 0.5 ? -1.0 : 1.0;
  bool tv = !lit && (kind > 6.5 || (kind > 0.5 && rh(seed + 7.0) < 0.3));
  float tvZ = D * (0.3 + 0.25 * rh(seed + 8.0));

  // surfaces
  vec3 c; vec3 ns; float edge;
  bool onTv = false;
  if (t == tz) {                                          // the back wall
    ns = vec3(0.0, 0.0, -1.0);
    edge = min(hw - abs(h.x), min(h.y - yF, yC - h.y));
    c = wall;
    vec2 q = h.xy;
    float ax = (rh(seed + 9.0) - 0.5) * max(W - 0.3, 0.1);
    float alm = rect(q, vec2(ax - 0.17, yF), vec2(ax + 0.17, yF + 0.82));                 // the steel almirah
    c = mix(c, lin(vec3(0.42, 0.47, 0.52)) * (1.0 - 0.5 * rect(q, vec2(ax - 0.003, yF + 0.05), vec2(ax + 0.003, yF + 0.8))), alm);
    float sx = ax > 0.0 ? ax - 0.52 : ax + 0.52;                                          // sofa or bed beside it
    float sofa = rect(q, vec2(sx - 0.28, yF), vec2(sx + 0.28, yF + 0.2)) + rect(q, vec2(sx - 0.28, yF + 0.2), vec2(sx + 0.28, yF + 0.32)) * 0.85;
    c = mix(c, cloth * (q.y > yF + 0.2 ? 0.8 : 1.0), clamp(sofa, 0.0, 1.0));
    vec2 pc = vec2(ax > 0.0 ? ax - 0.42 : ax + 0.42, H * 0.72);                          // a garlanded photo, or the calendar
    if (rh(seed + 10.0) < 0.5) {
      c = mix(c, lin(vec3(0.25, 0.15, 0.08)), rect(q, pc - vec2(0.07, 0.09), pc + vec2(0.07, 0.09)));
      c = mix(c, lin(vec3(0.85, 0.55, 0.25)), rect(q, pc - vec2(0.055, 0.075), pc + vec2(0.055, 0.075)));
      float gx = (q.x - pc.x) / 0.075, gy = pc.y - 0.02 - 0.07 * (1.0 - gx * gx);
      c = mix(c, lin(vec3(1.0, 0.55, 0.05)), step(abs(gx), 1.0) * (1.0 - smoothstep(0.008, 0.014, abs(q.y - gy))));
    } else {
      c = mix(c, lin(vec3(0.95, 0.94, 0.9)), rect(q, pc - vec2(0.06, 0.09), pc + vec2(0.06, 0.09)));
      c = mix(c, lin(vec3(0.8, 0.15, 0.12)), rect(q, pc + vec2(-0.06, 0.04), pc + vec2(0.06, 0.09)));
    }
    if (!lit) c = mix(c, vec3(1.6), rect(q, vec2(-0.22, yC - 0.07), vec2(0.22, yC - 0.045)) * 0.9); // the tube light
  } else if (t == tx) {                                   // a side wall: (depth, height)
    ns = vec3(-sign(d.x), 0.0, 0.0);
    edge = min(D - h.z, min(h.y - yF, yC - h.y));
    c = wall * 0.93;
    vec2 q = h.zy;
    if (tv && sign(h.x) == tvSide) {
      float frame = rect(q, vec2(tvZ - 0.17, yF + 0.36), vec2(tvZ + 0.17, yF + 0.56));
      c = mix(c, vec3(0.01), frame);
      c = mix(c, lin(vec3(0.35, 0.22, 0.12)), rect(q, vec2(tvZ - 0.25, yF), vec2(tvZ + 0.25, yF + 0.28))); // the TV table
      onTv = rect(q, vec2(tvZ - 0.155, yF + 0.375), vec2(tvZ + 0.155, yF + 0.545)) > 0.5;
    }
    // a switchboard by the door
    c = mix(c, vec3(0.85), rect(q, vec2(0.12, yF + 0.45), vec2(0.2, yF + 0.53)));
  } else if (h.y < 0.5 * (yF + yC)) {                    // the floor
    ns = vec3(0.0, 1.0, 0.0);
    edge = min(hw - abs(h.x), D - h.z);
    float tile = step(0.5, fract(h.x * 4.0)) == step(0.5, fract(h.z * 4.0)) ? 1.0 : 0.93;
    c = floorC * tile;
    c = mix(c, cloth * 0.7, rect(h.xz, vec2(-0.3, D * 0.35), vec2(0.3, D * 0.75)) * step(0.5, rh(seed + 11.0))); // a durrie
  } else {                                                 // the ceiling, and its fan
    ns = vec3(0.0, -1.0, 0.0);
    edge = min(hw - abs(h.x), D - h.z);
    c = vec3(0.85);
    vec2 q = h.xz - vec2(0.0, D * 0.5);
    float a = atan(q.y, q.x) - uTime * 9.0, r = length(q);
    float da = abs(fract(a / 2.0944 + 0.5) - 0.5) * 2.0944;           // angle to the nearest of three blades
    float blade = (1.0 - smoothstep(0.022, 0.032, da * r)) * step(0.04, r) * (1.0 - step(0.3, r));
    c = mix(c, lin(vec3(0.35, 0.3, 0.26)), max(blade, disc(q, vec2(0.0), 0.04)));
  }
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.16, edge)) * (t == tz ? 1.0 : t == tx ? 0.7 : ns.y > 0.5 ? 0.85 : 0.95);

  // light: the room's lamp (by batch) once its batch is on, the TV, or just daylight through the window
  float on = 0.0; vec3 lamp = vec3(0.0);
  if (kind > 0.5 && kind < 6.5) {
    int b = int(kind + 0.5) - 1;
    on = clamp((uLvl - (0.46 + float(b) * 0.08)) * 8.0, 0.0, 1.0);
    lamp = lit ? vLamp.rgb * vLamp.a : uLamp[b].rgb * uLamp[b].a;
  }
  float tvOn = tv ? clamp((uLvl - 0.6) * 8.0, 0.0, 1.0) : 0.0;
  if (kind > 6.5) { lamp = lin(vec3(1.0, 0.8, 0.55)) * 0.15; on = tvOn; }   // a TV room: just a dim bulb left on
  // a power cut: the mains go, except in the flat with the inverter
  // (each home on its own threshold, so as the mains come back they come on one by one, and a flicker
  // catches some and not others)
  float pw = abs(seed - uInv) < 0.01 || uPower > 0.99 ? 1.0 : step(0.15 + 0.8 * rh(seed + 40.0), uPower);
  on *= pw; tvOn *= pw;
  // and in the dark a candle is lit in some homes; in others a phone torch goes round first
  float cdl = 0.0, trc = 0.0;
  if (kind > 0.5 && pw < 0.99) {
    float r = rh(seed + 31.0), t1 = 1.0 + 5.0 * rh(seed + 33.0);
    if (r < 0.45) cdl = smoothstep(0.0, 1.2, uCut - 2.5 - 12.0 * rh(seed + 32.0));
    else if (r < 0.75) {
      trc = smoothstep(0.0, 0.3, uCut - t1) * (1.0 - smoothstep(0.0, 0.5, uCut - t1 - 9.0));
      cdl = smoothstep(0.0, 1.2, uCut - t1 - 9.3);
    }
    cdl *= 1.0 - pw; trc *= 1.0 - pw;
  }
  vec3 Lc = vec3((rh(seed + 34.0) - 0.5) * W * 0.9, yF + 0.36, D * (0.35 + 0.3 * rh(seed + 35.0)));   // on a table
  float fl = 0.8 + 0.12 * sin(uTime * 11.0 + seed) + 0.08 * sin(uTime * 23.0 + seed * 3.0);
  vec3 candleC = lin(vec3(1.0, 0.6, 0.28));
  vec3 Lp = vec3(0.0, yC - 0.03, D * 0.55);                 // the tube light / bulb, high in the room
  if (lit) Lp = vec3(0.2 * (rh(seed + 20.0) - 0.5), yC - 0.12, D * 0.45);   // a bare bulb, a little lower
  float fall = 1.0 / (1.0 + (lit ? 6.0 : 3.0) * dot(h - Lp, h - Lp));
  vec3 light = lamp * on * (lit ? 0.12 + 1.35 * fall : 0.17 + 0.7 * fall);
  // the TV: scene cuts every second or two, each its own colour and brightness, with a little shimmer
  float cut = floor(uTime * (0.5 + 0.4 * rh(seed + 12.0)) + seed);
  vec3 tvc = lin(vec3(0.45 + 0.55 * rh(cut), 0.45 + 0.55 * rh(cut + 1.7), 0.55 + 0.45 * rh(cut + 3.1))) * (0.6 + 0.4 * rh(cut + 5.3))
           * (0.9 + 0.1 * sin(uTime * 23.0 + seed) * sin(uTime * 7.0));
  vec3 tvPos = vec3(tvSide * hw, yF + 0.46, tvZ);
  float tvFall = 1.0 / (1.0 + 4.0 * dot(h - tvPos, h - tvPos));
  light += tvc * tvOn * 0.9 * tvFall * max(0.2, dot(ns, normalize(tvPos - h)) * 0.5 + 0.5);
  // daylight from the window: brightest near it, fading back into the room
  light += uDay * vec3(0.9, 0.95, 1.0) * (0.07 + 0.2 * exp(-h.z * 2.2)) * (ns.y > 0.5 ? 1.2 : 1.0);
  // the candle, low on a table, flickering
  light += candleC * cdl * fl * (0.05 + 0.75 / (1.0 + 14.0 * dot(h - Lc, h - Lc)));
  // the phone torch: held by someone wandering about, its beam sliding over the walls
  if (trc > 0.0) {
    vec3 To = vec3(0.25 * sin(uTime * 0.31 + seed), yF + 0.55, 0.3);
    vec3 Ta = vec3(hw * 0.85 * sin(uTime * 0.9 + seed * 1.7), yF + 0.25 + 0.3 * sin(uTime * 0.53 + seed), D);
    vec3 tl = h - To; float tlen = length(tl);
    float cone = smoothstep(0.94, 0.985, dot(tl / tlen, normalize(Ta - To)));
    light += lin(vec3(0.92, 0.95, 1.0)) * trc * (0.05 + 1.6 * cone / (1.0 + 3.0 * tlen * tlen));
  }
  vec3 col = c * light * ao;
  if (onTv) col = tvc * tvOn * 1.6 + vec3(0.003);

  // someone in the room: walking across now and then, or sitting watching the TV with their back to us
  if (on > 0.01 || tvOn > 0.01 || uDay > 0.25 || cdl > 0.01 || trc > 0.01) {
    float part;
    vec3 skin = lin(vec3(0.55, 0.37, 0.26)), hairC = vec3(0.012);
    vec3 shirt = lin(pick(rh(seed + 13.0), vec3(0.9, 0.9, 0.88), vec3(0.3, 0.45, 0.75), vec3(0.75, 0.3, 0.3),
                          vec3(0.95, 0.75, 0.3), vec3(0.4, 0.65, 0.5), vec3(0.85, 0.45, 0.65)));
    if (kind > 6.5 || (tv && rh(seed + 14.0) < 0.5)) {
      float zs = 0.22;                                    // a viewer on a chair by the window, facing the TV
      float ts = (zs - p.z) / d.z;
      vec3 hs = p + d * ts;
      vec2 q = vec2(hs.x + tvSide * 0.15, hs.y - yF);
      float body = max(rect(q, vec2(-0.1, 0.22), vec2(0.1, 0.42)) * (1.0 - smoothstep(0.38, 0.43, q.y) * smoothstep(0.07, 0.1, abs(q.x))),
                       disc(q * vec2(1.0, 0.85), vec2(0.0, 0.48 * 0.85), 0.05));
      if (ts < t && body > 0.5) {
        vec3 rim = tvc * tvOn * 0.35 + lamp * on * 0.25 + candleC * cdl * 0.2;
        col = (q.y > 0.43 ? hairC : shirt * 0.5) * (rim + 0.02);
      }
    }
    if (kind < 6.5 && rh(seed + 15.0) < 0.7) {
      float zc = 0.22 + 0.22 * rh(seed + 16.0);
      float tc = (zc - p.z) / d.z;
      vec3 hc = p + d * tc;
      // stands somewhere a while, then walks over to somewhere else
      float per = 7.0 + 6.0 * rh(seed + 17.0), ph = uTime / per + rh(seed + 18.0) * 10.0, k = fract(ph), n = floor(ph);
      float span = hw - 0.15;
      float xa = (rh(n + seed) * 2.0 - 1.0) * span, xb = (rh(n + 1.0 + seed) * 2.0 - 1.0) * span;
      float wk = smoothstep(0.7, 1.0, k);
      float px = mix(xa, xb, wk);
      float moving = step(0.7, k) * step(k, 0.99);
      float stride = moving * 0.03 * sin(uTime * 9.0);
      vec2 q = vec2(hc.x - px, hc.y - yF - moving * 0.006 * abs(sin(uTime * 9.0)));
      float cov = person(q, step(0.5, rh(seed + 19.0)), stride, part);
      if (tc < t && cov > 0.5) {
        vec3 pc = part > 2.5 ? hairC : part > 1.5 ? skin : part > 0.5 ? shirt : (rh(seed + 19.0) > 0.5 ? shirt * 0.85 : lin(vec3(0.15, 0.17, 0.22)));
        // lit mostly from behind by the room's light, so they read darker than the wall: a figure against the light
        col = pc * (lamp * on * 0.3 + tvc * tvOn * 0.25 + uDay * 0.07 + candleC * cdl * 0.2 + trc * 0.12) * (0.7 + 0.3 * smoothstep(0.0, 0.7, q.y));
      }
    }
  }
  // the candle's flame itself, where the view passes close by it
  if (cdl > 0.01) {
    float tf = dot(Lc - p, d) / dot(d, d);
    vec3 dq = (p + d * tf - Lc) * vec3(1.0, 0.5, 1.0);
    if (tf > 0.0 && tf < t) col += lin(vec3(1.0, 0.75, 0.4)) * cdl * fl * 3.0 * (1.0 - smoothstep(0.004, 0.012, length(dq)));
  }
  if (lit) {
    // a cotton curtain gathered to one side of the door, glowing with the lamp behind it
    float side = rh(seed + 21.0) < 0.5 ? -1.0 : 1.0;
    float u = (vRUv.x - 0.5) * side - (0.5 - 0.24 - 0.1 * rh(seed + 22.0));
    if (u > 0.0) {
      float fold = 0.5 + 0.5 * sin(u * W * 70.0 + 1.3 * sin(vRUv.y * 5.0));
      vec3 cc = lin(pick(rh(seed + 23.0), vec3(0.95, 0.78, 0.45), vec3(0.9, 0.55, 0.4), vec3(0.95, 0.9, 0.75),
                         vec3(0.85, 0.6, 0.55), vec3(0.95, 0.75, 0.5), vec3(0.8, 0.82, 0.6)));
      col = cc * (lamp * on * (0.28 + 0.3 * fold) * (0.75 + 0.25 * vRUv.y) + uDay * 0.12 * (0.7 + 0.3 * fold));
    }
    // the door's two leaves: a stile down the middle and a glazing bar across, dark against the light
    float bar = max(1.0 - smoothstep(0.009, 0.013, abs(vRUv.x - 0.5) * W), 1.0 - smoothstep(0.006, 0.01, abs(vRUv.y - 0.5) * H));
    col = mix(col, lin(vec3(0.2, 0.12, 0.07)) * (0.02 + 0.3 * uDay), bar);
  }
  return col;
}
`;
