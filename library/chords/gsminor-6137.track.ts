import type { TrackDefinition } from '@core/library/types';

const E_MAJ = '[e1,e2,b3,g#3]';
const GS_MIN = '[g#1,g#2,b3,d#3,b4]';
const B_MAJ = '[b1,b2,f#2,b3,d#3]';
const FS_MAJ = '[f#1,f#2,b3,c#3,a#4]';

const track: TrackDefinition = {
  name: 'G# min 6-1-3-7',
  beats: 16,
  key: '1A', // reference key = G# minor → transposed to the selected key [SPEC-17.19]
  pattern: `note("<${E_MAJ} ${GS_MIN} ${B_MAJ} ${FS_MAJ}>").s("piano").gain(0.7).room(0.25)`,
  tags: ['house', 'chords', 'piano', 'g#-minor', 'uplifting'],
};

export default track;
