import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Register the sample-cache Service Worker (offline samples). Failure is
// non-fatal — the app runs without it, just without offline sample caching.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch((err) => console.warn('[sw] enregistrement échoué:', err));
}

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
