// Looks: whole-scene art styles, as one last full-screen pass over the finished frame. Each reads the
// frame and the depth and normal buffers the ambient-occlusion pass already renders (so it can find
// silhouettes and creases for outlines, and tell near from far):
//
//   real     as rendered (the default)
//   toy      a toy diorama: tilt-shift blur above and below a sharp band, candy-pastel grade, soft glow
//   ink      ink & colour: dark outlines, light in flat bands, halftone dots in the shadows, newsprint paper
//   gouache  a gouache painting: brushy flat patches (a Kuwahara filter), paper grain, soft pigment edges
//   pixel    pixel art: chunky pixels, a small dithered palette, dark outlines
//   riso     a risograph poster: fluoro pink, blue and yellow halftone inks on cream paper, slightly off register
//
// Off by default; try one with ?look=<name> in the address.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const LOOKS = [
  { id: 'real', name: 'Real' },
  { id: 'toy', name: 'Toy diorama' },
  { id: 'ink', name: 'Ink & colour' },
  { id: 'gouache', name: 'Gouache' },
  { id: 'pixel', name: 'Pixel art' },
  { id: 'riso', name: 'Riso poster' },
];

export function makeLook(gtao, camera) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null }, tNormal: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uLook: { value: 0 }, uNight: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: LOOK_GLSL,
  });
  pass.enabled = false;
  const set = (id) => {
    const i = Math.max(0, LOOKS.findIndex((l) => l.id === id));
    pass.uniforms.uLook.value = i;
    pass.enabled = i > 0;
    return LOOKS[i].id;
  };
  return {
    pass, set,
    update(t, night, w, h) {
      pass.uniforms.tDepth.value = gtao.depthTexture;
      pass.uniforms.tNormal.value = gtao.normalTexture;
      pass.uniforms.uTime.value = t;
      pass.uniforms.uNight.value = night;
      pass.uniforms.uRes.value.set(w, h);
    },
  };
}

