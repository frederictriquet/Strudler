import type { TrackDefinition } from '@core/library/types';

// Deep-house bassline (jvbass repitched), rooted in C minor.
const track: TrackDefinition = {
  name: 'Deep House',
  beats: 4,
  pattern: 'note("c2 ~ c2 ~ eb2 ~ g2 ~").s("jvbass").lpf(800).gain(0.9)',
  tags: ['house', 'bass', 'deep'],
};

export default track;
