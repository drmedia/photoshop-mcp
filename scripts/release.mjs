#!/usr/bin/env node
/**
 * npm 배포 전 점검. (ROADMAP §99)
 *
 * ```bash
 * npm run release:build   # 배포할 여섯 패키지의 dist 를 지우고 처음부터 다시 빌드
 * npm run release:check   # 낡은 파일 · 불필요한 파일 · 내용 확인 (npm pack --dry-run)
 * node scripts/release.mjs check <패키지>   # 하나만. 각 패키지의 prepublishOnly 가 부른다
 * ```
 *
 * ## 왜 필요한가
 *
 * `dist/` 는 gitignore 대상이고 `tsc -b` 는 **소스가 사라져도 옛 산출물을 지우지 않는다.** 배포할 여섯 패키지
 * 중 세 곳의 `dist` 에 지운 소스의 컴파일 결과(탐침 `*.tmp.js` 넷 포함)가 남아 있었고, 패키지가
 * `files: ["dist"]` 라 그대로 npm 에 실릴 뻔했다. 올린 버전은 지워도 같은 번호를 다시 쓸 수 없다.
 *
 * `build` 는 이 스크립트를 **명시적으로 부를 때만** 지운다 — 배포 전에 한 번 하는 작업이고, 사용자의 다른
 * 폴더는 건드리지 않는다(`packages/*` 의 `dist` 만).
 *
 * `check` 는 아무것도 바꾸지 않는다. 문제가 있으면 비정상 종료한다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { staleOutputs } from "./dist-outputs.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 배포하는 패키지. 번들된 Extension · `photoshop-uxp` 는 npm 에 올리지 않는다. */
const PACKAGES = [
  "command-engine",
  "extension-api",
  "mcp-core",
  "mcp-server",
  "photoshop-bridge",
  "photoshop-tools",
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

function build() {
  for (const name of PACKAGES) {
    rmSync(join(ROOT, "packages", name, "dist"), { recursive: true, force: true });
  }
  console.log(`dist 를 지웠다 (${String(PACKAGES.length)}개 패키지). 처음부터 빌드한다…`);
  const result = spawnSync(npm, ["run", "build"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    fail("빌드가 실패했다.");
  }
  console.log("✅ 빌드 완료");
}

/** `npm pack --dry-run --json` 으로 실제로 올라갈 파일 목록을 얻는다. */
function packList(name) {
  const result = spawnSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: join(ROOT, "packages", name),
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) {
    fail(`${name}: npm pack 이 실패했다.\n${result.stderr}`);
  }
  // npm 이 JSON 앞에 경고를 붙일 수 있다. 첫 '[' 부터 읽는다.
  const text = result.stdout.slice(result.stdout.indexOf("["));
  return JSON.parse(text)[0];
}

function check(only) {
  let problems = 0;
  const targets = only === undefined ? PACKAGES : [only];
  if (only !== undefined && !PACKAGES.includes(only)) {
    fail(`배포 대상이 아닌 패키지: ${only} (${PACKAGES.join(" · ")})`);
  }
  for (const name of targets) {
    const dir = join(ROOT, "packages", name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

    if (!existsSync(join(dir, "dist"))) {
      console.error(`❌ ${manifest.name}: dist 가 없다. 먼저 npm run release:build`);
      problems += 1;
      continue;
    }

    const stale = staleOutputs(join(dir, "dist"), join(dir, "src"));
    if (stale.length > 0) {
      problems += stale.length;
      console.error(`❌ ${manifest.name}: 소스가 없는 낡은 산출물 ${String(stale.length)}개`);
      for (const file of stale) {
        console.error(`     - dist/${file}`);
      }
    }

    const packed = packList(name);
    const paths = packed.files.map((file) => file.path);
    const unwanted = paths.filter(
      (path) =>
        path.startsWith("src/") ||
        path.startsWith("tests/") ||
        path.endsWith(".tsbuildinfo") ||
        path.endsWith(".tmp.js") ||
        path.endsWith(".tmp.d.ts"),
    );
    if (unwanted.length > 0) {
      problems += unwanted.length;
      console.error(`❌ ${manifest.name}: 올라가면 안 되는 파일`);
      for (const file of unwanted) {
        console.error(`     - ${file}`);
      }
    }

    const kb = (packed.size / 1024).toFixed(0);
    console.log(
      `${stale.length === 0 && unwanted.length === 0 ? "✅" : "⚠️ "} ${manifest.name}@${manifest.version}  ` +
        `${String(paths.length)}개 파일 · ${kb}KB (압축)`,
    );
  }
  if (problems > 0) {
    fail(`점검 실패: 문제 ${String(problems)}건. npm run release:build 로 처음부터 다시 빌드한다.`);
  }
  console.log("\n✅ 배포 점검 통과 (낡은 파일 · 불필요한 파일 없음)");
}

const mode = process.argv[2];
if (mode === "build") {
  build();
} else if (mode === "check") {
  check(process.argv[3]);
} else {
  fail("사용법: node scripts/release.mjs build|check");
}
