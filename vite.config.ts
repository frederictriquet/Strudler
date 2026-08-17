import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { soundsServer } from './vite-plugins/soundsServer';

// [SPEC-14.1] Web MIDI target: Chrome / Edge.
export default defineConfig({
  plugins: [svelte(), soundsServer()],
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
    port: 5173,
    open: false,
  },
});
