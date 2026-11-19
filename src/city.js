// Mumbai beyond the block: the rest of the city, all around it at street level, so the corner is one
// stretch of a longer street. The road and the side lane carry on out of the block, with footpaths and
// their yellow-and-black kerbs; chawls line the street on both sides of a narrow gali either side of the
// block and stand behind it; across the road, low shops, and an open walled maidan straight in front so the
// view of the street stays clear. Beyond, a carpet of chawls and blue-tarp roofs with water tanks and coconut palms, a temple's
// shikhara and a mosque's dome; further out, mid-rises; on the horizon, towers and two cranes. To the west the Arabian Sea, with the Queen's Necklace of streetlights along the curve of the
// bay at night. Everything fades into the humid haze (thicker in the rain) and its windows light up as
// evening comes; monsoon clouds drift over, darker and heavier in a storm.
//
// It's all drawn in a few instanced batches with one shader: the haze (by distance, and a ground mist)
// and the windows are worked out per pixel, and anything that would come between the camera and the
// street dissolves out of the way.
import * as THREE from 'three';

const GY = 0;                                      // the city's ground: street level, like the block's
const BLOCK = { x0: -7.72, x1: 7.72, z0: -5.87, z1: 5.57 }; // the block's footprint (the street model's cut), left open in the ground
const coastX = (z) => -34 + 5 * Math.sin(z * 0.045) + 3 * Math.sin(z * 0.11 + 1);  // the shore of the bay

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function vnoise(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (h(i, j) * (1 - ux) + h(i + 1, j) * ux) * (1 - uz) + (h(i, j + 1) * (1 - ux) + h(i + 1, j + 1) * ux) * uz;
}

