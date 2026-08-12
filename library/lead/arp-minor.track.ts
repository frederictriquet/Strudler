import type { TrackDefinition } from '@core/library/types';

// Rolling minor arpeggio over 8 beats (arpy, pitched).
const track: TrackDefinition = {
  name: 'Arp Minor',
  beats: 8,
  pattern: 'n("0 3 7 10 12 10 7 3").s("arpy").room(0.3).gain(0.55).slow(2)',
  tags: ['house', 'arp', 'minor'],
};

export default track;
