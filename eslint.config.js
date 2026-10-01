import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "photoshop-uxp/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  {
    // 실행 스크립트. Node 전역을 쓰고 결과를 사람이 읽도록 stdout 에 찍는다.
    // 서버가 아니므로 stdout 을 MCP 전송이 점유하지 않는다.
    files: ["**/bin/**", "scripts/**"],
    languageOptions: {
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        // Node 22 의 전역. 스냅샷 갱신(api-coverage.mjs --refresh)이 쓴다.
        fetch: "readonly",
      },
    },
    rules: { "no-console": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
);
