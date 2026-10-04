import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 문서에 적힌 Core Tool 개수가 레지스트리와 같다. (ROADMAP §90)
 *
 * 개수가 README 두 벌 · CLAUDE.md · CORE_API 에 손으로 적혀 있어서 Tool 을 더할 때마다 어긋났다
 * (metadata.get 이 들어간 뒤 161 이 남았던 것이 §89 에서 드러났다). 이 테스트가 맞지 않는 곳을 알려
 * 주므로 외우지 않아도 된다.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge(), logger: createSilentLogger() });
const actual = mcp.tools.list().filter((tool) => tool.name.startsWith("photoshop.")).length;

/** [문서, 개수를 말하는 문장을 잡는 식]. 식의 첫 그룹이 숫자다. */
const MENTIONS: [string, RegExp][] = [
  ["README.md", /(\d+) core tools and 6 resources/u],
  ["README_KO.md", /Core Tool (\d+)개, Resource 6개\. Extension/u],
  ["README_KO.md", /Core Tool (\d+)개, Resource 6개가 \*\*Mock Bridge\*\*/u],
  ["CLAUDE.md", /Core Tool \*\*(\d+)개\*\* · Resource 6개/u],
  ["CLAUDE.md", /Core Tool (\d+)개가/u],
  // `CLAUDE.md` 에서 옮겨 간 현장 노트. 같은 문장이 거기에도 있어 따로 지켜야 어긋나지 않는다.
  ["docs/FIELD_NOTES.md", /Core Tool \*\*(\d+)개\*\* · Resource 6개/u],
  ["docs/FIELD_NOTES.md", /Core Tool (\d+)개가/u],
  ["docs/CORE_API.md", /## 4\. 구현된 Core API \((\d+)개\)/u],
  ["docs/CORE_API.md", /\| 구현됨 \| \*\*(\d+)\*\* \|/u],
];

describe("문서의 Core Tool 개수", () => {
  it("레지스트리에 Tool 이 있다", () => {
    expect(actual).toBeGreaterThan(100);
  });

  for (const [path, pattern] of MENTIONS) {
    it(`${path}: ${String(pattern)}`, () => {
      const match = pattern.exec(read(path));
      expect(
        match,
        `${path} 에서 개수를 말하는 문장을 찾지 못했다 — 문장을 바꿨으면 이 표도 고친다`,
      ).not.toBeNull();
      expect(
        Number(match?.[1]),
        `${path} 가 ${match?.[1] ?? "?"}개라고 적었다 (레지스트리는 ${actual}개)`,
      ).toBe(actual);
    });
  }
});
