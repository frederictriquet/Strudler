import type { TrackDefinition } from '@core/library/types';

// Deeper kick (pitched down a touch) for deep-house grooves.
const track: TrackDefinition = {
  name: '4x4 Deep',
  beats: 4,
  pattern: 's("bd*4").speed(0.9).lpf(2000).gain(0.95)',
  tags: ['house', 'kick', 'deep'],
};

export default track;
