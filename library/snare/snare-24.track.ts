import type { TrackDefinition } from '@core/library/types';

// Snare on 2 and 4, layered under a clap or on its own.
const track: TrackDefinition = {
  name: 'Snare 2&4',
  beats: 4,
  pattern: 's("~ sd ~ sd").gain(0.7)',
  tags: ['house', 'snare', 'backbeat'],
};

export default track;
