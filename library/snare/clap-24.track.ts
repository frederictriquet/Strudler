import type { TrackDefinition } from '@core/library/types';

// Hand clap on beats 2 and 4 — the House backbeat.
const track: TrackDefinition = {
  name: 'Clap 2&4',
  beats: 4,
  pattern: 's("~ cp ~ cp").gain(0.8)',
  tags: ['house', 'clap', 'backbeat'],
};

export default track;
