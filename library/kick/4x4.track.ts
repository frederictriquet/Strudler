import type { TrackDefinition } from '@core/library/types';

// Classic four-on-the-floor House kick.
const track: TrackDefinition = {
  name: '4x4',
  beats: 4,
  pattern: 's("bd*4").gain(0.95)',
  tags: ['house', 'kick', '4x4'],
};

export default track;
