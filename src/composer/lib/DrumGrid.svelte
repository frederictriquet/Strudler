<script lang="ts">
  // [SPEC-18.10] Drum grid — the workshop's only bidirectional editor.
  //
  // The read-only branch is the important one: when `analyzeDrumGrid` cannot
  // read the pattern, this shows WHY and offers nothing to write [SPEC-14.3].
  // Rewriting a half-understood pattern would destroy the user's work silently,
  // which is exactly what the spec forbids.
  //
  // Beat lines are drawn every `steps / 4` columns because one cycle is four
  // beats [SPEC-18.8]: without them a 16-step grid is an undifferentiated row,
  // and knowing where beat 2 falls is what a beginner is missing.
  import {
    analyzeDrumGrid,
    addSound,
    isValidSound,
    removeSound,
    renameSound,
    serializeDrumGrid,
    setCycles,
    cyclesFit,
    gridBeats,
    setSteps,
    stepsPerBeat,
    MAX_GRID_CYCLES,
    toggleCell,
    willLoseHits,
    type DrumGrid,
  } from '@core/composer/drumGrid';

  interface Props {
    pattern: string;
    onchange: (pattern: string) => void;
    /** Longueur déclarée de la piste, en beats — pour proposer d'y aligner la
     *  grille. La grille ne s'aligne JAMAIS d'elle-même : le code reste la source
     *  de vérité [SPEC-18.32]. */
    beats?: number | null;
  }
  let { pattern, onchange, beats = null }: Props = $props();

  let newSound = $state('');
  /** Refused edit, shown in the component itself rather than only in the console. */
  let problem = $state<string | null>(null);

  // The grid we last wrote, kept alongside the text it produced. Re-reading our
  // own output would drop a row the user added but has not filled yet (an empty
  // row carries no sound name), so while the text still matches, ours wins.
  // Everything stays DERIVED — no effect — so the first render is already right.
  let mine = $state<DrumGrid | null>(null);
  let mineText = $state('');

  const analysis = $derived(analyzeDrumGrid(pattern));
  const grid = $derived(mine !== null && mineText === pattern ? mine : analysis.grid);
  const reason = $derived(grid === null ? analysis.reason : null);

  const blank = $derived(pattern.trim() === '');
  const perBeat = $derived(grid ? stepsPerBeat(grid.steps, grid.cycles) : null);
  const loopBeats = $derived(grid ? gridBeats(grid) : null);
  /** Longueurs proposées, en beats : un cycle vaut 4 temps. [SPEC-18.32] */
  const BEAT_CHOICES = Array.from({ length: MAX_GRID_CYCLES }, (_, i) => (i + 1) * 4);
  /** La piste déclare une autre longueur que la grille : on le dit, sans agir. */
  const mismatch = $derived(
    grid && typeof beats === 'number' && beats > 0 && beats % 4 === 0 && beats !== gridBeats(grid)
      ? beats
      : null,
  );
  const columns = $derived(grid ? Array.from({ length: grid.steps }, (_, i) => i) : []);

  const STEP_CHOICES = [4, 8, 12, 16, 24, 32, 48, 64];
  /** Enough to start without opening the sound browser. */
  const COMMON_SOUNDS = ['bd', 'sd', 'cp', 'hh', 'oh', 'rs', 'perc'];

  function commit(next: DrumGrid): void {
    const text = serializeDrumGrid(next);
    mine = next;
    mineText = text;
    onchange(text);
  }

  function changeSteps(steps: number): void {
    if (!grid) return;
    if (
      willLoseHits(grid, steps) &&
      !confirm(`Passer à ${steps} pas supprimera les frappes qui ne tombent plus sur un pas. Continuer ?`)
    ) {
      return;
    }
    commit(setSteps(grid, steps));
  }

  /** Étendre ou réduire la grille à `n` temps, à durée de pas constante. */
  function changeBeats(nextBeats: number): void {
    if (!grid) return;
    const cycles = Math.round(nextBeats / 4);
    if (!cyclesFit(grid, cycles)) {
      problem = `${nextBeats} temps à cette résolution dépasseraient les pas affichables — baisse « Pas » d'abord.`;
      return;
    }
    problem = null;
    commit(setCycles(grid, cycles));
  }

  function add(sound: string): void {
    if (!grid) return;
    const next = addSound(grid, sound);
    if (next === grid) {
      problem = grid.sounds.includes(sound.trim())
        ? `« ${sound.trim()} » est déjà une ligne de la grille.`
        : `« ${sound.trim()} » n’est pas un nom de son (lettres, chiffres, « _ », « - », et « :indice »).`;
      return;
    }
    problem = null;
    newSound = '';
    commit(next);
  }

  /** A refused rename must not stay on screen as if it had been taken
   *  [SPEC-14.3]: the field is put back and the reason is shown. */
  function rename(row: number, value: string, field: HTMLInputElement): void {
    if (!grid) return;
    const next = renameSound(grid, row, value);
    if (next === grid) {
      problem = !isValidSound(value)
        ? `« ${value.trim()} » n’est pas un nom de son (lettres, chiffres, « _ », « - », et « :indice »).`
        : `« ${value.trim()} » est déjà une autre ligne : les deux fusionneraient.`;
      field.value = grid.sounds[row];
      return;
    }
    problem = null;
    commit(next);
  }

  /** Start from an empty 16-step grid — only offered when there is nothing to
   *  lose, i.e. the pattern is blank. */
  function startBlank(): void {
    commit({
      sounds: ['bd'],
      steps: 16,
      cycles: 1,
      cells: [new Array<boolean>(16).fill(false)],
      call: 's',
      suffix: '',
    });
  }
