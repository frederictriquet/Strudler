import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { soundsServer } from './vite-plugins/soundsServer';
import { stateBackup } from './vite-plugins/stateBackup';

// [SPEC-14.1] Web MIDI target: Chrome / Edge.
export default defineConfig({
  plugins: [svelte(), soundsServer(), stateBackup()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@stores': resolve(__dirname, 'src/stores'),
      '@lib': resolve(__dirname, 'src/lib'),
      '@composer': resolve(__dirname, 'src/composer'),
    },
  },
  build: {
    rollupOptions: {
      // Two documents, not two apps: the composition workshop is a SEPARATE page
      // so it gets its own AudioContext and cannot be reached by a stray click
      // during a set. [SPEC-18.3]
      input: {
        main: resolve(__dirname, 'index.html'),
        composer: resolve(__dirname, 'composer.html'),
      },
    },
  },
  server: {
    // The whole persisted state hangs off the ORIGIN. Vite's default is to slide
    // to the next free port, which silently moves the app to `:5174` and shows a
    // blank instrument — then lets you build a second, competing state there.
    // Failing loudly is the right behaviour: the port is already taken by the
    // instance that owns the data. [SPEC-13.6]
    host: 'localhost',
    port: 5173,
    strictPort: true,
    open: false,
    watch: {
      // The state mirror writes here every couple of seconds; it is data, not source.
      ignored: ['**/.state/**'],
    },
  },
  preview: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
