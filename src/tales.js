// The stories, played by src/director.js. Rewrite the words in your own voice.
//
// Each one is a timeline in seconds:
//   shots   where the camera is: pos -> pos2 and look -> look2 over the shot, glided into from the last
//   tracks  time of day (0 noon .. 1 night), rain, cloud (overcast before the rain) and power (the mains)
//   lines   the captions, shown from `at` to `to`
//   cues    things that happen at a moment: the pigeons go up, thunder, the transformer
//   prepare how the street should be when the story starts
export const tales = [
  {
    id: 'power-cut',
    title: 'Light gayi',
    blurb: 'A stormy night in July, and the power goes out on the whole street.',
    length: 70,
    prepare: { wet: 0.6, washing: false },
    tracks: {
      time: [[0, 1]],
      rain: [[0, 0.4], [50, 0.4], [70, 0.25]],
      power: [[0, 1], [12, 1], [12.05, 0.35], [12.25, 1], [12.9, 1], [12.95, 0.2], [13.1, 0.8], [13.3, 0],
        [52, 0], [52.1, 0.6], [52.3, 0.1], [54.6, 1]],
    },
    shots: [
      { at: 0, pos: [12, 7, 19], pos2: [9, 5.5, 15], look: [-0.5, 2.2, 0] },
      { at: 11, pos: [1.5, 3.2, 10.5], pos2: [0.5, 3, 10], look: [-0.5, 2.6, 0] },
      { at: 20, pos: [-5, 3.4, 9], pos2: [-1, 3.4, 9], look: [-5, 2.6, 0], look2: [-1.2, 2.6, 0] },
      { at: 27, pos: [1.3, 3.9, 5.2], pos2: [0.8, 4.0, 4.7], look: [0.25, 4.45, 0], glide: 2.5 },
      { at: 34, pos: [-1.5, 1.3, 6.5], pos2: [-2.5, 1.2, 6], look: [-4.5, 0.9, 0.3] },
      { at: 45, pos: [-10, 10, 17], pos2: [-6, 11, 18], look: [0, 1.5, 0] },
      { at: 52, pos: [4.5, 3, 9], look: [1, 2.4, 0] },
      { at: 60, pos: [6, 5, 14], pos2: [14, 9, 21], look: [0, 2, 0], look2: [0, 1.6, 0], glide: 4 },
    ],
    lines: [
      { at: 3.5, to: 10.6, text: 'Nine o’clock on a wet night in July. Dinner’s on, the TV’s on, and every fan on the street is turning.' },
      { at: 11.4, to: 13.4, text: 'Then the flicker everyone knows.' },
      { at: 13.8, to: 19.6, text: 'Light gayi.' },
      { at: 20.4, to: 26.8, text: 'A phone torch goes round one room. A candle is lit in the next.' },
      { at: 27.4, to: 33.8, text: 'Every building has that one family with an inverter. Their TV is still on, and now half the building is watching it through their window.' },
      { at: 34.4, to: 44.6, text: 'Down on the street the kirana’s battery light is on, and the chaiwala’s flame is the brightest thing on the block.' },
      { at: 45.4, to: 51.6, text: 'Across the road, everyone still has power. Of course they do.' },
      { at: 52.6, to: 56, text: 'Light aa gayi!' },
      { at: 56.4, to: 70, text: 'A cheer goes up from every building on the street, the fans spin up, and somewhere a pressure cooker finally whistles.' },
    ],
    cues: [{ at: 11.2, do: 'thunder' }, { at: 13.25, do: 'bang' }],
  },
];
