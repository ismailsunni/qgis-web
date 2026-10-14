import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the built app. Set BASE_URL to test a running server instead,
 * and CHROME_PATH to use an installed Chrome/Chromium.
 */
const external = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: external ?? "http://localhost:4173/",
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: external
    ? undefined
    : { command: "npm run build && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173/", reuseExistingServer: !process.env.CI, timeout: 300_000 },
});
