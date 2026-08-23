<script lang="ts">
  // [SPEC-10.4] The instrument surface: one strip per channel (nanoKONTROL2
  // column). Shows the channel's category, its S/M/R slots (track name + play
  // state) and its volume fader. Clicking a slot or moving a fader emits the same
  // intents as the MIDI controller ([PLAN B] unified surface). [SPEC-7.1/7.3]
  import {
    channelsState,
    dispatch,
    transportRunning,
    assignSlotTrack,
    showSlotProgress,
    activeSetColor,
  } from '@stores/rackStore';
  import { clockState } from '@stores/clockStore';
  import { placementMode, heldTrack } from '@stores/placementStore';
  import {
    slotLabel,
    isMissingTrack,
    FX_KINDS,
    FX_META,
    LAUNCH_META,
    type ChannelState,
    type SlotState,
    type FxKind,
  } from '@core/channels/types';
  import { fxParamLabel } from '@core/channels/fxParams';
  import { physicalPositions, physicalKey } from '@stores/physicalStore';
  import ChannelEditor from '@lib/ChannelEditor.svelte';
  import GhostSlider from '@lib/GhostSlider.svelte';

  const channels = channelsState;
  const running = transportRunning;
  const placing = placementMode;
  const held = heldTrack;
  const clk = clockState;
  const showProg = showSlotProgress;
  const physical = physicalPositions;
  const setColor = activeSetColor;

  /** Last observed hardware position for a control, or undefined. [SPEC-17.29] */
  function ghost(
    type: 'channelVolume' | 'channelFxKnob' | 'channelFxFader',
    channel: number,
  ): number | undefined {
    return $physical[physicalKey(type, channel)];
  }

  // Position within the track's loop, 0..1, or -1 when no gauge should show.
  // Strudel patterns are aligned to the global cycle grid, so a track of length
  // L beats loops whenever (absoluteBeat mod L) wraps — independent of when the
  // slot was armed. [SPEC-17.10]
  function slotProgress(slot: SlotState): number {
    if (!$showProg || !$running || !slot.playing || !slot.trackBeats) return -1;
    const L = slot.trackBeats;
    return ((($clk.beat % L) + L) % L) / L;
  }

  // Placement is active when the mode is on and a track is held. A channel is a
  // valid target only if its categories include the held track's category.
  const placingActive = $derived($placing && $held !== null);
  function authorized(ch: ChannelState): boolean {
    return placingActive && !!$held && ch.categories.includes($held.category);
  }

  // Per-channel inline association editor toggle. [SPEC-10.6]
  let editing = $state<Record<number, boolean>>({});
  function toggleEdit(id: number) {
    editing[id] = !editing[id];
  }

  function onVolume(channel: number, e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isNaN(value)) dispatch({ type: 'channelVolume', channel, value });
  }

  function onSlot(channel: number, slot: number, ch: ChannelState) {
    // In placement mode, a slot click on an authorized channel assigns the held
    // track instead of toggling playback. [SPEC-10.6]
    if (placingActive) {
      if (authorized(ch) && $held) assignSlotTrack(channel, slot, $held.id);
      return;
    }
    dispatch({ type: 'slotToggle', channel, slot });
  }

  // Per-channel effects (mirror of the nano: S = prev, M = on/off, R = next,
  // plus knob = p1 and fader = p2 of the focused effect). [SPEC-17.23/17.28]
  function onFxToggle(channel: number, effect: FxKind) {
    dispatch({ type: 'channelEffectToggle', channel, effect });
  }
  function onFxParam(channel: number, param: 'p1' | 'p2', e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isNaN(value)) {
      dispatch({ type: param === 'p1' ? 'channelFxKnob' : 'channelFxFader', channel, value });
    }
  }
</script>

