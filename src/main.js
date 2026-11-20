import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildWorld, wettable, registerMaterials } from './world.js';
import { makeSteam, makeWetRoad, makeSpouts, makeMist, makeDrips, makeRunoff, makeSplash } from './weather.js';
import { makeWind, buildShelter, makeImpacts, makeRain, makeSway } from './physics.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { swapInModels } from './models.js';
import { makeCrowd } from './crowd.js';
import { makeCricket } from './cricket.js';
import { makeBike } from './bike.js';
import { makeDogs } from './dogs.js';
import { makeRooms } from './rooms.js';
import { makeNeighbours } from './neighbours.js';
import { makeCat } from './cat.js';
import { makePigeons } from './pigeons.js';
import { makeLook } from './looks.js';
import { makeCity } from './city.js';
import { stories } from './stories.js';
import { tales } from './tales.js';
import { makeDirector } from './director.js';
import { makePower } from './power.js';
import { loading } from './loading.js';

// Haze that follows Beer–Lambert: light from a surface fades as exp(-d / L) over the distance d it travels
// through wet air (L = attenuation length). d is measured from the front edge of the block, so zooming
// in or out doesn't fog the street; fog.near = where that front edge is, fog.far = L.
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  float fogFactor = 1.0 - exp(-max(vFogDepth - fogNear, 0.0) / fogFar);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;

// ---------- how much this device can take ----------
// Phones get a lighter street: fewer pixels, no ambient-occlusion pass, cheaper edge smoothing, smaller
// shadow maps, half the rain, a steady 30 fps, and a check that drops the resolution a step further if
// it still can't keep up. (?quality=phone or ?quality=full overrides the guess.)
const Q = (() => {
  const ask = new URL(location.href).searchParams.get('quality');
  const small = Math.min(screen.width, screen.height) <= 600 && matchMedia('(pointer: coarse)').matches;
  const weak = navigator.deviceMemory != null && navigator.deviceMemory <= 3;
  const phone = ask ? ask === 'phone' : small || weak;
  return {
    phone,
    pixelRatio: Math.min(devicePixelRatio, phone ? 1.25 : 1.5),
    minPixelRatio: 0.75,
    samples: phone ? 2 : 4,
    ao: !phone,
    sunShadow: phone ? 1024 : 2048,
    lampShadow: phone ? 512 : 1024,
    rain: phone ? 3500 : 7500,
    fps: phone ? 30 : 0,   // 0: as fast as the screen refreshes
  };
})();

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.phone }); // (on phones the composer's own smoothing is enough)
renderer.setPixelRatio(Q.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
// reflections come from the actual sky (bright overhead, the horizon colour, dark street below), rebuilt
// as the time and weather change, so wet surfaces reflect a grey monsoon sky rather than a lit room
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top, horizon, ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon * 0.6, ground, smoothstep(0.0, 0.3, -h)); gl_FragColor = vec4(c, 1.0); }',
});
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSky));
let envRT = null, envKey = '', envAt = -1;
function updateEnv(t, top, horizon, ground) {
  const key = top.getHexString() + horizon.getHexString() + ground.getHexString();
  if (key === envKey || t - envAt < 0.25) return;
  envKey = key; envAt = t;
  envSky.uniforms.top.value.copy(top); envSky.uniforms.horizon.value.copy(horizon); envSky.uniforms.ground.value.copy(ground);
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0, 0.1, 50);
  scene.environment = envRT.texture;
  old?.dispose();
}
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // until the first sky is ready
scene.fog = new THREE.Fog('#bfe3f0', 20, 500);
// a gradient sky that melts into the fog at the horizon
const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top, bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.3 + 0.12, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0); }',
}));
sky.renderOrder = -1;
scene.add(sky);
const city = makeCity(scene); // Mumbai all around and below: rooftops, skyline, the bay, clouds

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const narrow = () => innerWidth / innerHeight < 0.9;
camera.position.set(15, 11, 20).multiplyScalar(narrow() ? 1.6 : 1);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.4, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 9; controls.maxDistance = 48;
controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.38;
controls.autoRotate = true; controls.autoRotateSpeed = 0.35;

// ---------- lights ----------
const hemi = new THREE.HemisphereLight('#dff1ff', '#8a7660', 1.1);
const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.sunShadow, Q.sunShadow);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4; // soft-edged shadows
const moon = new THREE.DirectionalLight('#8fa8ff', 0);
moon.position.set(-10, 14, 8);
scene.add(hemi, sun, moon);

