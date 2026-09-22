import { PROTOCOL_VERSION, SERVER_VERSION } from "@photoshop-mcp/photoshop-bridge";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 버전이 여러 곳에 박혀 있다. 하나만 올리면 조용히 어긋난다. (ROADMAP §18.0)
 *
 * `npm version --workspaces` 는 `package.json` 만 고친다. **매니페스트와 코드
 * 안의 상수는 따라오지 않는다** — 어긋나면 핸드셰이크가 거짓 버전을 실어
 * 보내고, 그걸 잡아 주는 것이 없었다.
 *
 * 내부 의존 핀도 같이 본다. `"@photoshop-mcp/mcp-core": "0.1.0"` 이 남아 있는데
 * 패키지만 올리면 **설치가 깨진다.**
 */

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const json = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(root(path), "utf8")) as Record<string, unknown>;

/** 기준은 bin 을 가진 패키지다 — 사용자가 설치하는 것이 그것이다. */
const EXPECTED = json("packages/mcp-server/package.json")["version"] as string;

/** 워크스페이스의 모든 package.json. */
const PACKAGES = [
  "package.json",
  "packages/command-engine/package.json",
  "packages/extension-api/package.json",
  "packages/mcp-core/package.json",
  "packages/mcp-server/package.json",
  "packages/photoshop-bridge/package.json",
  "packages/photoshop-tools/package.json",
  "extensions/example-extension/package.json",
  "extensions/graxpert/package.json",
  "extensions/rcastro/package.json",
  "extensions/starnet/package.json",
  "photoshop-uxp/package.json",
];

describe("package.json", () => {
  it("**전부 같은 버전이다** — 함께 올린다", () => {
    for (const path of PACKAGES) {
      expect(json(path)["version"], path).toBe(EXPECTED);
    }
  });

  it("**내부 의존 핀도 같다** — 어긋나면 설치가 깨진다", () => {
    for (const path of PACKAGES) {
      const deps = (json(path)["dependencies"] ?? {}) as Record<string, string>;
      for (const [name, range] of Object.entries(deps)) {
        if (name.startsWith("@photoshop-mcp/")) {
          expect(range, `${path} → ${name}`).toBe(EXPECTED);
        }
      }
    }
  });
});

describe("package.json 밖", () => {
  it("**UXP manifest** — `npm version` 이 안 고치는 곳이다", () => {
    expect(json("photoshop-uxp/manifest.json")["version"]).toBe(EXPECTED);
  });

  it("**플러그인이 핸드셰이크로 보내는 버전**", () => {
    /* `photoshop-uxp/src/index.ts` 는 import 할 수 없다 — 읽는 순간
     * `entrypoints.setup()` 이 돌고 UXP 런타임이 없으면 던진다. 그래서
     * 소스에서 뽑아 본다. */
    const source = readFileSync(root("photoshop-uxp/src/index.ts"), "utf8");
    const line = /const PLUGIN = \{[^}]*\};/u.exec(source)?.[0];
    expect(line, "PLUGIN 선언을 찾지 못했습니다").toBeDefined();

    const version = /version:\s*"([^"]+)"/u.exec(line as string)?.[1];
    expect(version).toBe(EXPECTED);
  });

  it("**서버가 핸드셰이크로 보내는 버전**", () => {
    expect(SERVER_VERSION).toBe(EXPECTED);
  });
});

describe("프로토콜 버전은 따로다", () => {
  it("**제품 버전과 함께 움직이지 않는다**", () => {
    /* 프로토콜은 메시지 규약이 바뀔 때만 오른다. 제품 버전을 따라 올리면
     * 옛 플러그인이 붙지 못하는 이유가 "메시지가 달라서" 가 아니라
     * "숫자가 달라서" 가 된다. 섞이지 않게 타입부터 다르다. */
    expect(typeof PROTOCOL_VERSION).toBe("number");
    expect(String(PROTOCOL_VERSION)).not.toBe(EXPECTED);
  });
});
