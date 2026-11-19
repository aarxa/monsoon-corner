// Walking and running for the jointed figures (pedestrians, the cricket kids), driven by speed alone.
//
// A gait cycle is two steps; for each leg, φ is its phase and the heel strikes at φ = π/2, when the hip
// is furthest forward. The hip swings ~25° forward and ~10° back when walking, wider when running; the
// knee bends twice per cycle, a little as the foot takes the weight and a lot in the swing to clear the
// ground; arms swing against the legs, elbows folding to ~90° in a run; the body leans into a run and
// rides highest over the standing leg. Cadence is ~1.8 steps/s walking and ~2.8 running.
// Speeds are in scene units/s for a full-size adult; `size` scales them for a child.
import * as THREE from 'three';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const bump = (x, c, w) => { const d = wrap(x - c); return Math.exp(-(d * d) / (2 * w * w)); };

/** Advances g.phase and poses legs and knees. Returns the arm swing and elbow bend to use (callers may
 * override arms for gestures), how much it's a run (0..1), and which heels just struck the ground. */
export function gait(g, J, fig, speed, dt, size = 1) {
  const s = speed / size;
  const run = THREE.MathUtils.clamp((s - 0.6) / 0.75, 0, 1);
  const a = THREE.MathUtils.clamp(s / 0.4, 0, 1); // limbs settle as they stop
  const cad = s < 0.02 ? 0 : (1.8 + run) * Math.min(1, Math.sqrt(s / 0.5)) / Math.sqrt(size);
  const before = g.phase;
  g.phase += Math.PI * cad * dt;
  const strikes = [];
  for (const [k, off] of [['l', 0], ['r', Math.PI]]) {
    const f = g.phase + off;
    if (J['leg_' + k]) J['leg_' + k].rotation.z = a * ((0.08 + 0.07 * run) + (0.36 + 0.26 * run) * Math.sin(f));
    if (J['knee_' + k]) J['knee_' + k].rotation.z = -a * ((1.05 + 0.55 * run) * bump(f, -0.35 - 0.2 * run, 0.55) + (0.26 + 0.14 * run) * bump(f, 2.1, 0.4));
    const n0 = Math.floor((before + off - Math.PI / 2) / (2 * Math.PI)), n1 = Math.floor((f - Math.PI / 2) / (2 * Math.PI));
    if (n1 > n0 && a > 0.5) strikes.push(k);
  }
  fig.rotation.z = -0.2 * run * a;
  fig.position.y = a * (0.012 + 0.018 * run) * size * Math.abs(Math.cos(g.phase));
  return { run, a, swing: a * (0.3 + 0.25 * run) * Math.sin(g.phase), elbow: 0.15 + a * (0.15 + 1.2 * run), strikes };
}

/** Collects the joints of a figure exported from the people models (names may carry Blender's .001 suffixes). */
export function joints(fig) {
  const J = {};
  fig.traverse((o) => {
    const m = !o.isMesh && o.name.match(/^(leg_l|leg_r|knee_l|knee_r|arm_l|arm_r|elbow_l|elbow_r|head)\d*$/);
    if (m) J[m[1]] = o;
  });
  return J;
}