// ---------- the world ----------
const W = buildWorld(scene);
const fans = W.fans;
const crowd = makeCrowd(W.world); // people on the footpath who run for cover when it rains
const cricket = makeCricket(W.world); // kids playing gully cricket in the side lane
const wind = makeWind();
const impacts = makeImpacts(scene);
const splash = makeSplash(scene, impacts); // where poured water lands: spray, churn, a sheet running off
const dogs = makeDogs(W.world, impacts); // street dogs: three roam, one sleeps under the bench
const rooms = makeRooms(W.world);         // the rooms behind the windows, with people, TVs and fans
const neighbours = makeNeighbours(W.world); // uncle with his chai on the balcony, the aunty and her washing on the roof
neighbours.ready.then((g) => registerMaterials(g, W)).catch(() => {});
const cat = makeCat(W.world, impacts);
const pigeons = makePigeons(W.world);     // kabootar: on the ledges and wires, at the grain by the xerox shop    // a ginger cat on the scooter's seat, who can't stand the rain
const rain = makeRain(scene, impacts, Q.rain);
W.lamp.shadow.mapSize.set(Q.lampShadow, Q.lampShadow);
const steam = makeSteam(scene, W.kettleTop);
const road = makeWetRoad(scene);
renderer.localClippingEnabled = true;
// the taxi appears out of, and disappears into, the cut edges of the block
const clip = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 7.7), new THREE.Plane(new THREE.Vector3(1, 0, 0), 7.7)];
const clipTaxi = (root) => root.traverse((o) => {
  if (!o.isMesh) return;
  for (const m of [].concat(o.material)) { m.clippingPlanes = clip; m.clipShadows = true; }
});
clipTaxi(W.taxi);
const bike = makeBike(W.world, clip); // a family of three on a motorbike, now and then
W.glow.push({ light: bike.beam, max: 18, grid: false });
const power = makePower(W.world, W); // the stove flame, the kirana's battery light and the transformer, for a power cut
bike.ready.then((g) => registerMaterials(g, W)).catch(() => {}); // its head and tail lamps light up at night
const taxiWheels = [];
const modelsReady = swapInModels(W.world, (name, model) => {
  registerMaterials(model, W);
  if (name === 'walker') {
    clipTaxi(model);
    model.traverse((o) => {
      if (['leg_l', 'leg_r', 'knee_l', 'knee_r', 'arm_l'].includes(o.name)) walk.joints[o.name] = o;
      if (o.name === 'umbrella') walk.umbrella = o;
    });
  }
  if (name === 'taxi') {
    clipTaxi(model);
    model.traverse((o) => { if (/^wheel_[a-z]+$/.test(o.name)) taxiWheels.push(o); });
  }
});
const drive = { wait: 2, speed: 1.7 };
let spouts = null, drips = null, runoff = null;
const mist = makeMist(scene);
let sway = null;
W.ready.then((street) => {
  runoff = makeRunoff(scene, W.edges, street, impacts, 700, splash);
  spouts = makeSpouts(scene, W.spouts, street, impacts, runoff, splash);
  window.__runoff = runoff;
  drips = makeDrips(scene, W.drips, street, impacts);
  sway = makeSway(W.sway);
  rooms.build(W.rooms);
  pigeons.setPerches(W.perches);
});
// once everything that stands still has loaded, map where rain can land
Promise.all([W.ready, modelsReady, crowd.ready.catch(() => null), cricket.ready.catch(() => null), bike.ready.catch(() => null), dogs.ready.catch(() => null), neighbours.ready.catch(() => null), cat.ready.catch(() => null), pigeons.ready.catch(() => null)]).then(() => {
  const shelter = buildShelter(renderer, scene, [W.taxi, W.walker, crowd.group, cricket.group, bike.group, dogs.group, neighbours.group, cat.group, pigeons.group, city.group, rooms.mesh, sky, road.mirror].filter(Boolean));
  rain.setShelter(shelter); // rain stops on whatever is overhead
  steam.setRoof(shelter);   // and the chai steam can't rise through the tarp
  crowd.setShelter(shelter); // and people know where they can stay dry
  dogs.setShelter(shelter);
  pigeons.setShelter(shelter); // and the pigeons know which ledges stay dry
  splash.setShelter(shelter);  // and poured water lands on what's really there
  window.__mc.shelter = shelter;
});
// The taxi's and the motorbike's headlights live in the scene itself, not in the vehicles (which are
// hidden while they're away): every lit material is compiled for the number of lights in view, so a
// headlight coming and going would recompile all of them, a visible hitch, the first time each drove in.
// Instead they stay put in the scene and follow their vehicle, dark while it's away.
const headlights = [];
function keepInScene(light, vehicle) {
  headlights.push({ light, vehicle, pos: light.position.clone(), aim: light.target.position.clone() });
  scene.add(light, light.target);
}
keepInScene(W.taxi.children.find((o) => o.isSpotLight), W.taxi);
bike.ready.then(() => keepInScene(bike.beam, bike.group)).catch(() => {});
function followHeadlights() {
  for (const h of headlights) {
    h.vehicle.localToWorld(h.light.position.copy(h.pos));
    h.vehicle.localToWorld(h.light.target.position.copy(h.aim));
    if (!h.vehicle.visible) h.light.intensity = 0;
  }
}

