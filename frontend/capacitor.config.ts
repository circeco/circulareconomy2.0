import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.circeco.app',
  appName: 'Circeco',
  webDir: 'dist/frontend/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
