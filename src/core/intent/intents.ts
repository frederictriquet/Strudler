// [PLAN B] Unified intention surface. Both MIDI and the GUI produce the same
// Intents, so the two input surfaces are interchangeable ([PLAN B] "surface
// d'entrée unifiée"). A single dispatcher applies them to the channel rack.

import type { FxKind } from '@core/channels/types';

export type Intent =
  | { type: 'channelVolume'; channel: number; value: number } // value 0..1 [SPEC-7.1]
  | { type: 'channelFilter'; channel: number; value: number } // value 0..1 [SPEC-7.2, phase 4]
  | { type: 'channelEffectToggle'; channel: number; effect: FxKind } // GUI direct pick [SPEC-17.23]
  | { type: 'channelFxPrev'; channel: number } //  nano S → previous effect [SPEC-17.28]
  | { type: 'channelFxNext'; channel: number } //  nano R → next effect     [SPEC-17.28]
  | { type: 'channelFxToggle'; channel: number } // nano M → on/off focused [SPEC-17.28]
  | { type: 'channelFxKnob'; channel: number; value: number } // p1 of focused fx [SPEC-17.23]
  | { type: 'channelFxFader'; channel: number; value: number } // p2 of focused fx [SPEC-17.23]
  // [SPEC-7.3] Toggle a pad. `set` names the pad set it belongs to; absent =
  // the current set. Only a scene recall [SPEC-20.11] or a replayed journal
  // [SPEC-11] ever names another one — a hand or a controller always means the
  // set under the pads.
  | { type: 'slotToggle'; channel: number; slot: number; set?: string }
  | { type: 'modeToggle' } //             toggle quantize on ALL channels [SPEC-7.5]
  | { type: 'channelModeToggle'; channel: number } // per-channel quantize [SPEC-17.17]
  | { type: 'windowPrev' } //                                          [SPEC-7.6]
  | { type: 'windowNext' } //                                          [SPEC-7.6]
  | { type: 'resync' } //                         reset quantization phase [SPEC-8.2, Q4]
  | { type: 'gridNudge'; beats: number } //  shift phase, signed (nano MARKER ◄►) [SPEC-17.34]
  | { type: 'dropHold'; on: boolean } // held gesture: cut all but the kick [SPEC-17.40]
  // Held global filter gestures: low-pass, high-pass, riser. [SPEC-17.41/17.42]
  | { type: 'filterHold'; mode: 'lp' | 'hp' | 'riser'; on: boolean }
  | { type: 'gateHold'; on: boolean } // held rhythmic gate [SPEC-17.44]
  | { type: 'phaserHold'; on: boolean } // held global phaser [SPEC-17.46]
  | { type: 'echoHold'; beats: number; on: boolean } // held tempo-locked echo [SPEC-17.47]
  // Pad sets: the two first buttons of the APC's right column. [SPEC-20.3]
  | { type: 'setPrev' } //                        previous pad set (APC CLIP STOP)
  | { type: 'setNext' } //                        next pad set (APC SOLO)
  | { type: 'setSelect'; index: number } //       GUI: jump to a set by position
  | { type: 'ledModeToggle' } //   pad brightness night ⇄ day (APC SHIFT) [SPEC-20.14]
  | { type: 'sceneModeToggle' } //     arm/disarm scene storing (Stream Deck M+) [SPEC-17.36]
  | { type: 'scenePress'; index: number } // store or recall scene `index`   [SPEC-17.36]
  | { type: 'transportStart' } //                 (re)start the master clock (nano PLAY)
  | { type: 'transportStop' } //                  stop everything / silence (nano STOP)
  | { type: 'sessionRecordToggle' }; //  start/stop the gesture journal (nano REC) [SPEC-17.59]

export type IntentType = Intent['type'];
