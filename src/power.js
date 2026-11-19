// What a power cut does down on the street, beyond the lights going out (main.js turns those down by
// state.power): the transformer's flash as it goes, the chaiwala's stove flame (always there, but drowned
// out by his bulb until the bulb goes), and the kirana's battery emergency light, which he gets switched
// on a few seconds into the dark, its tube stuttering as it starts.
import * as THREE from 'three';

export function makePower(world, W) {
  const add = (color, x, y, z) => {
    const l = new THREE.PointLight(color, 0, 0, 2);
    l.position.set(x, y, z);
    world.add(l);
    return l;
  };
  const flame = add('#ff9440', W.kettleTop.x, W.kettleTop.y - 0.1, W.kettleTop.z);
  const battery = add('#e6efff', -4.9, 1.0, -0.4);
  const spark = add('#cfe4ff', 0, 0, 0);
  let flash = 0;

  return {
    /** the transformer goes with a blue-white flash, at the top of the streetlight's pole */
    bang() {
      spark.position.copy(W.lamp.position).add(new THREE.Vector3(0.1, 0.25, -0.1));
      flash = 0.35;
    },
    /** power: the mains 0..1; cut: seconds since it went */
    update(dt, t, power, cut) {
      const dark = 1 - power;
      flame.intensity = dark * 0.45 * (0.85 + 0.1 * Math.sin(t * 13) + 0.05 * Math.sin(t * 29));
      // the battery light: switched on about seven seconds in, flickering a moment before it settles
      const k = cut - 7;
      const start = k < 0 ? 0 : k < 0.6 ? (Math.sin(k * 60) > 0.2 ? 1 : 0.1) : 1;
      battery.intensity = dark * start * 1.6;
      flash = Math.max(0, flash - dt);
      spark.intensity = flash > 0 ? 40 * (flash > 0.25 || (flash > 0.1 && flash < 0.16) ? 1 : 0.15) : 0;
    },
  };
}
