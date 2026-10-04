#!/usr/bin/env node
/**
 * Ollama 의 모델로 Claude Code 를 띄워 이 저장소의 Photoshop MCP 서버만 붙인다.
 *
 * ```bash
 * node scripts/claude-ollama.mjs --url http://<호스트>:11434
 * node scripts/claude-ollama.mjs --url http://<호스트>:11434 -p "layer.list 를 불러 결과를 말해"
 * ```
 *
 * ## 왜 따로 띄우는가
 *
 * Ollama 는 요청이 컨텍스트 창(`/api/ps` 의 `context_length`, 기본 65536)을 넘으면
 * 앞쪽 메시지를 **조용히 자른다.** 사용자 메시지가 잘리면 `500 no user query found in
 * messages` 로 끝난다(ROADMAP §102). 이 구성에서 Claude Code 는 도구 지연 로딩을 쓰지 않고
 * 스키마를 전부 실으므로, 입력이 곧 도구 정의의 크기다.
 *
 * 평소 구성으로 부르면 입력이 약 75K 토큰 이상이다 — `~/.claude` 전역 지침(약 26K) ·
 * 내장 도구 25개(약 5.2만 자) · Photoshop 도구 102개(약 8.8만 자). 이 스크립트는
 *
 * - 설정 폴더를 비워 전역 지침을 읽지 않게 하고(`CLAUDE_CONFIG_DIR`),
 * - 내장 도구를 끄고(`--tools ""`),
 * - 이 저장소의 서버만 붙여(`--strict-mcp-config`)
 *
 * 입력을 약 32K 토큰으로 줄인다(`retouch` 프로필 · Qwen3.8 27B, Ollama 스트리밍의 추정치라
 * 실제 값과 다를 수 있다 — 그림이 든 요청은 추정이 크게 부풀려진다. ROADMAP §102).
 * Ollama 서버의 컨텍스트를 키우는 방법은 쓰지 않는다 — VRAM 과 프롬프트 처리 시간이
 * 입력 길이에 비례해 늘 뿐 낭비를 덮는 것이다.
 *
 * ## 한계
 *
 * - **파일을 읽거나 쓰는 내장 도구가 없다.** Photoshop 작업 전용이다.
 * - **Photoshop 플러그인은 서버 하나에만 붙는다.** 다른 Claude Code 세션이 이미 서버를
 *   띄워 8765 를 쥐고 있으면 이쪽 서버는 `PHOTOSHOP_NOT_CONNECTED` 를 돌려준다. 그 세션을
 *   닫고 쓴다.
 * - 지침은 서버가 주는 `instructions` 만 따른다(저장소 `CLAUDE.md` 는 읽지 않는다).
 *
 * ## 옵션
 *
 * ```text
 * --url <주소>       Ollama 주소. 생략하면 PHOTOSHOP_MCP_OLLAMA_URL. 둘 다 없으면 종료한다
 *                    (내부 주소를 저장소에 적지 않는다)
 * --model <이름>     기본 qwen3.8:27b
 * --profile <이름>   PHOTOSHOP_MCP_PROFILE. 기본 retouch
 * --allow <목록>     PHOTOSHOP_MCP_ALLOW. 생략하면 서버 기본(read,edit)
 * 그 밖의 인자        그대로 claude 에 넘긴다(-p 등)
 * ```
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const SERVER_BIN = join(ROOT, "packages/mcp-server/bin/photoshop-mcp.js");
const SERVER_DIST = join(ROOT, "packages/mcp-server/dist");
const CONFIG_DIR = join(homedir(), ".photoshop-mcp", "claude-ollama");

const fail = (message) => {
  console.error(`[claude-ollama] ${message}`);
  process.exit(1);
};

/** 값을 받는 옵션 넷만 떼어 내고 나머지는 claude 로 보낸다. */
function parseArgs(argv) {
  const options = {
    url: process.env.PHOTOSHOP_MCP_OLLAMA_URL,
    model: "qwen3.8:27b",
    profile: "retouch",
    allow: undefined,
  };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const name = arg.startsWith("--") ? arg.slice(2) : undefined;
    if (name !== undefined && name in options) {
      const value = argv[index + 1];
      if (value === undefined) fail(`${arg} 에 값이 없습니다.`);
      options[name] = value;
      index += 1;
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

/** 서버가 닿는지와 모델이 있는지를 시작 전에 본다. 안 되면 이유를 말하고 끝낸다. */
async function checkOllama(url, model) {
  let response;
  try {
    response = await Promise.race([
      fetch(`${url}/api/tags`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("5초 안에 응답이 없습니다")), 5000),
      ),
    ]);
  } catch (error) {
    fail(`Ollama(${url})에 닿지 않습니다: ${error.message}`);
  }
  if (!response.ok) fail(`Ollama(${url}) 가 ${response.status} 를 돌려줬습니다.`);
  const { models = [] } = await response.json();
  const names = models.map((entry) => entry.name);
  if (!names.includes(model)) {
    fail(`모델 ${model} 이 없습니다. 있는 모델: ${names.join(", ") || "(없음)"}`);
  }
}

function writeMcpConfig(options) {
  const env = {
    PHOTOSHOP_MCP_PROFILE: options.profile,
    // 서버는 이 폴더들을 띄운 곳 기준으로 찾으므로 절대 경로로 준다.
    PHOTOSHOP_MCP_EXTENSIONS: join(ROOT, "extensions"),
  };
  if (options.allow !== undefined) env.PHOTOSHOP_MCP_ALLOW = options.allow;
  for (const [variable, file] of [
    ["PHOTOSHOP_MCP_CAPABILITIES", "capabilities.json"],
    ["PHOTOSHOP_MCP_WORKFLOWS", "workflows.json"],
  ]) {
    if (existsSync(join(ROOT, file))) env[variable] = join(ROOT, file);
  }
  const path = join(CONFIG_DIR, "mcp.json");
  writeFileSync(
    path,
    JSON.stringify(
      { mcpServers: { photoshop: { command: "node", args: [SERVER_BIN], env } } },
      null,
      2,
    ),
  );
  return path;
}

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.url === undefined) {
    fail("Ollama 주소가 없습니다. --url 이나 PHOTOSHOP_MCP_OLLAMA_URL 로 주세요.");
  }
  const url = options.url.replace(/\/+$/, "");
  if (!existsSync(SERVER_DIST))
    fail("서버가 빌드되지 않았습니다. `npm run build` 를 먼저 실행하세요.");

  await checkOllama(url, options.model);
  mkdirSync(CONFIG_DIR, { recursive: true });
  const mcpConfig = writeMcpConfig(options);

  console.error(
    `[claude-ollama] ${options.model} @ ${url} · 프로필 ${options.profile} · 설정 폴더 ${CONFIG_DIR}`,
  );

  const child = spawn(
    "claude",
    [
      "--model",
      options.model,
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
      "--tools",
      "",
      "--allowedTools",
      "mcp__photoshop",
      ...rest,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: CONFIG_DIR,
        ANTHROPIC_BASE_URL: url,
        ANTHROPIC_AUTH_TOKEN: "ollama",
        ANTHROPIC_API_KEY: "",
        // 보조 작업이 Anthropic 모델 이름으로 나가면 Ollama 가 거절한다.
        ANTHROPIC_DEFAULT_HAIKU_MODEL: options.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
  );
  child.on("error", (error) => fail(`claude 를 실행하지 못했습니다: ${error.message}`));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

await main();
