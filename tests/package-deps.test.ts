import { builtinModules } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 배포하는 패키지가 import 하는 외부 패키지는 `dependencies` 에 선언돼 있어야 한다. (ROADMAP §99)
 *
 * 모노레포에서는 호이스팅 때문에 선언하지 않아도 import 가 풀린다. 그래서 개발 중에는 아무 문제가 없는데,
 * npm 에서 설치한 사용자의 환경에서는 풀리지 않을 수 있다("유령 의존성"). 실제로 `mcp-core` 가 `zod` 를,
 * 실행 패키지 `photoshop-mcp` 가 `@photoshop-mcp/photoshop-tools` 를 선언하지 않은 채 import 하고 있었다.
 *
 * 소스(`.ts`)를 훑는다 — `dist` 는 빌드 순서에 의존하고, 타입만 import 하는 것도 `.d.ts` 를 쓰는 사용자에게는
 * 필요하기 때문에 `import type` 도 센다.
 */

const PACKAGES = [
  "command-engine",
  "extension-api",
  "mcp-core",
  "mcp-server",
  "photoshop-bridge",
  "photoshop-tools",
];

const BUILTINS = new Set(builtinModules);

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

/** `from "x"` · `import("x")` · `import "x"` 의 `x`. */
function specifiers(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /^import\s+["']([^"']+)["']/gmu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[1] as string);
    }
  }
  return [...found];
}

/** 외부 패키지 이름. 상대 경로 · `node:` · 내장 모듈은 `null`. */
function packageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
  return BUILTINS.has(name) ? null : name;
}

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("배포 패키지의 의존성 선언", () => {
  for (const pkg of PACKAGES) {
    it(`${pkg}: import 하는 외부 패키지가 모두 dependencies 에 있다`, () => {
      const manifest = JSON.parse(
        readFileSync(root(`packages/${pkg}/package.json`), "utf8"),
      ) as Manifest;
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);

      const used = new Map<string, string>();
      for (const file of walk(root(`packages/${pkg}/src`))) {
        for (const specifier of specifiers(readFileSync(file, "utf8"))) {
          const name = packageName(specifier);
          if (name !== null && name !== manifest.name && !used.has(name)) {
            used.set(name, file.slice(root("").length));
          }
        }
      }

      const missing = [...used.keys()].filter((name) => !declared.has(name)).sort();
      expect(
        missing,
        `선언하지 않은 import: ${missing.map((name) => `${name} (${used.get(name) ?? ""})`).join(", ")}`,
      ).toEqual([]);
    });
  }

  it("**bin 파일도 본다** — 실행 패키지의 launcher 가 import 하는 것", () => {
    const manifest = JSON.parse(
      readFileSync(root("packages/mcp-server/package.json"), "utf8"),
    ) as Manifest;
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const source = readFileSync(root("packages/mcp-server/bin/photoshop-mcp.js"), "utf8");
    for (const specifier of specifiers(source)) {
      const name = packageName(specifier);
      if (name !== null) {
        expect(declared.has(name), `bin/photoshop-mcp.js 가 ${name} 를 import 한다`).toBe(true);
      }
    }
  });
});