const LOOK_GLSL = /* glsl */`
uniform sampler2D tDiffuse, tDepth, tNormal;
uniform vec2 uRes; uniform float uTime, uNear, uFar, uLook, uNight;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float depthAt(vec2 uv) { float d = texture2D(tDepth, uv).x; return (uNear * uFar) / (uFar - d * (uFar - uNear)); }
vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
// silhouettes (a jump in depth) and creases (a turn in the surface), w pixels wide
float edges(vec2 uv, float w) {
  vec2 px = w / uRes;
  float d0 = depthAt(uv); vec3 n0 = normalAt(uv);
  float de = 0.0, ne = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(px.x, 0.0) : i == 1 ? vec2(-px.x, 0.0) : i == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
    de = max(de, abs(depthAt(uv + o) - d0) / d0);
    ne = max(ne, 1.0 - dot(normalAt(uv + o), n0));
  }
  return clamp(smoothstep(0.018, 0.05, de) + smoothstep(0.3, 0.6, ne), 0.0, 1.0);
}
vec3 sat(vec3 c, float s) { return mix(vec3(lum(c)), c, s); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// a halftone screen: 1 where the dot for coverage k covers this pixel
float halftone(vec2 frag, float k, float cell, float ang) {
  vec2 p = rot(frag, ang) / cell;
  vec2 f = fract(p) - 0.5;
  return 1.0 - smoothstep(-0.06, 0.06, length(f) - sqrt(clamp(k, 0.0, 1.0)) * 0.62);
}

vec3 toy(vec2 uv) {
  // tilt-shift: sharp across the middle band, blurring above and below, like a macro shot of a model
  float b = smoothstep(0.1, 0.42, abs(uv.y - 0.47)) * 7.0;
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996, r = sqrt(float(i) / 16.0);
    vec2 o = vec2(cos(a), sin(a)) * r * b / uRes;
    acc += texture2D(tDiffuse, uv + o).rgb; wsum += 1.0;
  }
  vec3 c = acc / wsum;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; glow += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * 14.0 / uRes).rgb; }
  c = mix(c, max(c, glow / 8.0), 0.35);                       // a soft bloom round bright things
  c = sat(c, 1.35) * 1.08;
  c = c * vec3(1.04, 1.0, 0.96) + vec3(0.1, 0.06, 0.14) * (1.0 - c);  // candy: lifted lavender shadows, warm lights
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
  vec2 d = uv - 0.5;
  return c * (1.0 - dot(d, d) * 0.55);
}

vec3 ink(vec2 uv) {
  vec2 frag = uv * uRes;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float l = lum(c);
  vec3 hue = c / max(l, 0.02);
  // light in three flat bands, colour kept
  float band = l < 0.22 ? 0.16 : l < 0.48 ? 0.38 : l < 0.74 ? 0.66 : 0.92;
  band = mix(band, l, 0.12);
  vec3 col = clamp(sat(hue * band, 1.2), 0.0, 1.0);
  // halftone dots in the shadows; newsprint paper under everything
  float dots = halftone(frag, (0.42 - l) * 1.6, 5.0, 0.785);
  col = mix(col, col * 0.45, dots * step(l, 0.42));
  vec3 paper = vec3(0.96, 0.93, 0.86) * (0.95 + 0.05 * vnoise(frag * 0.35)) * (0.97 + 0.03 * hash(frag));
  col = mix(col, paper, smoothstep(0.86, 1.0, l) * 0.7) * mix(vec3(1.0), paper, 0.35);
  // ink lines, a touch wobbly
  float e = edges(uv + (vec2(vnoise(frag * 0.08), vnoise(frag * 0.08 + 7.0)) - 0.5) * 1.5 / uRes, 1.3);
  return mix(col, vec3(0.08, 0.07, 0.12), e * 0.92);
}

vec3 gouache(vec2 uv) {
  vec2 frag = uv * uRes;
  // Kuwahara: of the four squares round each pixel, take the average of the flattest; brushy flat patches
  const int R = 4;
  vec3 m[4]; vec3 s[4];
  for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
  for (int j = 0; j <= R; j++) for (int i = 0; i <= R; i++) {
    vec3 a = texture2D(tDiffuse, uv + vec2(-i, -j) / uRes).rgb; m[0] += a; s[0] += a * a;
    vec3 b = texture2D(tDiffuse, uv + vec2(i, -j) / uRes).rgb;  m[1] += b; s[1] += b * b;
    vec3 c = texture2D(tDiffuse, uv + vec2(-i, j) / uRes).rgb;  m[2] += c; s[2] += c * c;
    vec3 d = texture2D(tDiffuse, uv + vec2(i, j) / uRes).rgb;   m[3] += d; s[3] += d * d;
  }
  float n = float((R + 1) * (R + 1)), best = 1e9; vec3 col = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec3 mu = m[k] / n; vec3 v = abs(s[k] / n - mu * mu);
    float sv = v.r + v.g + v.b;
    if (sv < best) { best = sv; col = mu; }
  }
  // a gouache palette: a little chalky and warm, never quite black
  col = sat(col, 0.92) * vec3(1.03, 1.0, 0.93);
  col = mix(vec3(0.09, 0.08, 0.12), vec3(0.98, 0.95, 0.88), col);
  // pigment gathers at the edges of shapes; paper shows through in the grain
  float e = edges(uv, 1.6);
  col *= 1.0 - 0.32 * e;
  float grain = vnoise(frag * 0.6) * 0.5 + vnoise(frag * 0.15) * 0.5;
  col *= 0.93 + 0.1 * grain;
  return col;
}

vec3 pixel(vec2 uv) {
  float B = max(3.0, floor(uRes.y / 190.0));                  // about 190 pixels tall
  vec2 cell = floor(uv * uRes / B);
  vec2 cuv = (cell + 0.5) * B / uRes;
  vec3 c = texture2D(tDiffuse, cuv).rgb;
  float d0 = depthAt(cuv);
  bool sky = d0 > 40.0;                                        // the sky dome, well beyond the block
  c = sat(c, 1.3) * 1.04;
  // a small palette, 6 levels a channel, with just a little ordered (Bayer) dither between them
  int idx = int(mod(cell.x, 4.0)) + int(mod(cell.y, 4.0)) * 4;
  float bayer[16];
  bayer[0] = 0.0; bayer[1] = 8.0; bayer[2] = 2.0; bayer[3] = 10.0; bayer[4] = 12.0; bayer[5] = 4.0; bayer[6] = 14.0; bayer[7] = 6.0;
  bayer[8] = 3.0; bayer[9] = 11.0; bayer[10] = 1.0; bayer[11] = 9.0; bayer[12] = 15.0; bayer[13] = 7.0; bayer[14] = 13.0; bayer[15] = 5.0;
  float th = (bayer[idx] + 0.5) / 16.0 - 0.5;
  c = floor(c * 5.0 + 0.5 + (sky ? 0.0 : th * 0.55)) / 5.0;
  // outlines round silhouettes only, drawn on the near side, one pixel thick
  float out_ = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = (k == 0 ? vec2(1, 0) : k == 1 ? vec2(-1, 0) : k == 2 ? vec2(0, 1) : vec2(0, -1)) * B / uRes;
    float dn = depthAt(cuv + o);
    if (dn - d0 > d0 * 0.06) out_ = 1.0;
  }
  return mix(c, vec3(0.09, 0.07, 0.14), out_ * 0.9);
}

vec3 riso(vec2 uv) {
  vec2 frag = uv * uRes;
  // each ink is its own pass through the drum, a little off register
  vec3 cB = texture2D(tDiffuse, uv + vec2(1.4, -0.9) / uRes).rgb;
  vec3 cP = texture2D(tDiffuse, uv + vec2(-1.1, 1.0) / uRes).rgb;
  vec3 cY = texture2D(tDiffuse, uv).rgb;
  float lB = lum(cB);
  // each ink has a job: blue for the shadows, the blues and the lines; pink for the warm colours;
  // yellow for the yellows (blue over yellow makes the greens); plenty of bare paper in the light
  float kb = smoothstep(0.62, 0.12, lB) * 0.95 + clamp((max(cB.g, cB.b) - cB.r) * 1.6, 0.0, 1.0) * 0.55;
  float kp = clamp((cP.r - min(cP.g, cP.b)) * 2.2, 0.0, 1.0) * 0.9 + smoothstep(0.7, 0.3, lum(cP)) * 0.18;
  float ky = clamp(((cY.r + cY.g) * 0.5 - cY.b) * 2.6, 0.0, 1.0) * 0.95 + clamp((cY.g - cY.r) * 1.5, 0.0, 1.0) * 0.4;
  kb = max(kb, edges(uv + vec2(1.4, -0.9) / uRes, 1.2) * 0.9);
  vec3 paper = vec3(0.97, 0.94, 0.87) * (0.97 + 0.03 * vnoise(frag * 0.5));
  vec3 blue = vec3(0.0, 0.47, 0.75), pink = vec3(1.0, 0.32, 0.6), yellow = vec3(1.0, 0.89, 0.0);
  float cell = 4.0;
  vec3 col = paper;
  col *= mix(vec3(1.0), yellow, halftone(frag, ky, cell, 0.0));
  col *= mix(vec3(1.0), pink, halftone(frag, kp, cell, 1.31));
  col *= mix(vec3(1.0), blue, halftone(frag, kb, cell, 0.26));
  // the grain of the drum, and a few specks where the ink skipped
  col *= 0.95 + 0.05 * hash(floor(frag / 2.0));
  col = mix(col, paper, step(0.996, hash(floor(frag / 3.0) + 3.1)) * 0.8);
  return col;
}

void main() {
  vec3 c;
  if (uLook < 0.5) c = texture2D(tDiffuse, vUv).rgb;
  else if (uLook < 1.5) c = toy(vUv);
  else if (uLook < 2.5) c = ink(vUv);
  else if (uLook < 3.5) c = gouache(vUv);
  else if (uLook < 4.5) c = pixel(vUv);
  else c = riso(vUv);
  gl_FragColor = vec4(c, 1.0);
}
`;
