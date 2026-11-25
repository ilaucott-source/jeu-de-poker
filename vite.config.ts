import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // Application installable et jouable sans connexion : tout est mis en cache à la première visite
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // on garde public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,mp3,woff2,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
})
