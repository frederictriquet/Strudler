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
  | { type: 'slotToggle'; channel: number; slot: number } //          [SPEC-7.3]
  | { type: 'modeToggle' } //             toggle quantize on ALL channels [SPEC-7.5]
  | { type: 'channelModeToggle'; channel: number } // per-channel quantize [SPEC-17.17]
  | { type: 'windowPrev' } //                                          [SPEC-7.6]
  | { type: 'windowNext' } //                                          [SPEC-7.6]
  | { type: 'resync' } //                         reset quantization phase [SPEC-8.2, Q4]
  | { type: 'gridNudge'; beats: number } //  shift phase, signed (nano MARKER ◄►) [SPEC-17.34]
  | { type: 'sceneModeToggle' } //     arm/disarm scene storing (Stream Deck M+) [SPEC-17.36]
  | { type: 'scenePress'; index: number } // store or recall scene `index`   [SPEC-17.36]
  | { type: 'transportStart' } //                 (re)start the master clock (nano PLAY)
  | { type: 'transportStop' }; //                 stop everything / silence (nano STOP)

export type IntentType = Intent['type'];
