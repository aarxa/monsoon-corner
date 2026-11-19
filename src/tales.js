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
      { at: 27.4, to: 33.6, text: 'The third-floor flat has an inverter, so its TV is still on, and half the building is watching it through the window.' },
      { at: 34.4, to: 44.6, text: 'Down on the street the kirana’s battery light is on, and the chaiwala’s flame is the brightest thing on the block.' },
      { at: 45.4, to: 51.6, text: 'Across the road, everyone still has power. Of course they do.' },
      { at: 52.6, to: 56, text: 'Light aa gayi!' },
      { at: 56.4, to: 70, text: 'A cheer goes up from every building on the street, the fans spin up, and somewhere a pressure cooker finally whistles.' },
    ],
    cues: [{ at: 11.2, do: 'thunder' }, { at: 13.25, do: 'bang' }],
  },
  {
    id: 'first-rain',
    title: 'The first rain',
    blurb: 'A hot afternoon at the end of May, and the monsoon arriving all at once.',
    length: 92,
    prepare: { wet: 0, washing: true, catHome: true },
    tracks: {
      time: [[0, 0.36], [20, 0.4], [40, 0.46], [62, 0.5], [88, 0.96]],
      cloud: [[0, 0], [18, 0], [34, 0.75], [40, 0.85], [84, 0.85], [92, 0.6]],
      // a few fat drops first (enough for the cat and the washing, not yet for the people), then the lot
      rain: [[0, 0], [39.5, 0], [40.5, 0.14], [49, 0.14], [51.5, 0.85], [57, 0.95], [72, 0.9], [90, 0.6]],
    },
    shots: [
      { at: 0, pos: [-14, 9, 22], pos2: [-8, 8, 22], look: [0, 2, 0], look2: [1, 2, 0] },
      { at: 9, pos: [-0.5, 1.6, 6.5], pos2: [1.5, 1.6, 6.5], look: [-3, 0.5, 0.5], look2: [-0.5, 0.5, 0.5] },
      { at: 19, pos: [2.8, 6.8, 3.2], pos2: [2.2, 6.9, 2.9], look: [-0.4, 5.7, -2], look2: [-0.6, 5.6, -2] },
      { at: 31, pos: [4.9, 1.5, 3.4], look: [6.1, 0.05, 0.9], look2: [6, 2.4, 0.3] },
      { at: 38.5, pos: [2.8, 1.0, 3.6], pos2: [2.5, 0.9, 3.3], look: [1.2, 0.3, 0.6], look2: [1.5, 0.3, 0.3], glide: 2 },
      { at: 44.5, pos: [2.4, 8.2, 5.5], pos2: [1.9, 8.0, 5.0], look: [-0.3, 5.3, -1.8] },
      { at: 51, pos: [-6.5, 2, 7.5], pos2: [-5.5, 1.9, 7], look: [-4, 0.5, 0.8] },
      { at: 60, pos: [-1.2, 1.5, 5.4], pos2: [-1.5, 1.45, 5], look: [-4, 1.45, 0.6] },
      { at: 72, pos: [6, 4, 13], pos2: [13, 9, 21], look: [0, 2.2, 0], look2: [0, 1.8, 0], glide: 4 },
    ],
    lines: [
      { at: 3.5, to: 8.6, text: 'The last week of May. It hasn’t rained since October, and the whole city is waiting.' },
      { at: 9.6, to: 18.6, text: 'The radio says the monsoon reaches Mumbai tomorrow. It said that yesterday too. The chai stall does good business anyway.' },
      { at: 19.6, to: 30.6, text: 'Then, around five, the light goes strange. The wind turns, and aunty’s washing starts to flap.' },
      { at: 31.6, to: 38.6, text: 'The kabootar know first.' },
      { at: 39.6, to: 44.2, text: 'One drop. Then a few more, fat and warm, darkening the dust. The cat is not staying for this.' },
      { at: 45, to: 50.8, text: 'Up on the roof, aunty is already running for her washing.' },
      { at: 51.6, to: 59.6, text: 'And then all of it at once. Everyone on the street runs for the same few feet of tarpaulin.' },
      { at: 60.6, to: 71.6, text: 'The gutters give up in minutes. The chaiwala puts another pot on. Nobody is going anywhere.' },
      { at: 72.6, to: 92, text: 'By seven the windows are lit and it’s still coming down. It will rain like this, on and off, until September.' },
    ],
    cues: [{ at: 33.5, do: 'pigeons' }],
  },
];
