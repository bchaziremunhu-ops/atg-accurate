import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true binds 0.0.0.0 so phones/tablets on the same Wi-Fi can reach
    // the app. API + realtime traffic is proxied to the local API server, so
    // LAN devices only ever need this one URL (Vite prints it on startup).
    //
    // 5273 is used instead of Vite's default 5173 because another project on
    // this machine also serves 5173, which made the LAN address hit the wrong
    // app. strictPort keeps the URL predictable.
    //
    // The proxy pins 127.0.0.1 (not `localhost`): another project on this
    // machine listens on ::1:4000, and `localhost` resolves to ::1 first —
    // which sent this app's API traffic to the other server.
    host: true,
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true },
    },
  },
});
