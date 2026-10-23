import type { CapacitorConfig } from '@capacitor/cli';

// Bundle the same frontend into Android and iOS. The app connects to the
// shared backend using VITE_API_URL; no server.url means the WebView does not
// load a separate hosted frontend.
const config: CapacitorConfig = {
  appId: 'com.atg.traders',
  appName: 'ATG Traders',
  webDir: 'dist',
};

export default config;
