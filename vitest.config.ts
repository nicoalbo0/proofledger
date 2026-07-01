import { configDefaults, defineConfig } from "vitest/config";

// Default run (npm test, CI): fast + hermetic. Live smoke suites are excluded
// here so they never fire during a normal test run — even when .env.test holds
// credentials. Run them explicitly via `npm run smoke:*` (vitest.smoke.config.ts).
export default defineConfig({
  test: {
    setupFiles: ["./test/env-setup.ts"],
    exclude: [...configDefaults.exclude, "**/*.live.test.ts"],
  },
});