</script>

<div class="drumgrid">
  {#if grid}
    <div class="toolbar">
      <label>
        Pas
        <select value={grid.steps} onchange={(e) => changeSteps(Number(e.currentTarget.value))}>
          {#each STEP_CHOICES as n (n)}
            <option value={n}>{n}</option>
          {/each}
          {#if !STEP_CHOICES.includes(grid.steps)}
            <option value={grid.steps}>{grid.steps}</option>
          {/if}
        </select>
      </label>
      <label>
        Temps
        <select value={loopBeats} onchange={(e) => changeBeats(Number(e.currentTarget.value))}>
          {#each BEAT_CHOICES as b (b)}
            <option value={b}>{b}</option>
          {/each}
        </select>
      </label>
      <span class="hint">
        {#if perBeat}
          {perBeat} pas par temps · {loopBeats} temps
        {:else}
          {grid.steps} pas — ne se divise pas en {loopBeats} temps
        {/if}
      </span>
      <label class="add">
        Ajouter un son
        <input
          value={newSound}
          list="drumgrid-sounds"
          placeholder="hh"
          oninput={(e) => (newSound = e.currentTarget.value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(newSound);
            }
          }}
        />
      </label>
      <datalist id="drumgrid-sounds">
        {#each COMMON_SOUNDS as s (s)}
          <option value={s}></option>
        {/each}
      </datalist>
      <button class="add-btn" disabled={newSound.trim() === ''} onclick={() => add(newSound)}>+</button>
    </div>

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="corner"></th>
            {#each columns as step (step)}
              <th class:beat={perBeat !== null && step % perBeat === 0}>
                {perBeat !== null && step % perBeat === 0 ? step / perBeat + 1 : ''}
              </th>
            {/each}
            <th class="corner"></th>
          </tr>
        </thead>
        <tbody>
          {#each grid.sounds as sound, row (row)}
            <tr>
              <th class="name">
                <input value={sound} onchange={(e) => rename(row, e.currentTarget.value, e.currentTarget)} />
              </th>
              {#each columns as step (step)}
                <td class:beat={perBeat !== null && step % perBeat === 0}>
                  <button
                    class="cell"
                    class:on={grid.cells[row][step]}
                    aria-label={`${sound}, pas ${step + 1}`}
                    aria-pressed={grid.cells[row][step]}
                    onclick={() => grid && commit(toggleCell(grid, row, step))}
                  ></button>
                </td>
              {/each}
              <td class="corner">
                <button
                  class="remove"
                  title="Retirer ce son"
                  aria-label={`Retirer ${sound}`}
                  onclick={() => grid && commit(removeSound(grid, row))}>×</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if mismatch !== null}
      <!-- Jamais d'alignement automatique : ouvrir un outil ne doit pas réécrire
           le pattern. On énonce l'écart et on l'offre. [SPEC-18.32] -->
      <p class="hint">
        La piste déclare <strong>{mismatch} temps</strong>, la grille en couvre {loopBeats}.
        <button class="align" onclick={() => changeBeats(mismatch)}>
          Étendre la grille à {mismatch} temps
        </button>
      </p>
    {/if}
    {#if problem}
      <p class="bad">{problem}</p>
    {/if}
    {#if grid.sounds.length === 0}
      <p class="hint">Aucun son : ajoutez-en un pour commencer à poser des frappes.</p>
    {/if}
    {#if grid.suffix}
      <p class="hint">
        Effets conservés tels quels : <code>{grid.suffix}</code>
      </p>
    {/if}
  {:else if blank}
    <div class="empty">
      <p>Aucun pattern. La grille peut en écrire un.</p>
      <button onclick={startBlank}>Grille vierge (16 pas)</button>
    </div>
  {:else}
    <!-- [SPEC-18.10] Read-only rather than rewrite what we did not fully read. -->
    <div class="readonly">
      <p class="title">Grille en lecture seule</p>
      <p>La grille ne sait pas relire ce pattern : {reason}.</p>
      <p class="sub">
        Elle ne réécrira rien pour ne pas altérer votre code. Sont éditables : un seul
        <code>s("…")</code>, avec <code>~</code>, <code>*n</code>, <code>[…]</code>,
        <code>!n</code>, <code>:n</code> et des lignes séparées par des virgules — les effets
        chaînés (<code>.gain(…)</code>, <code>.speed(…)</code>) sont conservés.
      </p>
    </div>
  {/if}
</div>

<style>
  .drumgrid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .toolbar {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .add input {
    width: 6rem;
  }
  .add-btn {
    padding: 0.25rem 0.5rem;
  }
  .hint {
    margin: 0;
    font-size: 0.7rem;
    color: var(--muted);
    padding-bottom: 0.3rem;
  }
  .align {
    margin-left: 0.4rem;
    padding: 0.1rem 0.4rem;
    font-size: 0.72rem;
  }
  .bad {
    margin: 0;
    font-size: 0.72rem;
    color: var(--danger);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    padding: 0;
    border: 0;
  }
  thead th {
    height: 0.9rem;
    font-size: 0.6rem;
    font-weight: 400;
    color: var(--muted);
    text-align: left;
    padding-left: 0.1rem;
  }
  /* Beat boundaries: the one landmark a beginner needs. 1 cycle = 4 beats. */
  thead th.beat,
  tbody td.beat {
    border-left: 1px solid var(--accent-dim);
  }
  th.name input {
    width: 5.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    padding: 0.1rem 0.25rem;
  }
  .cell {
    display: block;
    width: 1.15rem;
    height: 1.15rem;
    margin: 1px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--panel);
    cursor: pointer;
  }
  .cell:hover {
    border-color: var(--accent-dim);
  }
  .cell.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .remove {
    padding: 0 0.3rem;
    margin-left: 0.25rem;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.2;
  }
  .remove:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
  .empty,
  .readonly {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    font-size: 0.75rem;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .empty p,
  .readonly p {
    margin: 0 0 0.25rem;
  }
  .readonly {
    border-color: var(--accent-dim);
  }
  .readonly .title {
    color: var(--accent);
    font-weight: 600;
  }
  .readonly .sub {
    color: var(--muted);
    margin-bottom: 0;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--accent);
  }
  input,
  select {
    font: inherit;
    font-size: 0.8rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
  }
</style>
