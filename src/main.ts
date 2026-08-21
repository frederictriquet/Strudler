import './app.css';
import { restoreFromDiskIfEmpty, requestPersistentStorage } from '@core/persist/backup';

// Register the sample-cache Service Worker (offline samples). Failure is
// non-fatal — the app runs without it, just without offline sample caching.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch((err) => console.warn('[sw] enregistrement échoué:', err));
}

// [SPEC-13.8] Rescue a blank browser BEFORE any store is imported: `rackStore`
// reads its keys while its module is being evaluated, so a later restore would
// arrive after the rack has already been rebuilt from nothing. Hence the DYNAMIC
// import of App below — a static one would evaluate the whole store graph first.
//
// An async IIFE rather than top-level await: the build target (`modules`) has no
// TLA, and raising it for two lines of startup ordering would change how every
// chunk is emitted.
void (async () => {
  await restoreFromDiskIfEmpty(); // never throws; the outcome is announced by backupStore
  void requestPersistentStorage(); // exempt this origin from eviction [SPEC-13.6]

  const { mount } = await import('svelte');
  const App = (await import('./App.svelte')).default;

  mount(App, { target: document.getElementById('app')! });
})();