// the loading screen: once every model is in (or has failed), compile the shaders before the first
// frame, so the GPU doesn't stall on them in front of the visitor, then lift the curtain
Promise.allSettled([W.ready, modelsReady, crowd.ready, cricket.ready, bike.ready, dogs.ready, neighbours.ready, cat.ready, pigeons.ready]).then(async () => {
  loading.compiling();
  await new Promise((r) => setTimeout(r, 50)); // let the bar show it
  try { await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 15000))]); } catch { /* draw anyway */ }
  loading.go(); // the frame loop lifts the curtain after its first few frames (see `drawn` below)
});
const walk = { wait: 4, speed: 0.55, phase: 0, joints: {}, umbrella: null };
const tmpV = new THREE.Vector3();
clipTaxi(W.walker);

// ---------- post: antialiasing, ambient occlusion, bloom, a light film grade ----------
// a multisampled target keeps edges smooth (the composer would otherwise drop the renderer's antialiasing)
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.samples }));
composer.addPass(new RenderPass(scene, camera));
// ambient occlusion: corners, ledges and contact points settle into soft shadow
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
gtao.blendIntensity = 0.9;
// sheets (the chai tarp, roof tarps, washing, bunting) are single surfaces seen from both sides; drawn
// one-sided, the AO pass would miss them and paint the shading of what's underneath onto them
gtao.normalMaterial.side = THREE.DoubleSide;
// leaf cards and sprites (mist, steam) are soft cut-outs; the ambient-occlusion pass would treat
// them as solid quads, so they sit that pass out
const hiddenForAO = [];
class HideForAO extends Pass {
  constructor(hide) { super(); this.hide = hide; this.needsSwap = false; }
  render() {
    if (this.hide) {
      hiddenForAO.length = 0;
      const hide = (o) => { if (o.visible) { o.visible = false; hiddenForAO.push(o); } };
      W.foliage.forEach(hide);
      scene.traverse((o) => { if (o.isSprite) hide(o); });
    } else {
      for (const o of hiddenForAO) o.visible = true;
    }
  }
}
// (on phones the whole ambient-occlusion step is skipped: the heaviest pass, and the least missed on a small screen)
for (const p of [new HideForAO(true), gtao, new HideForAO(false)]) { p.enabled = Q.ao; composer.addPass(p); }
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// film grade: saturation, white balance by time of day, a gentle S-curve, vignette and grain
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNight: { value: 0 },
    uTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) }, uSat: { value: 1.1 }, uContrast: { value: 0.2 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uNight, uSat, uContrast; uniform vec3 uTint; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = clamp(mix(vec3(l), c, uSat), 0.0, 1.0);          // saturation
      c *= uTint;                                            // white balance for the time of day
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);        // a gentle S-curve
      c = c * 0.985 + vec3(0.01, 0.01, 0.014);               // just a breath of lift in the blacks
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * (0.5 + uNight * 0.1);
      c += (hash(floor(vUv * uRes) + fract(uTime) * 100.0) - 0.5) * (0.03 + uNight * 0.02);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);
// an art style over the whole frame (src/looks.js); off by default, ?look=<name> to try one
const look = makeLook(gtao, camera);
composer.addPass(look.pass);
look.set(new URL(location.href).searchParams.get('look') || 'real');

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h);
  grade.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
}
addEventListener('resize', resize); resize();

