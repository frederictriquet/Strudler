import type { TrackDefinition } from '@core/library/types';

// Plucky lead with a dotted-eighth delay (arpy, pitched).
const track: TrackDefinition = {
  name: 'Pluck Delay',
  beats: 4,
  pattern: 'n("0 ~ 7 ~ 3 ~ 10 ~").s("arpy").delay(0.4).delaytime(0.375).delayfeedback(0.35).gain(0.55)',
  tags: ['house', 'lead', 'delay'],
};

export default track;
