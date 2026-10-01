#!/usr/bin/env node
/**
 * 로컬 패키지 상태에서 설치 시험. (ROADMAP §99)
 *
 * ```bash
 * npm run release:build && npm run release:verify
 * npm run release:verify -- --keep D:/Dev/psmcp-local   # 시험 뒤 설치를 남겨 둔다
 * ```
 *
 * `--keep <폴더>` 는 임시 폴더 대신 그 폴더에 설치하고 지우지 않는다. 남은 설치를 MCP 클라이언트에 연결하면
 * 실제 Photoshop 과 설치본 플러그인까지 붙여 볼 수 있다(끝에 설정 예시를 출력한다). 폴더는 **비어 있거나
 * 없어야** 하고 **저장소 밖**이어야 한다 — 저장소 안이면 호이스팅 때문에 "빈 폴더에 설치" 가 아니게 된다.
 * *
 * 배포할 여섯 패키지를 `npm pack` 으로 묶고, **모노레포 밖의 빈 폴더에 설치해서** 실행한다. npm 에 올리지
 * 않고도 "사용자가 설치하면 되는가" 를 확인한다.
 *
 * 1. 압축 파일 여섯 개를 만든다.
 * 2. 빈 프로젝트에 설치한다. 레지스트리에 아직 없는 내부 패키지는 `overrides` 로 압축 파일에 연결한다.
 * 3. 설치된 `bin` 을 실행해 MCP 핸드셰이크를 한다(Mock Bridge — Photoshop 이 필요 없다).
 * 4. `doctor` 를 실행한다.
 *
 * ## 확인하지 못하는 것
 *
 * 실제 레지스트리에서 내부 패키지 이름이 풀리는지, `npx` 의 내려받기 경로는 확인하지 못한다 — 올려야만
 * 알 수 있다. 이 시험은 "올린 파일 목록이 맞고, 그 파일만으로 실행되는가" 를 닫는다.
 *
 * 서버는 셸을 거치지 않고 `node` 로 직접 띄운다. 셸을 거치면 `kill` 이 셸만 죽여 서버가 폴더를 붙든 채
 * 남고, 임시 폴더 삭제가 `EBUSY` 로 실패한다(처음 만든 스크립트에서 겪었다).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { clearTimeout, setTimeout } from "node:timers";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** [폴더, 패키지 이름] */
const PACKAGES = [
  ["command-engine", "@photoshop-mcp/command-engine"],
  ["extension-api", "@photoshop-mcp/extension-api"],
  ["mcp-core", "@photoshop-mcp/mcp-core"],
  ["mcp-server", "photoshop-mcp"],
  ["photoshop-bridge", "@photoshop-mcp/photoshop-bridge"],
  ["photoshop-tools", "@photoshop-mcp/photoshop-tools"],
];

/** 실행한 서버가 응답해야 하는 것. 개수가 아니라 이름으로 본다 — 개수는 Tool 을 더할 때마다 바뀐다. */
const REQUIRED_TOOLS = ["photoshop.ping", "photoshop.document.analyze", "photoshop.mask.summary"];

const keepIndex = process.argv.indexOf("--keep");
const keepArg = keepIndex >= 0 ? process.argv[keepIndex + 1] : undefined;
if (keepIndex >= 0 && (keepArg === undefined || keepArg.startsWith("--"))) {
  console.error(
    "❌ --keep 뒤에 폴더를 준다. 예: npm run release:verify -- --keep D:/Dev/psmcp-local",
  );
  process.exit(1);
}
const keep = keepArg === undefined ? null : resolve(keepArg);

if (keep !== null) {
  const outside = relative(ROOT, keep);
  if (outside === "" || (!outside.startsWith("..") && !isAbsolute(outside))) {
    console.error(
      `❌ 저장소 안에는 설치를 남길 수 없다: ${keep}\n   호이스팅 때문에 빈 폴더에 설치한 시험이 되지 않는다.`,
    );
    process.exit(1);
  }
  if (existsSync(keep) && readdirSync(keep).length > 0) {
    console.error(`❌ 비어 있지 않은 폴더에는 설치하지 않는다 (기존 파일을 덮지 않는다): ${keep}`);
    process.exit(1);
  }
  mkdirSync(keep, { recursive: true });
}

const work = keep ?? mkdtempSync(join(tmpdir(), "psmcp-verify-"));
let server = null;

