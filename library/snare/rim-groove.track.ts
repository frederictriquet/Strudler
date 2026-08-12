import type { TrackDefinition } from '@core/library/types';

// Syncopated rimshot groove for movement.
const track: TrackDefinition = {
  name: 'Rim Groove',
  beats: 4,
  pattern: 's("~ rs ~ [rs rs] ~ rs ~ rs").gain(0.5)',
  tags: ['house', 'rim', 'groove'],
};

export default track;
