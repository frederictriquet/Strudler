import type { TrackDefinition } from '@core/library/types';

// Off-beat minor chord stabs (arpy, pitched) with a touch of reverb.
const track: TrackDefinition = {
  name: 'Chord Stab',
  beats: 4,
  pattern: 'n("~ [0,3,7] ~ [0,3,7]").s("arpy").room(0.4).gain(0.5)',
  tags: ['house', 'chord', 'stab'],
};

export default track;
