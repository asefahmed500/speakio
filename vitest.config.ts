import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["proxy.test.ts", "regression.test.ts", "app/**/*.test.ts", "components/**/*.test.ts", "lib/**/*.test.ts", "stores/**/*.test.ts", "hooks/**/*.test.ts"],
    exclude: ["backend/**", "node_modules/**"],
  },
})
