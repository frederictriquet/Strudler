<script lang="ts">
  // [SPEC-10.6, SPEC-5.2/5.3/5.4] Live association editor for one channel:
  // reassign its categories (0..n) and bind a track to each slot. Changes apply
  // immediately without interrupting playback.
  import type { ChannelState } from '@core/channels/types';
  import { slotLabel } from '@core/channels/types';
  import { categories, tracksForCategories, trackLabel } from '@stores/libraryStore';
  import { assignChannelCategories, assignSlotTrack } from '@stores/rackStore';

  const { channel }: { channel: ChannelState } = $props();

  // Tracks selectable for this channel's slots (from its categories), plus any
  // already-bound track whose category is no longer assigned (so it stays shown).
  const options = $derived.by(() => {
    const list = tracksForCategories(channel.categories);
    const ids = new Set(list.map((t) => t.id));
    const extras = channel.slots
      .map((s) => s.trackId)
      .filter((id): id is string => !!id && !ids.has(id));
    return { list, extras };
  });

  function toggleCategory(cat: string, checked: boolean) {
    const next = checked
      ? [...channel.categories, cat]
      : channel.categories.filter((c) => c !== cat);
    assignChannelCategories(channel.id, next);
  }

  function onSlotSelect(slotIndex: number, e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    assignSlotTrack(channel.id, slotIndex, value || null);
  }
</script>

<div class="editor">
  <div class="block">
    <span class="blabel">Catégories</span>
    <div class="cats">
      {#each categories as cat (cat)}
        <label class="cat">
          <input
            type="checkbox"
            checked={channel.categories.includes(cat)}
            onchange={(e) => toggleCategory(cat, (e.currentTarget as HTMLInputElement).checked)}
          />
          {cat}
        </label>
      {/each}
    </div>
  </div>

  <div class="block">
    <span class="blabel">Slots → pistes</span>
    {#each channel.slots as slot, s (s)}
      <label class="slot-edit">
        <span class="slot-key">{slotLabel(s, channel.slots.length)}</span>
        <select value={slot.trackId ?? ''} onchange={(e) => onSlotSelect(s, e)}>
          <option value="">— vide —</option>
          {#each options.extras as id (id)}
            <option value={id}>{trackLabel(id)} (hors catégorie)</option>
          {/each}
          {#each options.list as track (track.id)}
            <option value={track.id}>{track.name}</option>
          {/each}
        </select>
      </label>
    {/each}
  </div>
</div>

<style>
  .editor {
    margin-top: 0.5rem;
    padding: 0.6rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    background: rgba(255, 255, 255, 0.02);
  }
  .blabel {
    display: block;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  .cats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.7rem;
  }
  .cat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
  }
  .cat input {
    accent-color: var(--accent);
  }
  .slot-edit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }
  .slot-key {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    color: var(--muted);
    width: 1.2rem;
    flex: none;
  }
  select {
    flex: 1;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.35rem;
    font: inherit;
    font-size: 0.8rem;
  }
</style>
