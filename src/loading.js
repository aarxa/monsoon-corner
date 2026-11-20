// The loading screen (index.html #loader). The street is about 10 MB of models, which on a slow
// connection or a small phone can take a while, so first-time visitors get a bar instead of a blank page.
//
// The bar counts real bytes as each model downloads (sizes from the response, or from the build's list of
// model sizes when a host doesn't send one), then the models being unpacked into the scene, then the
// shaders being compiled; only then does the curtain lift. The page itself shows the screen before any
// script has run, with the bar shimmering, so it never looks stuck.
/* global __MODEL_BYTES__ */
const SIZES = typeof __MODEL_BYTES__ === 'object' ? __MODEL_BYTES__ : {};
const files = new Map(); // file name -> { loaded, total, ready }
let stage = 'download';
let live = false;

const $ = (id) => document.getElementById(id);
const el = { root: $('loader'), fill: $('loaderFill'), text: $('loaderText'), pct: $('loaderPct') };
const nameOf = (url) => url.split('/').pop().split('?')[0];
const mb = (b) => (b / 1048576).toFixed(1);

function file(url) {
  const n = nameOf(url);
  if (!files.has(n)) files.set(n, { loaded: 0, total: 0, ready: false });
  return files.get(n);
}

function show() {
  if (!el.root) return;
  let got = 0, all = 0, ready = 0, n = 0;
  for (const [name, f] of files) {
    const total = f.total || SIZES[name] || f.loaded || 1;
    all += total; got += Math.min(f.loaded, total); n++;
    if (f.ready) ready++;
  }
  for (const [name, b] of Object.entries(SIZES)) if (!files.has(name)) { all += b; n++; } // not asked for yet
  const dl = all ? got / all : 0;
  const k = stage === 'done' ? 1 : stage === 'compile' ? 0.96 : 0.85 * dl + 0.1 * (n ? ready / n : 0);
  el.fill.style.transform = `scaleX(${k.toFixed(3)})`;
  el.root.setAttribute('aria-valuenow', Math.round(k * 100));
  el.pct.textContent = `${Math.round(k * 100)}%`;
  el.text.textContent = stage === 'done' ? 'Here we go' : stage === 'compile' ? 'Switching on the lights'
    : dl < 0.999 ? `Bringing in the street · ${mb(got)} of ${mb(all)} MB` : 'Unpacking the street';
}

export const loading = {
  /** false until the scene is ready to be drawn (main.js skips rendering until then) */
  get live() { return live; },
  /** bytes so far for one model file */
  progress(url, loaded, total) { const f = file(url); f.loaded = loaded; if (total) f.total = total; show(); },
  /** a model is downloaded and in the scene (or failed: either way, nothing more to wait for) */
  ready(url) { const f = file(url); f.ready = true; f.loaded = Math.max(f.loaded, f.total || SIZES[nameOf(url)] || 0); show(); },
  /** read a fetch() response's body, counting the bytes as they come */
  async read(url, res) {
    const total = +res.headers.get('content-length') || 0;
    if (!res.body?.getReader) { const buf = await res.arrayBuffer(); this.progress(url, buf.byteLength, buf.byteLength); return buf; }
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      this.progress(url, got, total);
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out.buffer;
  },
  /** everything's in: compiling the shaders now, before the first frame */
  compiling() { stage = 'compile'; show(); },
  /** shaders ready: start drawing (still behind the curtain for the first frames) */
  go() { live = true; },
  /** lift the curtain */
  done() {
    stage = 'done'; live = true; show();
    if (!el.root) return;
    el.root.classList.add('is-done');
    setTimeout(() => el.root.remove(), 1000);
  },
};
show();

// a device that can't run WebGL at all would otherwise sit on the bar forever: say so instead
addEventListener('error', (e) => {
  if (live || !el.root || !/webgl/i.test(String(e.message))) return;
  el.text.textContent = 'This device can’t show the 3D street. Try another browser.';
  el.pct.textContent = '';
});
