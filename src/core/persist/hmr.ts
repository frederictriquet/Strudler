// [SPEC-17.31] Guard against duplicated singleton state under Vite HMR.
//
// Several modules own process-wide state: the audio engine, the channel rack, the
// clock, the stores. If such a module is hot-swapped, the new copy starts from
// scratch while the old one keeps running: the GUI subscribes to the fresh stores
// and looks frozen, yet the audio still follows the previous instance — a very
// convincing fake bug. Modules like these ask for a full page reload instead of a
// hot swap.

/** Vite's HMR context (`import.meta.hot`), which is undefined in production. */
type HotContext = ImportMeta['hot'];

/** Turn a hot update of this module into a full page reload. No-op in prod. */
export function fullReloadOnHmr(hot: HotContext): void {
  if (!hot) return;
  hot.accept(() => hot.invalidate('module owns singleton state — full reload required'));
}