function cleanup() {
  server?.kill();
  if (keep !== null) {
    return; // 남겨 두기로 한 설치는 지우지 않는다.
  }
  // 서버가 폴더를 놓을 때까지 잠깐 기다리며 다시 시도한다.
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

function die(message) {
  console.error(`\n❌ ${message}`);
  try {
    cleanup();
  } catch {
    console.error(`   임시 폴더가 남았다: ${work}`);
  }
  process.exit(1);
}

function run(args, cwd) {
  const result = spawnSync(npm, args, { cwd, encoding: "utf8", shell: true });
  if (result.status !== 0) {
    die(`npm ${args.join(" ")} 실패\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

const version = JSON.parse(
  readFileSync(join(ROOT, "packages/mcp-server/package.json"), "utf8"),
).version;
const tarballs = join(work, "tarballs");
const project = join(work, "project");
mkdirSync(tarballs);
mkdirSync(project);

console.log("1) npm pack × 6");
for (const [dir] of PACKAGES) {
  run(["pack", "--pack-destination", tarballs], join(ROOT, "packages", dir));
}
const tarballOf = new Map();
for (const file of readdirSync(tarballs)) {
  // 접두사만 보면 photoshop-mcp 가 범위 패키지(photoshop-mcp-…)에 모두 걸린다. 이름 전체로 맞춘다.
  const hit = PACKAGES.find(
    ([, name]) => file === `${name.replace("@", "").replace("/", "-")}-${version}.tgz`,
  );
  if (hit) {
    tarballOf.set(hit[1], join(tarballs, file).replaceAll("\\", "/"));
  }
}
for (const [, name] of PACKAGES) {
  if (!tarballOf.has(name)) {
    die(`압축 파일을 찾지 못했다: ${name}`);
  }
}

console.log("2) 빈 폴더에 설치");
const overrides = {};
for (const [, name] of PACKAGES) {
  if (name !== "photoshop-mcp") {
    overrides[name] = `file:${tarballOf.get(name)}`;
  }
}
writeFileSync(
  join(project, "package.json"),
  JSON.stringify(
    {
      name: "install-test",
      version: "1.0.0",
      private: true,
      dependencies: { "photoshop-mcp": `file:${tarballOf.get("photoshop-mcp")}` },
      overrides,
    },
    null,
    2,
  ),
);
run(["install", "--no-audit", "--no-fund"], project);
console.log("   설치 완료");

console.log("3) 설치된 bin 으로 MCP 핸드셰이크 (Mock Bridge)");
const binJs = join(project, "node_modules", "photoshop-mcp", "bin", "photoshop-mcp.js");
server = spawn(process.execPath, [binJs], {
  cwd: project,
  env: { ...process.env, PHOTOSHOP_MCP_BRIDGE: "mock" },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk) => (stderr += chunk));
const waiting = new Map();
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
    }
  }
});
const rpc = (id, method, params) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} 응답이 없다\n${stderr}`)), 20_000);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

let init;
let tools;
let prompts;
try {
  init = await rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "release-verify", version: "0" },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  tools = await rpc(2, "tools/list", {});
  prompts = await rpc(3, "prompts/list", {});
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

const names = tools.result.tools.map((tool) => tool.name);
console.log(`   서버 ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
console.log(
  `   Tool ${String(names.length)}개 · instructions ${String(String(init.result.instructions ?? "").length)}자`,
);
console.log(`   prompts: ${prompts.result.prompts.map((prompt) => prompt.name).join(", ")}`);

const missing = REQUIRED_TOOLS.filter((name) => !names.includes(name));
if (missing.length > 0) {
  die(`있어야 할 Tool 이 없다: ${missing.join(", ")}`);
}
if (String(init.result.instructions ?? "") === "") {
  die("instructions 가 비어 있다.");
}
if (!prompts.result.prompts.some((prompt) => prompt.name === "retouch")) {
  die("retouch 프롬프트가 없다.");
}

// 서버가 완전히 끝난 뒤에 doctor 를 돌려 포트 안내가 서로 섞이지 않게 한다.
{
  // 타이머가 `server` 변수가 아니라 이 시점의 자식을 잡는다. 서버가 끝나 변수를 비운 뒤에 터져도 안전하다.
  const child = server;
  await new Promise((resolve) => {
    const guard = setTimeout(() => {
      child.kill();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(guard);
      resolve();
    });
    child.stdin.end();
  });
  server = null;
}

console.log("4) doctor");
const doctor = spawnSync(process.execPath, [binJs, "doctor"], {
  cwd: project,
  env: { ...process.env, PHOTOSHOP_MCP_BRIDGE: "mock" },
  encoding: "utf8",
});
console.log(`   종료 코드 ${String(doctor.status)}`);
if (doctor.status !== 0) {
  die(`doctor 가 실패했다.\n${doctor.stdout}\n${doctor.stderr}`);
}

try {
  cleanup();
} catch {
  console.warn(`⚠️  임시 폴더를 지우지 못했다: ${work}`);
}
console.log(
  "\n✅ 설치한 패키지로 MCP 핸드셰이크 성공 (npm 레지스트리 이름 해석은 확인하지 못한다)",
);

if (keep !== null) {
  const bin = binJs.replaceAll("\\", "/");
  console.log(`\n설치를 남겼다: ${keep}`);
  console.log(
    [
      "MCP 클라이언트에 이 설치본을 연결하면 실제 Photoshop 으로 시험할 수 있다:",
      "",
      `  claude mcp add photoshop-local -- node "${bin}"`,
      "",
      "또는 .mcp.json:",
      `  { "mcpServers": { "photoshop-local": { "command": "node", "args": ["${bin}"] } } }`,
      "",
      "저장소의 서버와 같은 포트 범위(8765–8774)를 쓰므로, 같은 클라이언트에 둘을 함께 붙이지 않는다.",
      "(CLAUDE.md: 한 클라이언트에 같은 Tool 을 가진 서버를 둘 붙이면 어느 쪽으로 보낼지 알 수 없다)",
    ].join("\n"),
  );
}
