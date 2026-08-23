<script lang="ts">
  // [SPEC-20.10] Dense set bar: one single line above the rack. Colour dot, name,
  // ⟳N badge, current set framed in its own colour. Transport stopped, the very
  // same line carries editing (＋, ✕, move arrows, in-place rename, colour picker); while
  // playing those affordances are disabled with their reason in a tooltip
  // [SPEC-20.7]. No modal, no scroll [SPEC-17.2].
  import {
    padSets,
    foreignPlaying,
    setsEditable,
    dispatch,
    addPadSet,
    removePadSet,
    movePadSet,
    renamePadSet,
    recolorPadSet,
  } from '@stores/rackStore';
  import {
    SET_COLORS,
    SET_PALETTE,
    MAX_SETS,
    type SetColor,
    type SetSummary,
  } from '@core/channels/sets';

  const sets = padSets;
  const foreign = foreignPlaying;
  const editable = setsEditable;

  const LOCK = 'Édition verrouillée pendant la lecture (STOP pour éditer)';

  // Index of the set whose colour picker is open, or null. A single popover at a
  // time: two open menus on one dense line would overlap.
  let colorMenu = $state<number | null>(null);
  // Index of the set being renamed in place (double-click on its name).
  let renaming = $state<number | null>(null);
  let draft = $state('');

  /** Total loops running outside the current set. [SPEC-20.5] */
  const foreignTotal = $derived($foreign.reduce((n, f) => n + f.count, 0));
  const foreignNames = $derived($foreign.map((f) => f.name).join(', '));

  function select(index: number) {
    // Switching is always allowed, even while playing. [SPEC-20.4]
    dispatch({ type: 'setSelect', index });
  }

  function toggleColorMenu(e: MouseEvent, s: SetSummary) {
    // Keep the opening click away from the window listener that closes the menu.
    e.stopPropagation();
    if (!$editable) {
      // Locked: the dot still leads to its set rather than doing nothing.
      select(s.index);
      return;
    }
    colorMenu = colorMenu === s.index ? null : s.index;
  }

  function pickColor(index: number, color: SetColor) {
    colorMenu = null;
    recolorPadSet(index, color);
  }

  function startRename(s: SetSummary) {
    if (!$editable) return;
    colorMenu = null;
    renaming = s.index;
    draft = s.name;
  }

  function commitRename(s: SetSummary) {
    if (renaming === null) return; // already committed (Enter, then blur)
    renaming = null;
    const next = draft.trim();
    if (next === '' || next === s.name) return; // nothing to send
    renamePadSet(s.index, next);
  }

  function onRenameKey(e: KeyboardEvent, s: SetSummary) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(s);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renaming = null; // cancel: nothing is sent
    }
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape') colorMenu = null;
  }

  /** Why this set cannot be deleted, or null when it can. [SPEC-20.8] */
  function deleteReason(s: SetSummary): string | null {
    if (s.deletable) return null;
    if (s.assigned > 0) return `Set non vide (${s.assigned} pad(s) associé(s)) — le vider d'abord`;
    return 'Dernier set — le rack doit toujours en avoir un';
  }

  /** Autofocus + select the rename field so typing replaces the old name. */
  function autoselect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<svelte:window onclick={() => (colorMenu = null)} onkeydown={onWindowKey} />