// ---------- time of day: noon -> dusk -> night ----------
// A Mumbai day: a hard warm-white noon sun under a blue sky with a pale, hazy horizon, warm light
// bouncing up off the street. Towards evening the sky stays blue overhead and only the horizon and the
// low sun warm up, so sunlit walls glow and shadows go cool (blue skylight), rather than the whole
// scene turning brown; then a salmon sunset, a lavender blue hour, night.
// sky: the zenith; fog: the horizon; hemiSky/hemiGround: skylight and the bounce off the street;
// tint: the grade's white balance (slightly warm by day, neutral at dusk, cool at night).
// Night keeps a strong moonlit skylight: dark, but the street and the buildings still read.
const keys = [
  { t: 0.0, sky: '#5aa5e4', fog: '#dceef6', sun: 3.0, sunCol: '#fff6ea', sunEl: 1.05, hemi: 0.85, hemiSky: '#e2ecf6', hemiGround: '#b3a691', moon: 0, env: 0.45, night: 0, tint: [1.005, 1.0, 0.99] },
  { t: 0.3, sky: '#64a6de', fog: '#e6eef0', sun: 2.8, sunCol: '#fff0d8', sunEl: 0.72, hemi: 0.78, hemiSky: '#dbe6f2', hemiGround: '#ad9e88', moon: 0, env: 0.42, night: 0.02, tint: [1.005, 1.0, 0.99] },
  { t: 0.45, sky: '#6a98d2', fog: '#f1dcc6', sun: 2.4, sunCol: '#ffdcb4', sunEl: 0.32, hemi: 0.68, hemiSky: '#b4c6e6', hemiGround: '#8e8378', moon: 0, env: 0.34, night: 0.12, tint: [0.995, 0.995, 1.01] },
  { t: 0.56, sky: '#4f6cab', fog: '#efb59c', sun: 1.3, sunCol: '#ffb489', sunEl: 0.07, hemi: 0.7, hemiSky: '#a3b0dc', hemiGround: '#857a70', moon: 0.1, env: 0.22, night: 0.38, tint: [0.99, 0.99, 1.02] },
  { t: 0.66, sky: '#27346a', fog: '#7a6c9f', sun: 0.0, sunCol: '#ff8a50', sunEl: -0.05, hemi: 1.6, hemiSky: '#93a2d8', hemiGround: '#6c625c', moon: 0.45, env: 0.2, night: 0.78, tint: [0.98, 0.99, 1.03] },
  { t: 1.0, sky: '#0f1529', fog: '#1c2240', sun: 0.0, sunCol: '#ff8a50', sunEl: -0.2, hemi: 1.55, hemiSky: '#8298d2', hemiGround: '#655c55', moon: 0.9, env: 0.18, night: 1, tint: [0.98, 0.99, 1.03] },
];
const cA = new THREE.Color(), cB = new THREE.Color();
function sample(t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const f = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  const col = (k) => cA.set(a[k]).lerp(cB.set(b[k]), f).clone();
  return { sky: col('sky'), fog: col('fog'), sunCol: col('sunCol'), hemiSky: col('hemiSky'), hemiGround: col('hemiGround'),
    sun: lerp('sun'), sunEl: lerp('sunEl'), hemi: lerp('hemi'), moon: lerp('moon'), env: lerp('env'), night: lerp('night'),
    tint: a.tint.map((v, i) => v + (b.tint[i] - v) * f) };
}

// ---------- state & UI ----------
const $ = (id) => document.getElementById(id);
W.ready.then(() => { $('hint').textContent = 'Drag to look around · click things'; });
const ui = { time: $('time'), rain: $('rain'), monsoon: $('monsoon') };
// cloud: overcast without (or before) rain; power: the mains (0 in a power cut); cut: seconds since it went
const state = { time: +ui.time.value, rain: +ui.rain.value, wet: 0, flash: 0, auto: null, cloud: 0, power: 1, cut: 0, scare: false };
ui.time.addEventListener('input', () => { state.time = +ui.time.value; state.auto = null; idle(); });
ui.rain.addEventListener('input', () => { state.rain = +ui.rain.value; state.auto = null; idle(); });
ui.monsoon.addEventListener('click', () => {
  // one press runs the whole show: evening comes in (if it isn't night already), then the downpour;
  // clearing the sky goes back to whatever time it was
  const going = !(state.rain > 0.5);
  if (going) state.timeBefore = state.time;
  state.auto = going ? { time: Math.max(state.time, 0.92), rain: 0.95 } : { time: state.timeBefore ?? state.time, rain: 0 };
  ui.monsoon.textContent = going ? 'Clear the sky' : 'Bring the monsoon';
  idle();
});

