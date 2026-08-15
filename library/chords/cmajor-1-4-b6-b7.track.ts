import type { TrackDefinition } from '@core/library/types';

// C major progression I – IV – ♭VI – ♭VII → C · F · Ab · Bb (all major).
// Chord symbols + voicing(): fixed register and automatic voice leading. [SPEC-17.48]
const PROGRESSION = '<C F Ab Bb>';

const track: TrackDefinition = {
  name: 'C maj I-IV-b6-b7',
  beats: 16,
  key: '8B', // reference key = C major
  pattern: `stack(
    chord("${PROGRESSION}").dict("triads").anchor("c4").voicing(),
    chord("${PROGRESSION}").rootNotes(2).note()
  ).s("piano").gain(0.7).room(0.25)`,
  tags: ['house', 'chords', 'piano', 'c-major', 'uplifting'],
};

export default track;
