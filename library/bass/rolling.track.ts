import type { TrackDefinition } from '@core/library/types';

// Rolling 8-beat bassline (jvbass repitched) for a driving groove.
const track: TrackDefinition = {
  name: 'Rolling',
  beats: 8,
  pattern: 'note("c2 c2 eb2 c2 g1 c2 eb2 f2").s("jvbass").lpf(900).gain(0.85).slow(2)',
  tags: ['house', 'bass', 'rolling'],
};

export default track;
