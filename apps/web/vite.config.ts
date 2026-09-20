import path from 'path';

import { cloudflare } from '@cloudflare/vite-plugin';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

import { generateLicensesPlugin } from './plugins/licenses-generator.ts';

const workspaceRoot = path.resolve(import.meta.dirname, '../../');

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    generateLicensesPlugin(workspaceRoot),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    cloudflare(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    visualizer(),
  ],
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              test: /node_modules\/react/,
              name: 'react',
            },
            {
              test: /node_modules\/react-dom/,
              name: 'react-dom',
            },
            {
              test: /node_modules\/@base-ui/,
              name: 'base-ui',
            },
            {
              test: /packages\/ui/,
              name: 'ui',
            },
            {
              test: /packages\/mafia/,
              name: 'mafia',
            },
            {
              test: /node_modules\/@tanstack\/(react-router|react-router-devtools|router-plugin)/,
              name: 'tanstack-router',
            },
            {
              test: /node_modules\/@tanstack\/(react-query|react-query-devtools)/,
              name: 'tanstack-query',
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@repo/mafia/client': path.resolve(import.meta.dirname, '../../packages/mafia/src/client.ts'),
    },
  },
  server: {
    proxy: {
      '/game-sessions': 'http://localhost:3000',
    },
  },
});
