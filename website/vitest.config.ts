import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone test config so unit tests don't load the full TanStack Start plugin stack.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
