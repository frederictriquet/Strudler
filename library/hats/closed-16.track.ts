import type { TrackDefinition } from '@core/library/types';

// Busy sixteenth-note closed hats with a subtle accent.
const track: TrackDefinition = {
  name: 'Closed 16',
  beats: 4,
  pattern: 's("hh*16").gain("[0.45 0.28]*8")',
  tags: ['house', 'hats', 'closed'],
};

export default track;
