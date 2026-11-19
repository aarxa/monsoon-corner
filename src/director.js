// The story player. A tale (src/tales.js) is a short film played on the street itself: the camera's
// shots, each gliding into the next; the time of day, the rain, the cloud and the power as curves over
// the story's seconds; the captions; and cues for the things that happen at a moment (the pigeons go up,
// the transformer bangs). While a story plays the controls step aside and the camera is the director's;
// when it ends (or on Skip) the camera eases back to where the orbit controls can take over, and the
// street carries on from wherever the story left it.
import * as THREE from 'three';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const sine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));

/** keys: [[seconds, value], ...]; eased from one key to the next, held before the first and after the last */
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t < t1) return v0 + (v1 - v0) * (t1 > t0 ? smooth((t - t0) / (t1 - t0)) : 1);
  }
  return keys[keys.length - 1][1];
}

export function makeDirector({ camera, controls, state, tales, hooks, el, onBegin, onEnd }) {
  let tale = null, T = 0, shotI = -1, lineI = -1, cueI = 0, release = null;
  const snapP = new THREE.Vector3(), snapL = new THREE.Vector3();
  const P = new THREE.Vector3(), L = new THREE.Vector3(), look = new THREE.Vector3(), v = new THREE.Vector3();
  const sph = new THREE.Spherical();

  // on a narrow (portrait) screen the same shot needs to stand further back to hold the same width
  const reach = () => { const a = innerWidth / innerHeight; return a < 0.9 ? 1.75 : a < 1.3 ? 1.3 : 1; };

  function shotPose(s, end, t, outP, outL) {
    const k = sine((t - s.at) / Math.max(0.001, end - s.at));
    outL.fromArray(s.look).lerp(v.fromArray(s.look2 || s.look), k);
    outP.fromArray(s.pos).lerp(v.fromArray(s.pos2 || s.pos), k);
    outP.sub(outL).multiplyScalar(reach()).add(outL);
  }

  function apply(t) {
    for (const k of ['time', 'rain', 'cloud', 'power']) if (tale.tracks[k]) state[k] = track(tale.tracks[k], t);
  }

  function setLine(i) {
    if (i === lineI) return;
    lineI = i;
    el.line.classList.remove('is-on');
    clearTimeout(setLine.timer);
    if (i < 0) return;
    setLine.timer = setTimeout(() => { el.line.textContent = tale?.lines[i]?.text ?? ''; el.line.classList.add('is-on'); }, 380);
  }

  function begin(t) {
    tale = t; T = 0; shotI = -1; lineI = -1; cueI = 0; release = null;
    state.auto = null;
    hooks.prepare?.(tale);
    apply(0);
    el.name.textContent = tale.title;
    el.title.textContent = tale.title;
    el.title.classList.add('is-on');
    clearTimeout(begin.timer);
    begin.timer = setTimeout(() => el.title.classList.remove('is-on'), 3200);
    controls.enabled = false;
    controls.autoRotate = false;
    document.body.classList.add('is-telling');
    onBegin?.(tale);
  }

  function end(skipped) {
    if (!tale) return;
    const done = tale;
    // where the story was heading: let the sliders ease there (and the lights come back on)
    if (skipped) {
      const last = (k) => done.tracks[k] && done.tracks[k][done.tracks[k].length - 1][1];
      state.auto = { time: last('time') ?? state.time, rain: last('rain') ?? state.rain };
      if (done.tracks.power) state.power = last('power');
      if (done.tracks.cloud) state.cloud = last('cloud');
    }
    tale = null;
    setLine(-1);
    el.title.classList.remove('is-on');
    document.body.classList.remove('is-telling');
    // glide out to a place the orbit controls allow (their distance and height limits)
    v.subVectors(camera.position, look);
    sph.setFromVector3(v);
    sph.radius = THREE.MathUtils.clamp(sph.radius, controls.minDistance + 0.2, controls.maxDistance - 0.2);
    sph.phi = THREE.MathUtils.clamp(sph.phi, controls.minPolarAngle + 0.02, controls.maxPolarAngle - 0.02);
    release = { t: 0, fromP: camera.position.clone(), toP: new THREE.Vector3().setFromSpherical(sph).add(look), look: look.clone() };
    onEnd?.(done, skipped);
  }

  function play(id) {
    const t = tales.find((x) => x.id === id);
    if (!t) return;
    if (tale) end(false);
    el.fade.classList.add('is-on');
    setTimeout(() => { begin(t); el.fade.classList.remove('is-on'); }, 650);
  }

  return {
    play,
    stop: () => end(true),
    get active() { return !!tale || !!release; },
    get playing() { return tale?.id ?? null; },
    get t() { return T; },
    /** jump to a moment in the playing story (the camera snaps to that shot; earlier cues are skipped) */
    seek(t) {
      if (!tale) return;
      T = t; shotI = -1;
      cueI = tale.cues.filter((c) => c.at < t).length;
    },
    /** advance the story; true while the director has the camera */
    update(dt) {
      if (release) {
        release.t += dt / 1.4;
        const k = sine(release.t);
        camera.position.lerpVectors(release.fromP, release.toP, k);
        camera.lookAt(release.look);
        if (release.t >= 1) {
          controls.target.copy(release.look);
          controls.enabled = true;
          release = null;
          controls.update();
        }
        return true;
      }
      if (!tale) return false;
      T += dt;
      apply(T);
      while (cueI < tale.cues.length && T >= tale.cues[cueI].at) hooks[tale.cues[cueI++].do]?.();
      setLine(tale.lines.findIndex((l) => T >= l.at && T < l.to));
      el.bar.style.width = `${(100 * Math.min(1, T / tale.length)).toFixed(2)}%`;

      // the camera: this shot's slow move, glided into from wherever the last one left it
      const shots = tale.shots;
      let i = shotI < 0 ? 0 : shotI;
      while (i + 1 < shots.length && T >= shots[i + 1].at) i++;
      if (i !== shotI) {
        if (shotI < 0) { shotPose(shots[i], shots[i + 1]?.at ?? tale.length, T, P, L); snapP.copy(P); snapL.copy(L); }
        else { snapP.copy(camera.position); snapL.copy(look); }
        shotI = i;
      }
      const s = shots[i];
      shotPose(s, shots[i + 1]?.at ?? tale.length, T, P, L);
      const g = s.glide ?? 3;
      const w = i === 0 || g <= 0 ? 1 : sine((T - s.at) / g);
      camera.position.lerpVectors(snapP, P, w);
      look.lerpVectors(snapL, L, w);
      camera.lookAt(look);

      if (T >= tale.length) end(false);
      return true;
    },
  };
}
