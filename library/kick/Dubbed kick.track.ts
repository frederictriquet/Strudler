import type { TrackDefinition } from '@core/library/types';

// Classic four-on-the-floor House kick.
const track: TrackDefinition = {
  name: 'Dubbed kick',
  beats: 4,
  // backticks si multi-lignes ; sinon une seule ligne en quotes
  pattern: `s("<bd [rs ~ ~ rs] [~ ~ bd ~] rs>*4").speed(2).room(.2)`,
  tags: ['house', 'kick', '4x4'],
};

export default track;
