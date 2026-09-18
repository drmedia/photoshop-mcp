#!/usr/bin/env node
/**
 * 살아 있는 배선 확인 — 실제 MCP 클라이언트 ↔ stdio ↔ Photoshop.
 *
 * ```bash
 * npm run build && npm run verify:live
 * ```
 *
 * ## 이 스크립트가 하는 일과 하지 않는 일
 *
 * **한다** — bin launcher 가 뜨는지, stdio 전송에 로그가 섞이지 않는지, 환경변수가
 * 실제로 적용되는지, Photoshop 에 닿는지, Resource 가 읽히는지.
 *
 * **하지 않는다** — Tool 목록이나 개수 검증. 그것은 `tests/core-api-doc.test.ts` 와
 * `tests/helpers/expected-tools.ts` 가 한다. 여기에 개수를 박아 두면 Tool 을 추가할
 * 때마다 두 곳을 고쳐야 하고, 빠뜨리면 조용히 틀린 값이 남는다. 실제로 그렇게
 * "Core Tool 46개" 가 문서 세 곳에 퍼진 적이 있다.
 *
 * ## 왜 `npm test` 에 넣지 않는가
 *
 * Photoshop 과 UXP 플러그인이 있어야 한다. CI 에서 돌 수 없고, 없으면 실패가 아니라
 * **확인 불가**다. 자동 테스트가 환경에 따라 빨강이 되면 아무도 안 본다.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const LAUNCHER = fileURLToPath(
  new URL("../packages/mcp-server/bin/photoshop-mcp.js", import.meta.url),
);
/** Photoshop 플러그인은 지수 백오프로 재접속한다. 서버를 막 띄웠으면 30초 가까이 걸린다. */
const CONNECT_TIMEOUT_MS = 60_000;

const results = [];
const check = (label, pass, detail = "") => {
  results.push({ label, pass });
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [LAUNCHER],
  env: {
    ...process.env,
    PHOTOSHOP_MCP_BRIDGE: "uxp",
    // destructive 를 일부러 뺀다. 권한 경계가 프로세스 밖에서도 서는지 본다.
    PHOTOSHOP_MCP_ALLOW: "read,edit,external",
  },
  stderr: "pipe",
});

const client = new Client({ name: "verify-live", version: "0.0.0" });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const payload = (result) => JSON.parse(result.content[0].text);

let serverLog = "";

try {
  await client.connect(transport);
  transport.stderr?.on("data", (chunk) => {
    serverLog += chunk.toString("utf8");
  });

  // --- 1. 서버가 떴고 MCP 규약을 지키는가 ---------------------------------
  const { tools } = await client.listTools();
  check("tools/list 응답", tools.length > 0, `${tools.length}개`);
  check(
    "모든 Tool 이 설명과 입력 스키마를 가진다",
    tools.every((tool) => tool.description && tool.inputSchema),
  );

  const { resources } = await client.listResources();
  check("resources/list 응답", resources.length > 0, `${resources.length}개`);

  // --- 2. Photoshop 에 닿는가 ---------------------------------------------
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let connected = false;
  while (!connected && Date.now() < deadline) {
    connected = payload(
      await client.callTool({ name: "photoshop.ping", arguments: {} }),
    ).bridgeConnected;
    if (!connected) await wait(1000);
  }
  check("photoshop.ping — Bridge 연결", connected);

  if (connected) {
    // --- 3. 실제 데이터가 오는가 ------------------------------------------
    const document = payload(
      await client.callTool({ name: "photoshop.document.get", arguments: {} }),
    );
    check(
      "document.get — 실제 문서 정보",
      typeof document.name === "string" && document.width > 0,
      `${document.name} ${document.width}x${document.height} ${document.bitDepth}bit`,
    );

    const active = payload(
      await client.callTool({ name: "photoshop.layer.get_active", arguments: {} }),
    );
    // layer 는 layers[0] 이어야 한다. 어긋나면 편집 Tool 이 무엇을 건드릴지
    // 잘못 알려준다. 실기에서 실제로 어긋난 적이 있다.
    check(
      "layer.get_active — layer == layers[0]",
      active.layer === null ? active.layers.length === 0 : active.layer.id === active.layers[0]?.id,
      `선택 ${active.layers.length}개`,
    );

    // --- 4. Resource 가 Tool 과 같은 상태를 보는가 -------------------------
    const read = await client.readResource({ uri: "photoshop://document/current" });
    check(
      "resources/read — Tool 과 같은 문서",
      JSON.parse(read.contents[0].text).name === document.name,
    );
  }

  // --- 5. 권한 경계가 프로세스 밖에서도 서는가 -----------------------------
  // PHOTOSHOP_MCP_ALLOW 에 destructive 가 없다. 거부되어야 한다.
  const denied = await client.callTool({
    name: "photoshop.workspace.delete",
    arguments: { filenames: ["존재하지-않는-파일.tif"] },
  });
  check("destructive 는 허용 목록 밖이라 거부된다", denied.isError === true);

  // --- 6. stdout 오염 ------------------------------------------------------
  // 여기까지 JSON-RPC 가 모두 파싱됐다 = stdout 에 로그가 섞이지 않았다.
  // 한 줄이라도 새면 위 호출 중 하나에서 파싱 오류가 났을 것이다.
  check("stdout 이 JSON-RPC 전용 (로그는 stderr)", true);
} catch (error) {
  check(`예외: ${error?.message ?? String(error)}`, false);
} finally {
  await client.close().catch(() => {});
}

const failed = results.filter((entry) => !entry.pass);
if (failed.length > 0) {
  console.log("\n--- 서버 stderr ---");
  console.log(serverLog.trim() || "(출력 없음)");
  console.log(`\n${failed.length}개 실패`);
  process.exit(1);
}

console.log(`\n${results.length}개 모두 통과`);
process.exit(0);
