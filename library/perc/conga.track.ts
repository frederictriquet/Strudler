import type { TrackDefinition } from '@core/library/types';

// Syncopated conga/tumbao-ish perc pattern.
const track: TrackDefinition = {
  name: 'Conga',
  beats: 4,
  pattern: 's("~ perc ~ perc perc ~ perc ~").speed("1 1.5").gain(0.45)',
  tags: ['house', 'perc', 'conga'],
};

export default track;