export function makeCity(scene) {
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);
  const U = {
    uNight: { value: 0 }, uTime: { value: 0 }, uHazeLen: { value: 22 }, uHaze: { value: new THREE.Color('#dceef6') }, uHazeNear: { value: new THREE.Color('#c9c4b8') },
    uCam: { value: new THREE.Vector3() }, uTarget: { value: new THREE.Vector3() }, uWet: { value: 0 },
  };
  const rand = mulberry(20260611);
  const R = (a, b) => a + rand() * (b - a);

  // ---------------------------------------------------------------- the shared look: haze, windows, roofs
  function cityMat(color, defs = {}, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, fog: false, ...extra });
    m.defines = { ...defs };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCP; varying vec3 vCN; varying vec3 vLM; varying vec3 vLN; varying vec4 vCI;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef USE_INSTANCING
            mat4 cIM = instanceMatrix;
          #else
            mat4 cIM = mat4(1.0);
          #endif
          vCP = (modelMatrix * cIM * vec4(transformed, 1.0)).xyz;
          vCN = normalize(mat3(modelMatrix) * mat3(cIM) * objectNormal);
          vec3 sc = vec3(length(cIM[0].xyz), length(cIM[1].xyz), length(cIM[2].xyz));
          vLM = transformed * sc; vLN = objectNormal;
          vec3 io = (cIM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vCI = vec4(io.x, io.z, sc.y, fract(sin(dot(io.xz, vec2(12.9898, 78.233))) * 43758.5453));`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight, uTime, uHazeLen, uWet; uniform vec3 uHaze, uHazeNear, uCam, uTarget;
          varying vec3 vCP; varying vec3 vCN; varying vec3 vLM; varying vec3 vLN; varying vec4 vCI;
          float cHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          vec3 cityLit = vec3(0.0);`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          // out of the way: anything between the camera and the street dissolves
          {
            vec3 L = uTarget - uCam; float Ll = length(L); vec3 Ld = L / Ll;
            vec3 v = vCP - uCam; float tt = dot(v, Ld);
            float perp = length(v - Ld * tt);
            float block = step(0.0, tt) * step(tt, Ll + 3.0) * (1.0 - smoothstep(5.0, 10.0, perp));
            #ifndef CITY_GROUND
            if (block > 0.0 && cHash(gl_FragCoord.xy) < block) discard;
            #endif
          }
          #ifdef CITY_SEA
            if (vCP.x > -34.0 + 5.0 * sin(vCP.z * 0.045) + 3.0 * sin(vCP.z * 0.11 + 1.0)) discard;
          #endif
          #ifdef CITY_LAND
            if (vCP.x < -34.0 + 5.0 * sin(vCP.z * 0.045) + 3.0 * sin(vCP.z * 0.11 + 1.0)) discard;
            if (vCP.x > ${BLOCK.x0} && vCP.x < ${BLOCK.x1} && vCP.z > ${BLOCK.z0} && vCP.z < ${BLOCK.z1}) discard; // the block itself
          #endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          #ifdef CITY_STREETS
          {
            // the road and the side lane carried on out of the block: asphalt, the centre dashes, the gravel
            // margin; a dusty maidan across the road; dust and stone everywhere else
            float x = vCP.x, z = vCP.z;
            float road = step(1.27, z) * step(z, 5.25), edge = step(5.25, z) * step(z, 5.55);
            float lane = step(3.6, x) * step(x, 5.6) * step(z, 0.0);
            float maidan = step(abs(x), 11.0) * step(7.1, z) * step(z, 14.0);
            vec3 c = mix(vec3(0.24, 0.22, 0.2), vec3(0.31, 0.24, 0.16), maidan);
            c = mix(c, vec3(0.15, 0.16, 0.18), max(road, lane));
            c = mix(c, vec3(0.15, 0.145, 0.135), edge);
            float dash = road * (1.0 - step(0.04, abs(z - 3.25))) * step(fract((x + 7.2) / 1.4), 0.5);
            c = mix(c, vec3(0.78, 0.76, 0.7), dash);
            diffuseColor.rgb = c;
          }
          #endif
          #ifdef CITY_KERB
            diffuseColor.rgb = vLN.y > 0.5 || abs(vLN.z) > 0.5 ? (fract(vCP.x / 0.8) < 0.5 ? vec3(0.89, 0.6, 0.03) : vec3(0.012)) : diffuseColor.rgb;
          #endif
          #ifdef CITY_GROUND
            diffuseColor.rgb *= 1.0 - 0.4 * uWet;   // wet streets go dark
          #endif
          #ifdef CITY_BLOCKS
          {
            float h = vCI.z, id = vCI.w;
            if (vLN.y > 0.5) {
              // roofs: tarpaulin blue, rusty tin or grey on the shanties; weathered concrete on the rest
              diffuseColor.rgb = h < 1.7 ? (id < 0.45 ? vec3(0.06, 0.16, 0.5) : id < 0.7 ? vec3(0.3, 0.12, 0.05) : vec3(0.2, 0.2, 0.21))
                                         : vec3(0.28, 0.27, 0.25) * (0.85 + 0.3 * id);
            } else if (h > 1.7) {
              // windows in rows a storey apart (each building its own rhythm): dark glass by day; at night a
              // share of them lit, each its own colour. Monsoon streaks down the walls, a band at every floor.
              vec2 fc = abs(vLN.x) > 0.5 ? vec2(vLM.z, vLM.y) : vec2(vLM.x, vLM.y);
              float cw = 0.55 + 0.35 * fract(id * 7.3);
              vec2 cell = vec2(fc.x / cw, fc.y / 1.3), f = fract(cell), ci = floor(cell);
              float ww = 0.18 + 0.12 * fract(id * 3.1);
              float win = step(ww, f.x) * step(f.x, 1.0 - ww) * step(0.3, f.y) * step(f.y, 0.76) * step(0.9, fc.y) * step(fc.y, h - 0.35);
              float streak = cHash(vec2(floor(fc.x * 3.0), id)) * smoothstep(0.0, 1.0, fract(-fc.y / 1.3 + 0.2));
              diffuseColor.rgb *= (0.86 + 0.14 * cHash(vec2(ci.y, id))) * (1.0 - 0.28 * streak * step(0.5, fract(id * 5.7)));
              diffuseColor.rgb *= 1.0 - 0.18 * step(0.94, fract(fc.y / 1.3));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.035, 0.045), win * 0.55);
              float r = cHash(ci + id * 37.0);
              float on = step(r, 0.24 + 0.08 * sin(uTime * 0.03 + id * 20.0 + ci.y));
              vec3 wc = r < 0.1 ? vec3(1.0, 0.82, 0.5) : r < 0.2 ? vec3(0.85, 0.92, 1.0) : vec3(1.0, 0.62, 0.32);
              cityLit = wc * win * on * uNight * 1.3;
            }
            diffuseColor.rgb *= 0.75 + 0.25 * smoothstep(0.0, 2.5, vLM.y);   // grime low down
          }
          #endif`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          {
            // the haze: thicker with distance, and a mist lying low over the city
            float dd = length(vCP.xz);
            float hk = 1.0 - exp(-max(dd - 9.0, 0.0) / uHazeLen);
            hk = mix(hk, 1.0, exp(-max(vCP.y - (${GY.toFixed(1)}), 0.0) / 3.0) * 0.6 * smoothstep(16.0, 45.0, dd));
            hk = clamp(hk, 0.0, 0.985);
            // a warm grey city haze close in, melting into the sky's own colour towards the horizon
            vec3 hz = mix(uHazeNear, uHaze, smoothstep(45.0, 125.0, dd));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, hk) + cityLit * (1.0 - hk * 0.75);
          }`);
    };
    return m;
  }

  // ---------------------------------------------------------------- the buildings
  const pal = ['#d2c4a6', '#bfae92', '#93aa9f', '#cfa58f', '#d8c67c', '#8fa8ba', '#aba398', '#bb977a', '#dcd6c6', '#a5bb9d', '#c98f7e', '#7f9a8c'];
  const blocks = [], rows = [], huts = [], tanks = [], palms = [], towers = [];
  const addTanks = (x, z, w, d, h) => {
    if (h > 2.5 && h < 16 && rand() < 0.7) for (let k = 0, n = 1 + Math.floor(rand() * 2); k < n; k++) tanks.push({ x: x + R(-w, w) * 0.3, z: z + R(-d, d) * 0.3, y: GY + h });
  };
  const plot = (x, z, w, d, h, kind) => {
    if (x < coastX(z) + 2) return;
    const yaw = Math.round(rand() * 3) * 0.04 + (vnoise(x * 0.02, z * 0.02) - 0.5) * 0.5;
    (kind === 'hut' ? huts : blocks).push({ x, z, w, d, h, yaw, c: pal[Math.floor(rand() * pal.length)] });
    if (kind !== 'hut') addTanks(x, z, w, d, h);
    if (kind === 'tower') towers.push({ x, z, h, w, d });
  };
  // a row of buildings shoulder to shoulder along a street line, square to it, with a gali now and then
  const row = (xa, xb, zFront, dir, dmin, dmax, floors, skip = () => false) => {
    const s = Math.sign(xb - xa);
    for (let x = xa; (xb - x) * s > 0;) {
      const w = R(2.4, 4.2);
      if (x < coastX(zFront) + 3 && s < 0) break;
      if (!skip(x + s * w / 2)) {
        const d = R(dmin, dmax), h = 1.3 * Math.floor(R(floors[0], floors[1] + 1)) + R(0.3, 0.6);
        const cx = x + s * w / 2, cz = zFront + dir * d / 2;
        rows.push({ x: cx, z: cz, w: w - 0.08, d, h, yaw: 0, c: pal[Math.floor(rand() * pal.length)] });
        addTanks(cx, cz, w, d, h);
      }
      x += s * (w + (rand() < 0.14 ? R(1.0, 1.8) : 0));
    }
  };
  const inLane = (x) => x > 2.9 && x < 6.3;
  row(9.0, 112, 0.0, -1, 4.8, 5.8, [2, 4]);                  // our side of the street, to the east...
  row(-9.0, -60, 0.0, -1, 4.8, 5.8, [2, 4]);                 // ...and to the west
  row(-24, 24, -6.6, -1, 4.0, 6.0, [2, 3], inLane);          // behind the block, either side of the lane
  row(11.0, 112, 6.9, 1, 3.6, 5.0, [1, 3]);                  // across the road: low shops and chawls
  row(-11.0, -60, 6.9, 1, 3.6, 5.0, [1, 3]);
  for (let gx = -130; gx <= 130; gx += 3.4) {
    for (let gz = -130; gz <= 130; gz += 3.4) {
      const x = gx + R(-0.9, 0.9), z = gz + R(-0.9, 0.9), r = Math.hypot(x, z);
      if (r < 15 || r > 136) continue;
      if (z > -14 && z < 14 && Math.abs(x) < 26) continue;   // the block's own neighbourhood (the rows above)
      if (z > -9 && z < 14) continue;                         // the street's rows, all the way along
      if (inLane(x) && z < -5) continue;                      // the lane, carrying on back
      if (r < 56) { // the near carpet: chawls, and here and there a patch of shanties
        if (vnoise(x * 0.07 + 3, z * 0.07) > 0.56) {
          for (let k = 0; k < 4; k++) plot(x + R(-1.2, 1.2), z + R(-1.2, 1.2), R(0.8, 1.5), R(0.8, 1.4), R(0.6, 1.4), 'hut');
          if (rand() < 0.25) palms.push({ x: x + R(-1, 1), z: z + R(-1, 1), h: R(2.8, 4.2) });
        } else if (rand() < 0.88) {
          plot(x, z, R(2.0, 2.9), R(1.9, 2.8), 1.3 * Math.floor(R(2, 4)) + R(0.2, 0.5) + (r > 34 ? 1.3 : 0), 'chawl');
          if (rand() < 0.08) palms.push({ x: x + R(-1.6, 1.6), z: z + R(-1.6, 1.6), h: R(3, 4.5) });
        }
      } else if (r < 92) { // mid-rises
        if ((Math.round(gx / 3.4) + Math.round(gz / 3.4)) % 2 && rand() < 0.7) plot(x, z, R(2.8, 4.2), R(2.6, 4.0), 1.3 * Math.floor(R(3, 7)) + 0.4, 'mid');
      } else if ((Math.round(gx / 3.4) % 2) && (Math.round(gz / 3.4) % 2) && rand() < 0.8) { // towers on the horizon
        const tall = rand() < 0.45;
        plot(x, z, R(3.6, 5.6), R(3.4, 5.2), tall ? R(26, 64) : 1.3 * Math.floor(R(7, 13)), tall ? 'tower' : 'mid');
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function instanced(geo, mat, list, place, colorOf) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => { place(o); im.setMatrixAt(i, m4.compose(v3, q, s3)); if (colorOf) im.setColorAt(i, new THREE.Color(colorOf(o))); });
    im.frustumCulled = false;
    group.add(im);
    return im;
  }
  const blockMat = cityMat('#ffffff', { CITY_BLOCKS: 1 });
  const putBox = (o) => { v3.set(o.x, GY, o.z); q.setFromAxisAngle(up, o.yaw); s3.set(o.w, o.h, o.d); };
  instanced(box, blockMat, blocks.concat(huts), putBox, (o) => o.c);
  const rowMesh = instanced(box, blockMat, rows, putBox, (o) => o.c);
  rowMesh.castShadow = true; rowMesh.receiveShadow = true;   // the neighbours shade the street, as they would
  // footpaths with their kerbs, along both sides of the road, out from the block's ends
  const pathMat = cityMat('#b8b0a2', { CITY_GROUND: 1 }), kerbMat = cityMat('#ffffff', { CITY_KERB: 1, CITY_GROUND: 1 });
  const slab = (x0, x1, z0, z1, h, m) => { const o = new THREE.Mesh(box, m); o.position.set((x0 + x1) / 2, GY, (z0 + z1) / 2); o.scale.set(x1 - x0, h, z1 - z0); o.receiveShadow = true; group.add(o); return o; };
  const west = coastX(0) + 2;
  for (const [x0, x1] of [[BLOCK.x1, 120], [west, BLOCK.x0]]) {
    slab(x0, x1, 0.0, 1.15, 0.135, pathMat);
    slab(x0, x1, 1.15, 1.27, 0.165, kerbMat);
  }
  slab(west, 120, 5.55, 6.9, 0.135, pathMat);                  // the far footpath, across the road
  slab(west, 120, 5.55, 5.67, 0.165, kerbMat);
  slab(-11, 11, 6.92, 7.08, 0.5, cityMat('#e4ded1'));           // the maidan's whitewashed wall
  instanced(new THREE.CylinderGeometry(0.32, 0.34, 0.5, 10).translate(0, 0.25, 0), cityMat('#1d1e20'), tanks,
    (o) => { v3.set(o.x, o.y, o.z); q.identity(); s3.set(1, 1, 1); });

  // coconut palms: a leaning trunk and a crown of drooping fronds
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.12, 1, 6).translate(0, 0.5, 0);
  const crownGeo = (() => {
    const pos = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), px = -s, pz = c;
      const tip = [c * 1.5, -0.7, s * 1.5], mid = [c * 0.8, 0.12, s * 0.8];
      pos.push(0, 0, 0, mid[0] + px * 0.22, mid[1], mid[2] + pz * 0.22, mid[0] - px * 0.22, mid[1], mid[2] - pz * 0.22);
      pos.push(mid[0] + px * 0.22, mid[1], mid[2] + pz * 0.22, ...tip, mid[0] - px * 0.22, mid[1], mid[2] - pz * 0.22);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();
  const lean = new THREE.Vector3(1, 0, 0.3).normalize();
  instanced(trunkGeo, cityMat('#6b5a45'), palms, (o) => { v3.set(o.x, GY, o.z); q.setFromAxisAngle(lean, R(-0.12, 0.12)); s3.set(1, o.h, 1); });
  instanced(crownGeo, cityMat('#3f6b35', {}, { side: THREE.DoubleSide }), palms, (o) => { v3.set(o.x, GY + o.h, o.z); q.setFromAxisAngle(up, R(0, 6)); s3.setScalar(R(0.8, 1.1)); });

  // ---------------------------------------------------------------- landmarks: a temple, a mosque, two cranes
  function add(geo, color, x, y, z, defs) { const m = new THREE.Mesh(geo, cityMat(color, defs)); m.position.set(x, y, z); group.add(m); return m; }
  { // a temple: a stepped shikhara with its saffron flag
    const x = 9, z = -23;
    add(new THREE.BoxGeometry(3.2, 1.6, 3.2).translate(0, 0.8, 0), '#e9e1d2', x, GY, z);
    for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(1.3 - k * 0.28, 1.45 - k * 0.28, 1.0, 8).translate(0, 0.5, 0), '#efe6d6', x, GY + 1.6 + k * 0.95, z);
    add(new THREE.ConeGeometry(0.4, 1.0, 8).translate(0, 0.5, 0), '#d9b35a', x, GY + 5.4, z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4).translate(0, 0.7, 0), '#5a4a3a', x, GY + 6.2, z);
    add(new THREE.PlaneGeometry(0.7, 0.45).translate(0.36, 1.15, 0), '#f07a1a', x, GY + 6.2, z).material.side = THREE.DoubleSide;
  }
  { // a mosque: a dome on a hall, and a minaret
    const x = -16, z = -22;
    add(new THREE.BoxGeometry(4, 2.4, 3.4).translate(0, 1.2, 0), '#e4e6df', x, GY, z);
    add(new THREE.SphereGeometry(1.45, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#cfe0d6', x, GY + 2.4, z);
    add(new THREE.CylinderGeometry(0.32, 0.38, 6.5, 10).translate(0, 3.25, 0), '#e8e9e2', x + 2.6, GY, z + 1.2);
    add(new THREE.SphereGeometry(0.42, 10, 8), '#cfe0d6', x + 2.6, GY + 6.6, z + 1.2);
  }
  const cranes = [];
  const lights = []; // red aviation lights: tower tops and crane jibs
  for (const t of towers.filter((o) => o.h > 30).slice(0, 14)) lights.push(new THREE.Vector3(t.x, GY + t.h + 0.3, t.z));
  for (const t of towers.slice(0, 40).filter((o, i) => i % 9 === 3).slice(0, 2)) { // a tower going up, a crane on top
    const c = new THREE.Group();
    c.position.set(t.x + t.w * 0.2, GY + t.h, t.z);
    const yellow = cityMat('#c9a227');
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4).translate(0, 4, 0), yellow);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(12, 0.35, 0.35).translate(3.6, 8.2, 0), yellow);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8).translate(-2.2, 7.9, 0), cityMat('#6c6f72'));
    c.add(mast, jib, weight);
    c.rotation.y = R(0, 6);
    group.add(c);
    cranes.push({ c, w: R(0.02, 0.05) * (rand() < 0.5 ? 1 : -1), tip: new THREE.Vector3(9.4, 8.4, 0) });
    lights.push(null);
  }
  const red = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false, fog: false }), lights.length);
  red.frustumCulled = false;
  group.add(red);

  // ---------------------------------------------------------------- the sea, the shore, the Queen's Necklace
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2), cityMat('#3d5f70', { CITY_SEA: 1, CITY_GROUND: 1 }, { roughness: 0.22, metalness: 0.1 }));
  sea.position.set(0, GY - 0.25, 0);
  group.add(sea);
  const land = new THREE.Mesh(new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2), cityMat('#7a756d', { CITY_LAND: 1, CITY_GROUND: 1, CITY_STREETS: 1 }));
  land.position.y = GY - 0.004;
  land.receiveShadow = true;
  group.add(land);
  const necklace = [];
  for (let z = -110; z <= 110; z += 1.6) necklace.push(new THREE.Vector3(coastX(z) + 0.6, GY + 0.9, z));
  const pearls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffc46b', toneMapped: false, fog: false }), necklace.length);
  pearls.frustumCulled = false;
  group.add(pearls);

  // ---------------------------------------------------------------- monsoon clouds
  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    const r2 = mulberry(7);
    for (let k = 0; k < 26; k++) {
      const x = 40 + r2() * 176, y = 50 + r2() * 40 - (Math.abs(x - 128) < 60 ? 14 : 0), r = 18 + r2() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const clouds = [];
  for (let k = 0; k < 26; k++) {
    const a = R(0, Math.PI * 2), r = R(35, 115);
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.6 });
    const s = new THREE.Sprite(mat);
    const w = R(30, 60);
    s.scale.set(w, w * 0.42, 1);
    s.position.set(Math.cos(a) * r, R(14, 30), Math.sin(a) * r);
    s.userData.base = s.position.y;
    group.add(s);
    clouds.push(s);
  }

  const cTmp = new THREE.Color(), cTmp2 = new THREE.Color();
  return {
    group,
    /** night 0..1, rain 0..1, haze: the scene's fog colour, top: the sky's zenith colour */
    update(dt, t, night, rain, haze, top, wind, camera, target, wet = 0) {
      U.uWet.value = wet;
      U.uNight.value = THREE.MathUtils.smoothstep(night, 0.3, 0.7);
      U.uTime.value = t;
      U.uHazeLen.value = THREE.MathUtils.lerp(32, 10, rain);
      U.uHazeNear.value.copy(haze).lerp(cTmp2.set('#8f8577'), 0.22 * (1 - night)).multiplyScalar(1 - 0.08 * (1 - night));
      U.uHaze.value.copy(haze);
      U.uCam.value.copy(camera.position);
      U.uTarget.value.copy(target);
      for (const c of cranes) c.c.rotation.y += c.w * dt;
      // aviation lights blink at night; the Queen's Necklace glows along the bay
      const lit = THREE.MathUtils.smoothstep(night, 0.35, 0.65);
      let i = 0;
      for (const p of lights) {
        let pos = p;
        if (!pos) { const cr = cranes[i - (lights.length - cranes.length)]; pos = cr.c.localToWorld(v3.copy(cr.tip)); }
        const on = lit * (Math.sin(t * 2.4 + i) > 0.2 ? 1 : 0.15);
        red.setMatrixAt(i, m4.compose(pos, q.identity(), s3.setScalar(on > 0.01 ? 1 + 2 * on : 0)));
        i++;
      }
      red.instanceMatrix.needsUpdate = true;
      if (pearls.userData.lit !== lit) {
        pearls.userData.lit = lit;
        necklace.forEach((p, k) => pearls.setMatrixAt(k, m4.compose(p, q.identity(), s3.setScalar(lit > 0.01 ? lit : 0))));
        pearls.instanceMatrix.needsUpdate = true;
      }
      // clouds drift with the wind, gather and darken in the rain, take the sky's colour at dusk and night
      cTmp.set('#ffffff').lerp(cTmp2.copy(haze), 0.35 + 0.4 * night).lerp(cTmp2.set('#5d6570'), rain * 0.8 * (1 - night)).multiplyScalar(1 - 0.55 * night);
      for (const s of clouds) {
        s.position.x += (0.6 + wind * 1.5) * dt;
        if (s.position.x > 120) s.position.x -= 240;
        s.position.y = s.userData.base - rain * 6;
        s.material.color.copy(cTmp);
        s.material.opacity = (0.45 + 0.45 * rain) * (1 - 0.5 * night);
      }
    },
  };
}
