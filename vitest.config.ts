import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** 워크스페이스 패키지를 빌드 없이 소스로 해석한다. */
const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@photoshop-mcp/photoshop-bridge": pkg("photoshop-bridge"),
      "@photoshop-mcp/command-engine": pkg("command-engine"),
      "@photoshop-mcp/mcp-core": pkg("mcp-core"),
      "@photoshop-mcp/photoshop-tools": pkg("photoshop-tools"),
      "@photoshop-mcp/extension-sdk": pkg("extension-sdk"),
      "@photoshop-mcp/mcp-server": pkg("mcp-server"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
