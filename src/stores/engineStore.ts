// [SPEC-13] Engine bootstrap. Playback now flows through the channel rack
// (see rackStore); this module only arms the audio unlock at startup.

import { engine } from '@core/engine/StrudelEngine';

/** Arm audio unlock at app startup, before any click. See StrudelEngine.arm(). */
export function armEngine(): void {
  engine.arm();
}