// ---------- stories (src/tales.js, played by src/director.js) ----------
const director = makeDirector({
  camera, controls, state, tales,
  el: { fade: $('fade'), title: $('taleTitle'), name: $('taleName'), line: $('taleLine'), bar: $('taleBar') },
  hooks: {
    prepare(tale) {
      const p = tale.prepare || {};
      if (p.wet != null) state.wet = p.wet;
      if (p.washing != null) neighbours.setWashing(p.washing);
      if (p.catHome) cat.home();
      state.flash = 0;
      card.hidden = true; tip.hidden = true; menu.hidden = true;
    },
    pigeons() { state.scare = true; },                       // the flock goes up
    bang() { power.bang(); },                               // the transformer
    thunder() { state.flash = 0.45; },
  },
  onEnd() {
    ui.monsoon.textContent = (state.auto?.rain ?? state.rain) > 0.5 ? 'Clear the sky' : 'Bring the monsoon';
    $('hint').textContent = 'Drag to look around · click things';
    idle();
  },
});
const menu = $('menu');
for (const tale of tales) {
  const b = document.createElement('button');
  b.className = 'menu__item';
  b.innerHTML = `<b></b><span></span><i></i>`;
  b.querySelector('b').textContent = tale.title;
  b.querySelector('span').textContent = tale.blurb;
  b.querySelector('i').textContent = `${Math.round(tale.length)} s`;
  b.addEventListener('click', () => { menu.hidden = true; director.play(tale.id); });
  menu.appendChild(b);
}
$('stories').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; $('stories').setAttribute('aria-expanded', !menu.hidden); });
addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; $('stories').setAttribute('aria-expanded', false); } });
$('taleSkip').addEventListener('click', () => director.stop());
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (director.playing) director.stop(); else menu.hidden = true; } });

// stop the slow spin once someone starts playing
let idleTimer;
function idle() {
  controls.autoRotate = false;
  if (director?.playing) return;
  $('hint').classList.add('is-gone');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { controls.autoRotate = true; }, 25000);
}
controls.addEventListener('start', idle);

// ---------- clicking things ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const tip = $('tip'), card = $('card');
let hovered = null, downAt = null;
const focus = { target: null };

function pick(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(W.hotspots, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.story) o = o.parent;
    if (o) return o;
  }
  return null;
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || director.active) return;
  hovered = pick(e);
  canvas.style.cursor = hovered ? 'pointer' : 'grab';
  if (hovered) {
    tip.hidden = false; tip.textContent = stories[hovered.userData.story].title;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
  } else tip.hidden = true;
});
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (director.active) return;
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // that was a drag
  const o = pick(e);
  if (!o) return;
  const s = stories[o.userData.story];
  $('cardKicker').textContent = s.kicker; $('cardTitle').textContent = s.title; $('cardBody').textContent = s.body;
  card.hidden = false;
  const box = new THREE.Box3().setFromObject(o);
  focus.target = box.getCenter(new THREE.Vector3());
  focus.target.y = Math.min(focus.target.y, 2.4);
  idle();
});
$('cardClose').addEventListener('click', () => { card.hidden = true; focus.target = new THREE.Vector3(0, 1.4, 0); });

// ---------- loop ----------
const timer = new THREE.Timer();
timer.connect(document);
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), tmpC3 = new THREE.Color(), tmpC4 = new THREE.Color();

// on phones: a steady 30 fps (smoother-feeling than a frame rate that jumps about, and kinder to the
// battery), and if frames still come too slowly, a step down in resolution, at most three times
const pace = { last: 0, slow: 0, n: 0, steps: 0, since: 0 };
let drawn = 0;
function paced(now) {
  if (!Q.fps) return true;
  if (now - pace.last < 1000 / Q.fps - 3) return false;
  const gap = pace.last ? now - pace.last : 0;
  pace.last = now;
  if (loading.live && gap && gap < 1000) {
    pace.n++; if (gap > 1000 / 22) pace.slow++;
    if (!pace.since) pace.since = now;
    if (now - pace.since > 3000) { // every 3 s: were most frames slow?
      pace.since = now;
      if (pace.slow > pace.n * 0.5 && pace.steps < 3 && renderer.getPixelRatio() > Q.minPixelRatio + 0.01) {
        const pr = Math.max(Q.minPixelRatio, renderer.getPixelRatio() - 0.2);
        renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize();
        pace.steps++;
      }
      pace.n = pace.slow = 0;
    }
  }
  return true;
}

