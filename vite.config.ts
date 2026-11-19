import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { downloaderPlugin } from './src/downloaderPlugin.ts';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), downloaderPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'three/addons': path.resolve(__dirname, 'node_modules/three/examples/jsm'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          tool: path.resolve(__dirname, 'tool.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
