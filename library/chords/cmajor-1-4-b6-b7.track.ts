import type { TrackDefinition } from '@core/library/types';

// C major progression I – IV – ♭VI – ♭VII → C · F · Ab · Bb (all major).
const C_MAJ = '[c3,e3,g3]';
const F_MAJ = '[f3,a3,c4]';
const AF_MAJ = '[g#3,c4,d#4]'; // Ab major
const BF_MAJ = '[a#3,d4,f4]'; //  Bb major

const track: TrackDefinition = {
  name: 'C maj I-IV-b6-b7',
  beats: 16,
  key: '8B', // reference key = C major
  pattern: `note("<${C_MAJ} ${F_MAJ} ${AF_MAJ} ${BF_MAJ}>").s("piano").gain(0.7).room(0.25)`,
  tags: ['house', 'chords', 'piano', 'c-major', 'uplifting'],
};

export default track;
