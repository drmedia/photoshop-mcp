#!/usr/bin/env node
// 최소 CLI launcher. 컴파일하지 않는다.
// 비즈니스 로직 · Tool 등록 · Command Engine 구성은 여기에 두지 않는다.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = new URL("../dist/run.js", import.meta.url);

if (!existsSync(fileURLToPath(entry))) {
  console.error("[photoshop-mcp] 빌드 산출물이 없습니다. 먼저 npm run build 를 실행하세요.");
  process.exit(1);
}

const { main } = await import(entry.href);

await main();
