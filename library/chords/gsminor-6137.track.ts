import type { TrackDefinition } from '@core/library/types';

// Chord progression 6-1-3-7 in G# minor: E · G#m · B · F#.
//
// Written as chord SYMBOLS rather than absolute notes [SPEC-17.48]: `voicing()`
// picks the inversion whose top note is closest to `anchor`, so the progression
// stays in one register and voice-leads itself — and it survives transposition
// instead of being dragged up or down as a block. `rootNotes(2)` keeps the bass
// in a fixed octave underneath.
const PROGRESSION = '<E G#m B F#>';

const track: TrackDefinition = {
  name: 'G# min 6-1-3-7',
  beats: 16,
  key: '1A', // reference key = G# minor [SPEC-17.19]
  pattern: `stack(
    chord("${PROGRESSION}").dict("triads").anchor("c4").voicing(),
    chord("${PROGRESSION}").rootNotes(2).note()
  ).s("piano").gain(0.7).room(0.25)`,
  tags: ['house', 'chords', 'piano', 'g#-minor', 'uplifting'],
};

export default track;
