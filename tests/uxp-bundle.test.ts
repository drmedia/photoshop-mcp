import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UXP 플러그인은 npm 의존을 가질 수 없다. (CLAUDE.md 의존 방향 규칙 6, ARCHITECTURE §11)
 *
 * UXP 샌드박스에는 `node_modules` 가 없다. 컴파일 결과에 `require("@photoshop-mcp/...")`
 * 가 남으면 모듈 로드가 실패하고 **플러그인 전체가 죽는다.** 패널이 빈 채로 열리고
 * Bridge 도 연결되지 않는다.
 *
 * 이 실패는 타입 검사에도 빌드에도 걸리지 않는다. contracts 를 값으로 import 하는 것은
 * TypeScript 에게 완벽히 정상이기 때문이다. 실제로 한 번 이렇게 깨졌다 —
 * 공용 함수를 쓰려고 `withExtension` 을 값으로 가져온 것이 원인이었다.
 *
 * 그래서 산출물을 직접 훑는다.
 */

const DIST = fileURLToPath(new URL("../photoshop-uxp/dist", import.meta.url));

/** UXP 런타임이 제공하는 모듈. 이것만 require 할 수 있다. */
const ALLOWED = new Set(["photoshop", "uxp"]);

async function collectJs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJs(path)));
    } else if (entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

/** 주석을 지운 뒤 `require("...")` 대상을 모은다. */
function requiredModules(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");

  const found: string[] = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/gu;
  let match = pattern.exec(withoutComments);
  while (match !== null) {
    if (match[1] !== undefined) {
      found.push(match[1]);
    }
    match = pattern.exec(withoutComments);
  }
  return found;
}

describe("photoshop-uxp 산출물", () => {
  it("빌드되어 있어야 이 검사가 의미가 있다", async () => {
    // dist 가 없으면 아래 검사들이 조용히 통과해 버린다.
    const files = await collectJs(DIST);
    expect(
      files.length,
      "photoshop-uxp/dist 가 비어 있습니다. npm run build 를 먼저 실행하세요.",
    ).toBeGreaterThan(5);
  });

  it("UXP 런타임 모듈 외에는 require 하지 않는다", async () => {
    const files = await collectJs(DIST);
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const request of requiredModules(source)) {
        // 상대 경로는 플러그인 안이라 괜찮다.
        if (request.startsWith(".")) {
          continue;
        }
        if (!ALLOWED.has(request)) {
          offenders.push(`${file.slice(DIST.length + 1)} → ${request}`);
        }
      }
    }

    expect(
      offenders,
      "UXP 샌드박스에는 node_modules 가 없습니다. contracts 는 타입으로만 참조하세요.",
    ).toEqual([]);
  });

  it("contracts 를 값으로 가져오지 않는다", async () => {
    // 위 검사와 겹치지만 실패했을 때 원인을 바로 가리킨다.
    const files = await collectJs(DIST);
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (requiredModules(source).some((request) => request.startsWith("@photoshop-mcp/"))) {
        offenders.push(file.slice(DIST.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});
