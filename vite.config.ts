import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        manifest: {
          name: 'Inventario Alpha',
          short_name: 'Inventario',
          description: 'Sistema de Control de Inventario Premium',
          theme_color: '#0a0a0a',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/(productos|cajas|almacen|conceptos|verificar)/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 24 * 60 * 60 // 24 hours
                },
                networkTimeoutSeconds: 5
              }
            },
            {
              urlPattern: /^\/api\/productos\/\d+\/image/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'product-images-cache',
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
                }
              }
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Optimize for production
      target: 'ES2020',
      minify: 'esbuild' as const,
      sourcemap: false,
      rollupOptions: {
        output: {
          // Code splitting strategy
          manualChunks: {
            'react-deps': ['react', 'react-dom'],
            'ui-components': ['lucide-react', 'motion'],
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
