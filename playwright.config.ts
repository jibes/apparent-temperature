import { defineConfig, devices } from '@playwright/test';

const base = process.env.VITE_BASE && process.env.VITE_BASE !== './' ? process.env.VITE_BASE : '/';
// Local runs may point at a preinstalled Chromium; CI installs its own.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:4173${base}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
    geolocation: { latitude: 52.52, longitude: 13.4 },
    permissions: ['geolocation'],
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
