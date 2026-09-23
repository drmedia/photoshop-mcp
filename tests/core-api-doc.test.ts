import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `docs/CORE_API.md` 가 실제 레지스트리와 맞는지 검사한다.
 *
 * 이 테스트가 없는 동안 문서가 실제로 썩었다. Tool 이 13개 늘고 Permission 이 세 개
 * 바뀌었는데 문서는 그대로였고, 아무것도 깨지지 않아 아무도 몰랐다.
 *
 * 문서는 `.prettierignore` 에 있어 형식 검사도 지나간다. 사람이 읽기 전까지
 * 틀린 것을 알려주는 장치가 하나도 없었다. 그래서 여기에 둔다.
 *
 * 검사 대상은 **사실**뿐이다 — 어떤 API 가 있고 Permission 이 무엇인가.
 * 우선순위(P0–P3)나 설명 문장은 판단이라 검사하지 않는다.
 */

const DOC = fileURLToPath(new URL("../docs/CORE_API.md", import.meta.url));

/** 구현 목록을 담은 절. 후보 절과 섞이면 안 되므로 경계를 명시적으로 자른다. */
const IMPLEMENTED_HEADING = "## 4. 구현된 Core API";
const CANDIDATE_HEADING = "## 5. 후보 API";

/** `| \`photoshop.x.y\` | READ | …` 형태의 표 행. */
const ROW = /\|\s*`(photoshop\.[a-z_.]+)`\s*\|\s*(READ|EDIT|EXTERNAL|DESTRUCTIVE)\s*\|/gu;

function section(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to);
  expect(start, `${from} 절을 찾을 수 없습니다`).toBeGreaterThanOrEqual(0);
  expect(end, `${to} 절을 찾을 수 없습니다`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** `name → permission` 으로 읽는다. 표에 적힌 대로. */
function parse(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, permission] of text.matchAll(ROW)) {
    expect(found.has(name as string), `문서에 ${String(name)} 이 두 번 있습니다`).toBe(false);
    found.set(name as string, (permission as string).toLowerCase());
  }
  return found;
}

/** 실제로 등록되는 Tool. 권한을 모두 열어야 DESTRUCTIVE 까지 보인다. */
function registered(): Map<string, string> {
  const mcp = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
  });
  return new Map(mcp.tools.list().map((tool) => [tool.name, tool.permission]));
}

describe("docs/CORE_API.md", () => {
  it("구현 목록이 레지스트리와 정확히 같다", async () => {
    const text = await readFile(DOC, "utf8");
    const documented = parse(section(text, IMPLEMENTED_HEADING, CANDIDATE_HEADING));
    const actual = registered();

    // 이름을 먼저 본다. 개수만 맞고 내용이 다를 수 있다.
    expect([...documented.keys()].sort()).toEqual([...actual.keys()].sort());
  });

  it("**절 제목의 개수가 표의 행 수와 같다**", async () => {
    /* 이 검사가 없는 동안 헤더가 두 번 어긋났다. 표에 한 줄을 더하면서
     * 헤더는 원래 값에 1 을 더했는데, 그 원래 값이 이미 하나 틀려 있었다.
     * 실기에서 `photoshop.diagnostics` 의 `registry.tools` 와 안 맞아 들켰다.
     *
     * 이름·Permission 은 아래 검사가 잡지만 **개수는 아무도 안 봤다.** */
    const text = await readFile(DOC, "utf8");
    const documented = parse(section(text, IMPLEMENTED_HEADING, CANDIDATE_HEADING));
    const heading = /## 4\. 구현된 Core API \((\d+)개\)/u.exec(text);
    expect(heading, "§4 제목에서 개수를 읽지 못했습니다").not.toBeNull();
    expect(Number((heading as RegExpExecArray)[1])).toBe(documented.size);
  });

  it("구현 목록의 Permission 이 실제 선언과 같다", async () => {
    const text = await readFile(DOC, "utf8");
    const documented = parse(section(text, IMPLEMENTED_HEADING, CANDIDATE_HEADING));
    const actual = registered();

    // Permission 이 틀린 문서는 없느니만 못하다. 안전 경계를 잘못 알려준다.
    const wrong = [...actual].filter(([name, permission]) => documented.get(name) !== permission);
    expect(wrong).toEqual([]);
  });

  it("후보 목록에 이미 구현된 이름이 없다", async () => {
    // 같은 API 가 양쪽에 있으면 어느 쪽이 사실인지 알 수 없다.
    const text = await readFile(DOC, "utf8");
    const candidates = parse(text.slice(text.indexOf(CANDIDATE_HEADING)));
    const actual = registered();

    const overlap = [...candidates.keys()].filter((name) => actual.has(name));
    expect(overlap).toEqual([]);
  });

  it("Phase 를 기준으로 삼지 않는다", async () => {
    // Phase 의 유일한 기준은 ROADMAP 이다. 여기에 Phase 열이 생기면
    // 두 문서가 같은 낱말에 다른 뜻을 담게 되고, 실제로 그렇게 어긋났다.
    const text = await readFile(DOC, "utf8");
    const header = /\|\s*(?:API|이름)\s*\|[^\n]*\bPhase\b/iu;
    expect(header.test(text)).toBe(false);
  });
});
