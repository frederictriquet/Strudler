import type { TrackDefinition } from '@core/library/types';

const track: TrackDefinition = {
  name: 'Bzzz Lead',
  beats: 4,
  pattern: 'note("d d d# d").s("supersaw").tremolosync("4").tremoloskew("<1.5>")',
};

export default track;
