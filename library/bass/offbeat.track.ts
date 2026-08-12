import type { TrackDefinition } from '@core/library/types';

// Offbeat bassline sitting between the kicks — classic pumping House feel.
const track: TrackDefinition = {
  name: 'Offbeat Bass',
  beats: 4,
  pattern: 'note("~ c2 ~ c2 ~ eb2 ~ g2").s("jvbass").lpf(750).gain(0.9)',
  tags: ['house', 'bass', 'offbeat'],
};

export default track;
