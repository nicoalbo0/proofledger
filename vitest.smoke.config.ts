import { defineConfig } from "vitest/config";

// Config for the live smoke suites (npm run smoke:*). Loads .env.test and does
// NOT exclude *.live.test.ts. Each smoke script passes the specific file to run.
export default defineConfig({
  test: {
    setupFiles: ["./test/env-setup.ts"],
  },
});
