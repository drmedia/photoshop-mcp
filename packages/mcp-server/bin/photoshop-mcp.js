#!/usr/bin/env node
// 최소 CLI launcher. 컴파일하지 않는다.
// 비즈니스 로직 · Tool 등록 · Command Engine 구성은 여기에 두지 않는다.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 하위 명령은 **진입점을 고르는 것까지만** 여기서 한다. 판정과 출력은 src 에 있다.
const SUBCOMMANDS = { doctor: "../dist/doctor.js", init: "../dist/init.js" };

const command = process.argv[2];
const module = SUBCOMMANDS[command] ?? "../dist/run.js";
const entry = new URL(module, import.meta.url);

if (!existsSync(fileURLToPath(entry))) {
  console.error("[photoshop-mcp] 빌드 산출물이 없습니다. 먼저 npm run build 를 실행하세요.");
  process.exit(1);
}

const { main } = await import(entry.href);

await main();
