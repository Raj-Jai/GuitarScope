import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(async () => {
  // LAN/phone testing needs HTTPS (microphone requires a secure context;
  // plain http://<lan-ip> is insecure so mediaDevices is undefined).
  // Enable with: HTTPS=1 npm run dev:https  (or npm run dev:lan)
  // The self-signed cert triggers a browser warning on first visit —
  // accept/continue to reach the app. Desktop `npm run dev` stays on HTTP.
  const useHttps = process.env.HTTPS === '1'
  return {
    plugins: [
      react(),
      ...(useHttps ? [(await import('@vitejs/plugin-basic-ssl')).default()] : []),
    ],
    server: {
      host: true, // expose LAN interface so the phone can reach the laptop
      https: useHttps ? {} : undefined,
    },
    build: {
      // AudioWorklet modules MUST be emitted as separate files: addModule()
      // with an inlined data: URL is unreliable across browsers.
      assetsInlineLimit: 0,
    },
  }
})
