/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const build = {
  sha: (() => {
    try {
      return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      return 'dev';
    }
  })(),
  time: new Date().toISOString(),
};

// The only services the app talks to (README → Privacy).
const API_HOSTS = ['https://api.open-meteo.com', 'https://nominatim.openstreetmap.org'];

// CSP for the production build only: the dev server injects inline scripts
// (React refresh) that a strict policy would block.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          `connect-src 'self' ${API_HOSTS.join(' ')}`,
          "worker-src 'self'",
          "manifest-src 'self'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; '),
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(build) },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
  plugins: [
    react(),
    csp,
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registerSW() in UpdateBanner drives the update banner
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Gefühlte Temperatur · Apparent Temperature',
        short_name: 'Gefühlt',
        description: 'Gefühlte Temperatur (UTCI) mit Sonne, Wind und Lüftungsempfehlung.',
        lang: 'de',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#0d0f18',
        background_color: '#0d0f18',
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Weather + geocoding: fresh when online, fall back to cache offline.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('open-meteo.com') || url.hostname.endsWith('openstreetmap.org'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
