// [SPEC-18.3] Entry point of the composition workshop — a separate document from
// the instrument, so it gets its own AudioContext and cannot be reached by a
// stray click during a set. No Service Worker here: sample caching belongs to the
// performance page.
import '../app.css';
import { restoreFromDiskIfEmpty, requestPersistentStorage } from '@core/persist/backup';

// [SPEC-13.8] Same ordering as the instrument: `composerStore` restores the draft
// while its module is evaluated, so the disk copy must land first — hence the
// dynamic import below.
void (async () => {
  await restoreFromDiskIfEmpty();
  void requestPersistentStorage();

  const { mount } = await import('svelte');
  const Composer = (await import('./Composer.svelte')).default;

  mount(Composer, { target: document.getElementById('composer')! });
})();
