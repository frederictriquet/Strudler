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
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
