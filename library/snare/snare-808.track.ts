import type { TrackDefinition } from '@core/library/types';

// [SPEC-4] 808 snare (SD0075.WAV = sound "808sd", index 4) on the 2 and 4
// backbeat, with a touch of room for space.
const track: TrackDefinition = {
  name: 'Snare 808',
  beats: 4,
  pattern: 's("~ 808sd:4 ~ 808sd:4").gain(0.75).room(0.15)',
  tags: ['house', 'snare', '808', 'backbeat'],
};

export default track;
