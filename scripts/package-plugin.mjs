#!/usr/bin/env node
/**
 * UXP 플러그인을 `.ccx` 로 묶는다.
 *
 * ```bash
 * npm run build && npm run package:plugin
 * ```
 *
 * ## 왜 스테이징 폴더가 필요한가
 *
 * `uxp plugin package` 는 플러그인 폴더를 통째로 압축하고 제외 옵션이 없다.
 * `photoshop-uxp/` 를 그대로 주면 `src/` · 소스맵 · `.d.ts` · `.uxprc` 가 함께
 * 들어간다 — 실행에 필요한 것은 `manifest.json` · `icons/` · `dist/*.js` 뿐이다.
 * 그래서 임시 폴더에 그것만 복사해 놓고 그 폴더를 묶는다.
 *
 * ## UXP CLI
 *
 * 이 저장소의 의존성에 넣지 않았다(photoshop-uxp/README.md). 설치 위치는
 * `UXP_CLI` 환경 변수로 준다. 기본값은 이 기기의 `D:\Dev\uxp-cli` 다.
 *
 * 결과는 `photoshop-uxp/out/` 에 나온다(`.gitignore` 대상).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = fileURLToPath(new URL("../photoshop-uxp/", import.meta.url));
const OUT_DIR = join(PLUGIN_DIR, "out");
const UXP_JS = join(
  process.env.UXP_CLI ?? "D:/Dev/uxp-cli",
  "node_modules/@adobe/uxp-devtools-cli/src/uxp.js",
);

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

if (!existsSync(UXP_JS)) {
  fail(
    `UXP CLI 를 찾지 못했다: ${UXP_JS}\n` +
      "   설치법은 photoshop-uxp/README.md 의 'UXP DevTools CLI' 에 있다. " +
      "설치 위치는 UXP_CLI 환경 변수로 준다.",
  );
}
if (!existsSync(join(PLUGIN_DIR, "dist/index.js"))) {
  fail("photoshop-uxp/dist 가 없다. 먼저 `npm run build` 를 한다.");
}

/** 실행에 필요한 `.js` 만 고른다. 소스맵 · `.d.ts` · `.tsbuildinfo` 는 뺀다. */
const wanted = (path) => {
  if (statSync(path).isDirectory()) {
    return true;
  }
  return path.endsWith(".js");
};

const staging = mkdtempSync(join(tmpdir(), "photoshop-mcp-ccx-"));
try {
  cpSync(join(PLUGIN_DIR, "manifest.json"), join(staging, "manifest.json"));
  cpSync(join(PLUGIN_DIR, "icons"), join(staging, "icons"), { recursive: true });
  cpSync(join(PLUGIN_DIR, "dist"), join(staging, "dist"), {
    recursive: true,
    filter: wanted,
  });

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [UXP_JS, "plugin", "package", "--outputPath", OUT_DIR],
    { cwd: staging, stdio: "inherit" },
  );
  if (result.status !== 0) {
    fail(`uxp plugin package 가 실패했다 (종료 코드 ${String(result.status)})`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const ccx = readdirSync(OUT_DIR).filter((name) => name.endsWith(".ccx"));
if (ccx.length === 0) {
  fail("출력 폴더에 .ccx 가 없다.");
}
for (const name of ccx) {
  const kb = Math.round(statSync(join(OUT_DIR, name)).size / 1024);
  console.log(`✅ ${join(OUT_DIR, name)} (${String(kb)}KB)`);
}
