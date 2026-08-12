import type { TrackDefinition } from '@core/library/types';

// Sixteenth shaker/perc layer for groove.
const track: TrackDefinition = {
  name: 'Shaker',
  beats: 4,
  pattern: 's("perc*8").speed(1.2).gain(0.35)',
  tags: ['house', 'perc', 'shaker'],
};

export default track;