function frame(now = performance.now()) {
  if (!paced(now)) { requestAnimationFrame(frame); return; }
  timer.update();
  if (!loading.live) { requestAnimationFrame(frame); return; } // still loading: nothing to draw yet
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();

  // a story, if one is playing, sets the time, the weather and the power, and holds the camera
  const directing = director.update(dt);
  if (director.playing) { ui.time.value = state.time; ui.rain.value = state.rain; }
  else if (state.cloud > 0) state.cloud = Math.max(0, state.cloud - dt * 0.03); // a story's cloud drifts off after it

  // ease toward the monsoon button's targets
  if (state.auto) {
    state.time += (state.auto.time - state.time) * dt * 0.35;
    // the rain waits for the evening
    const rainGoal = state.auto.rain > state.rain && state.time < 0.55 ? state.rain : state.auto.rain;
    state.rain += (rainGoal - state.rain) * dt * 0.5;
    ui.time.value = state.time; ui.rain.value = state.rain;
    if (Math.abs(state.time - state.auto.time) < 0.003 && Math.abs(state.rain - state.auto.rain) < 0.003) state.auto = null;
  }

  // the street soaks up fast and dries slowly
  const wetGoal = Math.min(1, state.rain * 1.4);
  state.wet += (wetGoal - state.wet) * dt * (wetGoal > state.wet ? 0.6 : 0.05);

  const k = sample(state.time);
  const r = state.rain;
  const oc = Math.max(r, state.cloud);   // how overcast: the rain's cloud, or cloud gathering before it
  const gloom = oc * 0.65;
  state.cut = state.power < 0.99 ? state.cut + dt : 0;

  // sky & fog: rain greys everything out
  const grey = tmpC.set(k.night > 0.6 ? '#121722' : '#7c8794');
  const skyCol = k.sky.clone().lerp(grey, gloom);
  const fog = k.fog.clone().lerp(grey, gloom);
  sky.material.uniforms.top.value.copy(skyCol).multiplyScalar(0.85);
  sky.material.uniforms.bottom.value.copy(fog);
  sky.position.copy(camera.position);
  scene.fog.color.copy(fog);
  const dist = camera.position.distanceTo(controls.target);
  scene.fog.near = Math.max(0, dist - 6); // the haze starts at the front of the block
  // attenuation length in scene units (1 unit ≈ 2.3 m): a humid clear day sees ~3 km, a monsoon
  // downpour ~350 m, so the back of the block greys a little and the front keeps its colour
  scene.fog.far = 1 / (1 / 500 + Math.pow(r, 1.5) / 52);
  document.body.style.background = '#' + skyCol.getHexString();

  // sun sweeps west and sinks
  const az = 0.9 - state.time * 1.1;
  sun.position.set(Math.cos(az) * 14, Math.max(0.2, Math.sin(k.sunEl)) * 16, Math.sin(az) * 10 + 6);
  // under monsoon cloud the sun is gone but the whole sky glows: no hard shadows, plenty of soft light,
  // and the eye adapts to it (exposure), so colours stay colours. Night storms just get darker.
  const day = 1 - k.night;
  sun.intensity = k.sun * (1 - 0.92 * oc);
  sun.color.copy(k.sunCol);
  hemi.intensity = k.hemi * (1 + oc * (0.35 * day - 0.35 * k.night));
  hemi.color.copy(k.hemiSky).lerp(tmpC2.set('#e8ebee').lerp(tmpC4.set('#7c8598'), k.night), oc); // overcast skylight is a flat grey-white (grey-blue at night)
  hemi.groundColor.copy(k.hemiGround).lerp(tmpC2.set('#5d5a55'), r * 0.6); // and the wet street bounces less warmth
  moon.intensity = k.moon * (1 - 0.6 * oc);
  scene.environmentIntensity = k.env * (1 + oc * (0.1 * day - 0.4 * k.night));
  renderer.toneMappingExposure = 1 + 0.12 * day + 0.22 * oc * day; // the eye opens up a little in bright daylight
  // a power cut at night: much of a city night's glow is its own lights bounced about, so the dark street
  // loses some of its skylight too, and the candles show
  const outage = (1 - state.power) * k.night;
  hemi.intensity *= 1 - 0.4 * outage;
  scene.environmentIntensity *= 1 - 0.4 * outage;
  updateEnv(t, skyCol, fog, tmpC3.set('#4d4339').multiplyScalar(0.25 + 0.75 * day));

  // lightning in a heavy night storm
  if (r > 0.75 && k.night > 0.5 && state.flash <= 0 && Math.random() < dt * 0.12) {
    state.flash = 0.45;
  }
  if (state.flash > 0) {
    state.flash -= dt;
    const f = state.flash > 0.3 || (state.flash > 0.1 && state.flash < 0.18) ? 1 : 0;
    hemi.intensity += f * 2.2;
    if (f) { sky.material.uniforms.top.value.set('#c9d4ff'); sky.material.uniforms.bottom.value.set('#aab8ee'); }
  }

  // lamps, signs and windows come on as night falls
  const night = THREE.MathUtils.smoothstep(k.night + oc * 0.25, 0.25, 0.75);
  // windows come on in batches (glow_win1..6), everything else with the dusk; in a power cut only what
  // isn't on the mains stays lit
  const lvl = k.night + oc * 0.15;
  rooms.update(t, lvl, day * (1 - 0.45 * oc), state.power, state.cut);
  for (const g of W.glow) {
    const on = (g.thr == null ? night : THREE.MathUtils.clamp((lvl - g.thr) * 8, 0, 1)) * (g.grid === false ? 1 : state.power);
    if (g.light) g.light.intensity = g.max * on;
    if (g.mat) g.mat.emissiveIntensity = g.max * on;
  }
  power.update(dt, t, state.power, state.cut);
  followHeadlights();
  // the sodium lamp flickers a little in the storm
  if (r > 0.6) W.lamp.intensity *= 0.92 + 0.08 * Math.sin(t * 37) * Math.sin(t * 5.3);

  // wet surfaces get darker and richer, not greyer: water fills the rough surface, so less light
  // scatters back white and more is absorbed (albedo^(1+…)), and they turn glossy
  for (const w of wettable) {
    const a = state.wet * w.k;
    const e = 1 + 0.6 * a, d = 1 - 0.12 * a;
    w.mat.color.setRGB(w.color.r ** e * d, w.color.g ** e * d, w.color.b ** e * d);
    w.mat.roughness = THREE.MathUtils.lerp(w.rough, 0.5, a); // damp, not mirror-like
  }

  bloom.strength = night * 0.38;
  bloom.threshold = 0.95 - night * 0.18;
  grade.uniforms.uTime.value = t;
  grade.uniforms.uNight.value = night;
  look.update(t, night, grade.uniforms.uRes.value.x, grade.uniforms.uRes.value.y);
  city.update(dt, t, k.night, oc, fog, skyCol, wind.speed, camera, controls.target, state.wet);
  grade.uniforms.uTint.value.set(...k.tint);
  grade.uniforms.uSat.value = THREE.MathUtils.lerp(0.94, 1.0, Math.max(k.night, r * 0.5)); // a touch under neutral by day, so a bright noon doesn't shout
  grade.uniforms.uContrast.value = 0.05 * day * (1 - 0.5 * r); // the faintest snap by day, none at night (it would crush the shadows)

  // weather
  wind.update(t, Math.max(r, state.cloud * 0.9)); // the wind gets up as the cloud comes in
  rain.update(dt, r, wind.speed);
  impacts.update(dt);
  splash.update(dt);
  steam.update(dt, wind.speed * 0.3);
  runoff?.update(dt, r);
  road.update(t, state.wet, r);

  // little bits of life
  sway?.(dt, t, wind.speed);
  W.auto.position.y = Math.abs(Math.sin(t * 31)) * 0.006; // engine idling
  // AC fans: each motor cycles on and off with the compressor; the rotor's inertia spins it up and
  // down over a second or two. (Shown at a few hundred rpm: the real ~800 would strobe at 60 fps.)
  for (const f of fans) {
    if (f.on == null) { f.on = Math.random() < 0.8; f.timer = 15 + Math.random() * 40; f.w = f.on ? f.rpm : 0; }
    f.timer -= dt;
    if (f.timer <= 0) { f.on = Math.random() < 0.8; f.timer = 15 + Math.random() * 40; }
    f.w = (f.w ?? 0) + ((f.on && state.power > 0.5 ? f.rpm : 0) - (f.w ?? 0)) * (1 - Math.exp(-dt / 1.6)); // and wind down in a power cut
    f.obj.rotation.y += (f.w / 60) * Math.PI * 2 * dt;
  }

  // the taxi: cross the block, vanish, wait a bit, come round again (slower in the rain)
  if (drive.wait > 0) {
    drive.wait -= dt;
    W.taxi.visible = false;
    if (drive.wait <= 0) { W.taxi.position.x = 10; W.taxi.visible = true; }
  } else {
    const v = drive.speed * (1 - 0.35 * r);
    W.taxi.position.x -= v * dt;
    W.taxi.position.y = Math.abs(Math.sin(t * 9)) * 0.004;
    for (const w of taxiWheels) w.rotation.z -= (v * dt) / 0.17; // rolling without slipping: ω = v / r
    // on a wet road the rear tyres fling spray up and back
    if (state.wet > 0.25 && Math.abs(W.taxi.position.x) < 7.6) {
      for (const side of [-1, 1]) {
        let n = state.wet * v * 45 * dt;
        for (; n > 0; n--) {
          if (n < 1 && Math.random() > n) break;
          W.taxi.localToWorld(tmpV.set(-0.68, 0.04, side * 0.36));
          impacts.droplet(tmpV.x, tmpV.y, tmpV.z, -v * 0.35 + 0.3 + Math.random() * 0.6, 0.4 + Math.random() * 0.7, -side * (0.1 + Math.random() * 0.3));
        }
      }
    }
    if (W.taxi.position.x < -10) drive.wait = 3 + Math.random() * 6;
  }

  // someone walks along the road edge every so often, umbrella up if it's raining
  if (walk.wait > 0) {
    walk.wait -= dt;
    W.walker.visible = false;
    if (walk.wait <= 0) { W.walker.position.x = -9; W.walker.visible = true; }
  } else {
    const v = walk.speed * (1 + 0.4 * r); // hurrying in the rain
    W.walker.position.x += v * dt;
    const before = walk.phase;
    walk.phase += v * dt * 10.5; // ~1.8 steps a second at walking pace (a step ≈ 0.7 m)
    // a gait cycle per leg (φ = this leg's phase; the heel strikes at φ = π/2, when the hip is furthest forward):
    // the hip swings about 25° forward and 10° back; the knee bends twice, a little as the foot takes the
    // weight and about 60° in the swing to clear the ground; the free arm swings with the opposite leg
    const J = walk.joints;
    const bump = (x, c, w) => { const d = Math.atan2(Math.sin(x - c), Math.cos(x - c)); return Math.exp(-(d * d) / (2 * w * w)); };
    [['l', 0], ['r', Math.PI]].forEach(([k, off]) => {
      const f = walk.phase + off;
      if (J['leg_' + k]) J['leg_' + k].rotation.z = 0.08 + 0.36 * Math.sin(f);
      if (J['knee_' + k]) J['knee_' + k].rotation.z = -(1.05 * bump(f, -0.35, 0.55) + 0.26 * bump(f, 2.1, 0.4));
      // heel strike: splash under that heel if the road is wet
      const n0 = Math.floor((before + off - Math.PI / 2) / (2 * Math.PI)), n1 = Math.floor((f - Math.PI / 2) / (2 * Math.PI));
      if (n1 > n0 && state.wet > 0.25 && Math.abs(W.walker.position.x) < 7.6) {
        const fx = W.walker.position.x + 0.13, fz = W.walker.position.z + (k === 'l' ? -0.04 : 0.04);
        impacts.ring(fx, 0.0166, fz, 0.8);
        for (let i = 0; i < 4; i++) impacts.droplet(fx, 0.03, fz, (Math.random() - 0.3) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
      }
    });
    if (J.arm_l) J.arm_l.rotation.z = 0.3 * Math.sin(walk.phase + Math.PI);
    // the body rides highest over the standing leg, twice a cycle
    W.walker.position.y = Math.abs(Math.cos(walk.phase)) * 0.012;
    if (walk.umbrella) walk.umbrella.visible = r > 0.12;
    if (W.walker.position.x > 9) walk.wait = 4 + Math.random() * 8;
  }
  crowd.update(dt, t, r, state.wet, impacts);
  cricket.update(dt, t, r, state.wet, night, impacts);
  bike.update(dt, t, r, state.wet, impacts, W.taxi);
  dogs.update(dt, t, r, crowd.people.concat(cricket.debug.kids ? Object.values(cricket.debug.kids) : []));
  // uncle watches the motorbike go by, or the kids' ball when it's in play
  const watch = bike.group.visible && Math.abs(bike.group.position.x) < 6 ? bike.group.position
    : cricket.debug.game.state === 'play' ? cricket.debug.ball.mesh.position : null;
  neighbours.update(dt, t, r, k.night, wind.speed, watch);
  // the cat keeps an eye on the nearest dog, or anyone who comes close
  let eye = null;
  if (cat.cat) {
    let best = 2.5;
    for (const o of dogs.dogs.concat(crowd.people)) {
      const d = Math.hypot(o.pos.x - cat.cat.pos.x, o.pos.z - cat.cat.pos.z) * (o.fig && !o.J?.leg_fl ? 1.6 : 1);
      if (d < best) { best = d; eye = tmpV.set(o.pos.x, 0.3, o.pos.z); }
    }
  }
  cat.update(dt, t, r, eye);
  pigeons.update(dt, t, r, k.night, dogs.dogs.concat(crowd.people), (state.flash > 0.4 && !state.flashSeen) || state.scare);
  state.flashSeen = state.flash > 0.4;
  state.scare = false;
  spouts?.update(dt, r);
  drips?.update(dt, r);
  mist.update(dt, r, scene.fog.color, wind.speed);

  // camera
  if (!directing) {
    if (focus.target) {
      controls.target.lerp(focus.target, dt * 2.5);
      if (controls.target.distanceTo(focus.target) < 0.01) focus.target = null;
    }
    controls.update(dt);
  }
  composer.render();
  // the first frames compile what's left (shadows, the post-processing passes) while still covered
  if (drawn < 3 && ++drawn === 3) loading.done();
  requestAnimationFrame(frame);
}
// handy for poking at the scene from the console
window.__mc = { camera, controls, scene, W, state, renderer, composer, Q, loading, crowd, cricket, bike, dogs, rooms, neighbours, cat, pigeons, look, city, director, power };
requestAnimationFrame(frame);
