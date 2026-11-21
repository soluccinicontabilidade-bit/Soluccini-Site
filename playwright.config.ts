import { defineConfig, devices } from "@playwright/test";

// Roda contra um servidor já no ar (E2E_URL), com o banco de demonstração.
// Ex.: E2E_URL=http://127.0.0.1:3000 E2E_EMAIL=admin@soluccini.local E2E_SENHA=... npm run test:e2e
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: process.env.E2E_URL ?? "http://127.0.0.1:3000", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
