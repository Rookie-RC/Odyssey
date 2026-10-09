import { defineConfig } from "vitest/config";

// Unit tests for the pure domain layer (lib/) and theme contracts (themes/).
// Components are verified in the running app; these guard the derivations the
// whole UI relies on.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
