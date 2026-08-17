// [SPEC-18.3] Entry point of the composition workshop — a separate document from
// the instrument, so it gets its own AudioContext and cannot be reached by a
// stray click during a set. No Service Worker here: sample caching belongs to the
// performance page.
import { mount } from 'svelte';
import Composer from './Composer.svelte';
import '../app.css';

const app = mount(Composer, {
  target: document.getElementById('composer')!,
});

export default app;
