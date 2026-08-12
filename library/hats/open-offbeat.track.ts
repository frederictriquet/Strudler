import type { TrackDefinition } from '@core/library/types';

// Offbeat hats — the signature House "tss" on the &. dirt-samples has no reliable
// `oh` (open hat), so we open up the closed `hh` by slowing it down (longer,
// darker tail) which reads as an open hat in the mix.
const track: TrackDefinition = {
  name: 'Open Offbeat',
  beats: 4,
  pattern: 's("~ hh ~ hh ~ hh ~ hh").speed(0.7).gain(0.55)',
  tags: ['house', 'hats', 'open'],
};

export default track;
