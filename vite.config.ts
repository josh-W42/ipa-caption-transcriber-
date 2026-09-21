import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react()],
  test: {
    // Web Audio and WebGPU do not exist in jsdom, so tests run in a real browser.
    // Vitest 5 takes the provider as an imported object, not a string.
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
});