<section class="panel">
  <!-- The current set's colour reaches the resting slots, so screen and APC tell
       the same story. [SPEC-20.6] -->
  <div class="rack" style="--set-color: {$setColor}">
    {#each $channels as ch (ch.id)}
      <div
        class="strip"
        class:target={authorized(ch)}
        class:dimmed={placingActive && !authorized(ch)}
      >
        <div class="head">
          <span class="num">{ch.id + 1}</span>
          <span class="cat">{ch.categories.join(', ') || '—'}</span>
          <!-- Three launch modes on ONE button, mirroring the APC's off / on /
               blink [SPEC-17.60]. The blink is drawn here too, so screen and
               hardware say the same thing. -->
          <button
            class="qz"
            class:on={ch.launch === 'quantized'}
            class:fade={ch.launch === 'fade'}
            onclick={() => dispatch({ type: 'channelModeToggle', channel: ch.id })}
            title={LAUNCH_META[ch.launch].title}
            aria-label={`Mode de lancement du canal ${ch.id + 1} : ${LAUNCH_META[ch.launch].name}`}
          >
            {LAUNCH_META[ch.launch].glyph}
          </button>
          <button
            class="edit"
            class:active={editing[ch.id]}
            onclick={() => toggleEdit(ch.id)}
            title="Éditer les associations (catégories, slots)"
            aria-label={`Éditer le canal ${ch.id + 1}`}>✎</button
          >
        </div>

        <div class="slots">
          {#each ch.slots as slot, s (s)}
            {@const prog = slotProgress(slot)}
            {@const missing = isMissingTrack(slot) && slot.codeOverride === null}
            <button
              class="slot"
              class:playing={slot.playing && !slot.pending && !placingActive}
              class:pending-start={slot.pending && !slot.playing && !placingActive}
              class:pending-stop={slot.pending && slot.playing && !placingActive}
              class:place={authorized(ch)}
              class:missing={missing && !placingActive}
              class:rest={!!slot.trackId &&
                !slot.playing &&
                !slot.pending &&
                !missing &&
                !placingActive}
              disabled={placingActive ? !authorized(ch) : !slot.trackId}
              title={placingActive
                ? authorized(ch)
                  ? 'Placer la piste ici'
                  : 'Canal non compatible'
                : missing
                  ? `Piste introuvable dans la bibliothèque : ${slot.trackId}`
                  : (slot.trackName ?? 'vide')}
              onclick={() => onSlot(ch.id, s, ch)}
            >
              <span class="slot-label">{slotLabel(s, ch.slots.length)}</span>
              <!-- Unresolved binding: show the id so the missing file is nameable. [SPEC-17.51] -->
              <span class="slot-track">{missing ? `⚠ ${slot.trackId}` : (slot.trackName ?? '—')}</span>
              {#if prog >= 0}
                <span class="slot-progress" style="width:{prog * 100}%"></span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="fader">
          <GhostSlider
            value={ch.volume}
            ghost={ghost('channelVolume', ch.id)}
            label={`Volume canal ${ch.id + 1}`}
            title="Volume — le repère ambre marque la position réelle du fader APC"
            oninput={(e) => onVolume(ch.id, e)}
          />
          <span class="vol">{Math.round(ch.volume * 100)}</span>
        </div>

        <!-- Per-channel effects, mirroring the nano: S = previous, M = on/off,
             R = next; knob = p1, fader = p2 of the focused effect. [SPEC-17.28] -->
        <div class="fx">
          <button
            class="fxnav"
            onclick={() => dispatch({ type: 'channelFxPrev', channel: ch.id })}
            title="Effet précédent (nano S)"
            aria-label="Effet précédent">◂</button
          >
          <button
            class="fxbtn"
            class:on={ch.effects[ch.fxFocus].on}
            onclick={() => dispatch({ type: 'channelFxToggle', channel: ch.id })}
            title={`${FX_META[ch.fxFocus].name} — activer/désactiver (nano M)`}
          >
            {FX_META[ch.fxFocus].name}
          </button>
          <button
            class="fxnav"
            onclick={() => dispatch({ type: 'channelFxNext', channel: ch.id })}
            title="Effet suivant (nano R)"
            aria-label="Effet suivant">▸</button
          >
        </div>
        <!-- One dot per effect: filled = active, ringed = focused. -->
        <div class="fxdots">
          {#each FX_KINDS as fx (fx)}
            <button
              class="fxdot"
              class:on={ch.effects[fx].on}
              class:focus={ch.fxFocus === fx}
              onclick={() => onFxToggle(ch.id, fx)}
              title={`${FX_META[fx].name} — clic pour activer & sélectionner`}
              aria-label={FX_META[fx].name}
            ></button>
          {/each}
        </div>
        <!-- Ghost markers: where the nano knob/fader physically sit. [SPEC-17.29]
             The readout shows the effective value — discrete params snap to
             musical steps, so the step landed on must be readable. [SPEC-17.33] -->
        <div class="fxparams">
          <div class="fxparam">
            <span>{FX_META[ch.fxFocus].p1}</span>
            <GhostSlider
              value={ch.effects[ch.fxFocus].p1}
              ghost={ghost('channelFxKnob', ch.id)}
              label={`${FX_META[ch.fxFocus].p1} canal ${ch.id + 1}`}
              title={`${FX_META[ch.fxFocus].p1} — le repère ambre marque la position réelle du knob`}
              oninput={(e) => onFxParam(ch.id, 'p1', e)}
            />
            <span class="fxval">{fxParamLabel(ch.fxFocus, 'p1', ch.effects[ch.fxFocus].p1)}</span>
          </div>
          <div class="fxparam">
            <span>{FX_META[ch.fxFocus].p2}</span>
            <GhostSlider
              value={ch.effects[ch.fxFocus].p2}
              ghost={ghost('channelFxFader', ch.id)}
              label={`${FX_META[ch.fxFocus].p2} canal ${ch.id + 1}`}
              title={`${FX_META[ch.fxFocus].p2} — le repère ambre marque la position réelle du fader`}
              oninput={(e) => onFxParam(ch.id, 'p2', e)}
            />
            <span class="fxval">{fxParamLabel(ch.fxFocus, 'p2', ch.effects[ch.fxFocus].p2)}</span>
          </div>
        </div>

        {#if editing[ch.id]}
          <ChannelEditor channel={ch} />
        {/if}
      </div>
    {/each}
  </div>

</section>

<style>
  .panel {
    background: var(--panel);
    /* Edge to edge: no side border or radius, no outer margin. [SPEC-17.2] */
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    height: 100%;
  }
  /* One column per channel; fills the full page width, wraps if narrow. */
  .rack {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.75rem;
  }
  .strip {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  /* Placement mode: highlight compatible channels, dim the rest. [SPEC-10.6] */
  .strip.target {
    border-color: var(--accent);
    box-shadow: 0 0 10px rgba(110, 231, 183, 0.25);
  }
  .strip.dimmed {
    opacity: 0.4;
  }
  .slot.place {
    border-style: dashed;
    border-color: var(--accent);
    color: var(--accent);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .num {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    color: var(--accent);
  }
  .cat {
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .qz {
    padding: 0.1rem 0.4rem;
    font-size: 0.85rem;
    flex: none;
    color: var(--muted);
  }
  .qz.on {
    color: #f0b429;
    border-color: #f0b429;
  }
  /* Fade-in mode: blinking, like the APC's button. [SPEC-17.60] */
  .qz.fade {
    color: #6ab6ff;
    border-color: #6ab6ff;
    animation: qz-blink 1s steps(2, start) infinite;
  }
  @keyframes qz-blink {
    0% {
      background: rgba(106, 182, 255, 0.28);
    }
    100% {
      background: transparent;
    }
  }
  .edit {
    padding: 0.1rem 0.4rem;
    font-size: 0.85rem;
    flex: none;
    color: var(--muted);
  }
  .edit.active {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .slots {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .slot {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-align: left;
    padding: 0.4rem 0.5rem;
    background: var(--panel);
  }
  /* Resting slot (track bound, silent, nothing pending): tinted with the current
     set's colour — the same colour the pad shows on the APC. [SPEC-20.6] The
     state rules below (.missing, .playing, .pending-*) are declared after and
     therefore keep the upper hand. */
  .slot.rest {
    border-color: color-mix(in srgb, var(--set-color) 45%, var(--border));
    background: color-mix(in srgb, var(--set-color) 9%, var(--panel));
  }
  .slot.rest .slot-label {
    color: color-mix(in srgb, var(--set-color) 70%, var(--muted));
  }
  /* Loop-progress gauge: thin bar along the bottom edge of a playing slot.
     Width is bound to the live position, so it fills over the track's length
     and snaps back to 0 at each loop. [SPEC-17.10] */
  .slot-progress {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent);
    box-shadow: 0 0 6px rgba(110, 231, 183, 0.6);
    pointer-events: none;
  }
  .slot-label {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    color: var(--muted);
    width: 1.1rem;
    flex: none;
  }
  .slot-track {
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Unresolved binding: visibly broken, not silently empty. [SPEC-17.51] */
  .slot.missing {
    border-color: var(--danger);
    background: rgba(248, 113, 113, 0.08);
  }
  .slot.missing .slot-track {
    color: var(--danger);
  }
  .slot.playing {
    border-color: var(--accent);
    background: rgba(110, 231, 183, 0.15);
    box-shadow: 0 0 8px rgba(110, 231, 183, 0.35);
  }
  .slot.playing .slot-label {
    color: var(--accent);
  }
  /* Pending = a quantized toggle scheduled but not yet applied. Blinks green if
     the slot is about to START, red if it is about to STOP. [SPEC-8.4, SPEC-17.16] */
  .slot.pending-start {
    border-color: var(--accent);
    animation: pending-start-blink 0.5s steps(2, start) infinite;
  }
  .slot.pending-start .slot-label {
    color: var(--accent);
  }
  @keyframes pending-start-blink {
    0% {
      background: rgba(110, 231, 183, 0.3);
    }
    100% {
      background: transparent;
    }
  }
  .slot.pending-stop {
    border-color: var(--danger);
    animation: pending-stop-blink 0.5s steps(2, start) infinite;
  }
  .slot.pending-stop .slot-label {
    color: var(--danger);
  }
  @keyframes pending-stop-blink {
    0% {
      background: rgba(248, 113, 113, 0.3);
    }
    100% {
      background: transparent;
    }
  }
  .fader {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .vol {
    width: 1.8rem;
    text-align: right;
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .fx {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  .fxnav {
    flex: none;
    padding: 0.2rem 0.35rem;
    font-size: 0.62rem;
    color: var(--muted);
    /* Same box for ◂ and ▸, a text presentation on both, and a size that keeps
       them readable — the small-triangle pair draws much finer than ◄ ►. */
    min-width: 1.3rem;
    font-size: 0.9rem;
    line-height: 1;
    font-variant-emoji: text;
  }
  .fxbtn {
    flex: 1;
    min-width: 0; /* full effect names must ellipsize, never widen the channel */
    padding: 0.2rem 0;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fxbtn.on {
    color: var(--accent);
    border-color: var(--accent-dim);
    background: rgba(110, 231, 183, 0.12);
  }
  /* Compact per-effect state row: filled = active, ringed = focused. */
  .fxdots {
    display: flex;
    justify-content: center;
    gap: 0.28rem;
    margin-top: 0.2rem;
  }
  .fxdot {
    width: 0.45rem;
    height: 0.45rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: transparent;
    cursor: pointer;
  }
  .fxdot.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .fxdot.focus {
    outline: 1px solid var(--muted);
    outline-offset: 1px;
  }
  .fxparams {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.2rem;
  }
  .fxparam {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.62rem;
    color: var(--muted);
  }
  .fxparam > span {
    width: 2.6rem;
    flex: none;
    font-family: ui-monospace, monospace;
  }
  /* Effective value, right-aligned like the volume readout. */
  .fxparam > span.fxval {
    width: 1.9rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