<section class="panel">
  <div class="bar">
    <span class="label">Sets</span>

    {#each $sets as s (s.id)}
      <div class="set" class:active={s.active} style="--c: {s.hex}">
        <!-- Colour dot: opens the compact palette when editing is allowed. [SPEC-20.6] -->
        <button
          class="dot"
          onclick={(e) => toggleColorMenu(e, s)}
          title={$editable ? `Couleur — ${SET_PALETTE[s.color].label}` : LOCK}
          aria-label={`Couleur du set ${s.name}`}
        ></button>

        {#if renaming === s.index}
          <input
            class="rename"
            bind:value={draft}
            use:autoselect
            onkeydown={(e) => onRenameKey(e, s)}
            onblur={() => commitRename(s)}
            onclick={(e) => e.stopPropagation()}
            aria-label={`Nom du set ${s.name}`}
          />
        {:else}
          <button
            class="name"
            onclick={() => select(s.index)}
            ondblclick={() => startRename(s)}
            title={s.active
              ? $editable
                ? 'Set courant — double-clic pour renommer'
                : `Set courant — ${LOCK}`
              : `Passer au set « ${s.name} »`}
          >
            {s.name}
          </button>
        {/if}

        {#if s.playing > 0}
          <!-- Clicking the badge leads to the set: it is the only place from
               which those loops can be stopped. [SPEC-20.5] -->
          <button
            class="badge"
            onclick={() => select(s.index)}
            title={s.active
              ? `${s.playing} loop(s) en cours`
              : `${s.playing} loop(s) en cours dans ce set — il faut y revenir pour les couper`}
          >
            ⟳{s.playing}
          </button>
        {/if}

        <!-- Editing acts on the current set only: on a stage instrument, the
             densest line wins over per-set button clutter. [SPEC-20.10] -->
        {#if s.active}
          <button
            class="mv prev"
            disabled={!$editable || s.index === 0}
            onclick={() => movePadSet(s.index, -1)}
            title={!$editable ? LOCK : s.index === 0 ? 'Déjà en première position' : 'Déplacer à gauche'}
            aria-label="Déplacer le set à gauche"
          ></button>
          <button
            class="mv next"
            disabled={!$editable || s.index === $sets.length - 1}
            onclick={() => movePadSet(s.index, 1)}
            title={!$editable
              ? LOCK
              : s.index === $sets.length - 1
                ? 'Déjà en dernière position'
                : 'Déplacer à droite'}
            aria-label="Déplacer le set à droite"
          ></button>
          <button
            class="del"
            disabled={!$editable || !s.deletable}
            onclick={() => removePadSet(s.index)}
            title={!$editable ? LOCK : (deleteReason(s) ?? `Supprimer « ${s.name} »`)}
            aria-label={`Supprimer le set ${s.name}`}>✕</button
          >
        {/if}

        {#if colorMenu === s.index}
          <div class="menu">
            {#each SET_COLORS as c (c)}
              <button
                class="sw"
                class:sel={c === s.color}
                style="--sc: {SET_PALETTE[c].hex}"
                onclick={() => pickColor(s.index, c)}
                title={SET_PALETTE[c].label}
                aria-label={SET_PALETTE[c].label}
              ></button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    <button
      class="add"
      disabled={!$editable || $sets.length >= MAX_SETS}
      onclick={addPadSet}
      title={!$editable
        ? LOCK
        : $sets.length >= MAX_SETS
          ? `Maximum atteint (${MAX_SETS} sets)`
          : 'Ajouter un set'}
      aria-label="Ajouter un set">＋</button
    >

    <!-- Sound with no lit pad would be inexplicable: say it, and lead there. [SPEC-20.5] -->
    {#if $foreign.length > 0}
      <button
        class="alert"
        onclick={() => select($foreign[0].index)}
        title={`Ces loops ne s'arrêtent que depuis leur set — clic pour y aller (${foreignNames})`}
      >
        ⟳ {foreignTotal} loop(s) d'un autre set en cours ({foreignNames})
      </button>
    {/if}
  </div>
</section>

<style>
  .panel {
    background: var(--panel);
    /* Edge to edge, minimal height: this line must not eat the rack. [SPEC-17.2] */
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 0.2rem 0.75rem;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .label {
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 0.15rem;
  }
  /* A vignette: colour dot + name + badge (+ editing on the current set). */
  .set {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.05rem 0.2rem;
    border: 1px solid transparent;
    border-radius: 7px;
  }
  /* Non-current vignettes stay chrome-less; hovering shows they are clickable. */
  .set:not(.active):hover {
    border-color: color-mix(in srgb, var(--c) 40%, transparent);
  }
  /* The current set is unambiguously framed in its own colour. [SPEC-20.10] */
  .set.active {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    box-shadow: 0 0 6px color-mix(in srgb, var(--c) 35%, transparent);
  }
  /* All vignette buttons share the same compact, chrome-less base. Every rule
     below keeps the same specificity (`.set .x`) so the order decides. */
  .set button {
    padding: 0.1rem 0.3rem;
    font-size: 0.72rem;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .set .dot {
    width: 0.72rem;
    height: 0.72rem;
    flex: none;
    padding: 0;
    border-radius: 50%;
    background: var(--c);
    border: 1px solid color-mix(in srgb, var(--c) 60%, #000);
  }
  .set .name {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .set.active .name {
    color: var(--text);
  }
  .rename {
    width: 7rem;
    font: inherit;
    font-size: 0.72rem;
    padding: 0.05rem 0.25rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--c);
    border-radius: 6px;
  }
  /* Loops running in this set — the only handle on them. [SPEC-20.5] */
  .set .badge {
    font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .set .mv,
  .set .del {
    font-size: 0.62rem;
    padding: 0.1rem 0.22rem;
    border-color: var(--border);
  }
  /* Arrows DRAWN in CSS rather than typed as characters. Two reasons, both
     measured on this bar: `►` (U+25BA) falls back to a colour-emoji glyph on
     macOS while `◄` does not, so the pair came from two different fonts and did
     not mirror; and the non-emoji pair that fixes that (`◂ ▸`) is drawn far too
     small to read on stage. A border triangle is exactly symmetric, sized here,
     and follows `currentColor` — so hover and :disabled keep working. [SPEC-20.10] */
  .set .mv {
    width: 1.25rem;
    height: 1.15rem;
    padding: 0;
    position: relative;
  }
  .set .mv::before {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 0;
    height: 0;
    border-style: solid;
    border-color: transparent;
  }
  .set .mv.prev::before {
    border-width: 0.32rem 0.36rem 0.32rem 0;
    border-right-color: currentColor;
  }
  .set .mv.next::before {
    border-width: 0.32rem 0 0.32rem 0.36rem;
    border-left-color: currentColor;
  }
  /* The triangle follows currentColor, so brightening the text is the hover cue. */
  .set .mv:hover:not(:disabled) {
    color: var(--text);
  }
  .set .del:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
  }
  .add {
    padding: 0.1rem 0.35rem;
    font-size: 0.72rem;
    color: var(--muted);
  }
  /* Compact palette, overlaying the rack rather than pushing the line down. */
  .menu {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    z-index: 20;
    display: flex;
    gap: 0.2rem;
    padding: 0.25rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }
  .menu .sw {
    width: 0.85rem;
    height: 0.85rem;
    padding: 0;
    border-radius: 50%;
    background: var(--sc);
    border: 1px solid color-mix(in srgb, var(--sc) 60%, #000);
  }
  .menu .sw.sel {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .alert {
    margin-left: auto;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    color: #f0b429;
    border-color: rgba(240, 180, 41, 0.45);
    background: rgba(240, 180, 41, 0.1);
  }
</style>
