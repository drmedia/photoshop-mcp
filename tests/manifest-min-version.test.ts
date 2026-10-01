import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * manifest 의 최소 호스트 버전이 플러그인 소스가 스스로 요구하는 하한보다 낮지
 * 않다. (ROADMAP §85)
 *
 * 소스 곳곳에 "이 Photoshop 에는 X 가 없습니다(N 이상이 필요합니다)" 거절이 있다.
 * 그 N 이 manifest 의 `minVersion` 보다 크면 **설치는 되는데 그 Tool 이 호출할
 * 때마다 실패한다** — 사용자가 설치 전에 알 길이 없는 "일부만 되는 상태"다.
 * `selection.set` 이 25.0 을 요구하는데 manifest 가 24.0 이었던 것이 이렇게
 * 드러났다.
 */

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const parse = (version: string): number[] => version.split(".").map((part) => Number(part));

const compare = (a: number[], b: number[]): number => {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** `(25.0 이상이 필요합니다)` 꼴로 소스가 스스로 밝힌 요구 버전들. */
function requiredVersions(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(root("photoshop-uxp/src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/\((\d+\.\d+) 이상이 필요/gu)) {
      const version = match[1] as string;
      found.set(version, [...(found.get(version) ?? []), file]);
    }
  }
  return found;
}

describe("manifest 최소 호스트 버전", () => {
  const manifest = JSON.parse(readFileSync(root("photoshop-uxp/manifest.json"), "utf8")) as {
    host: { app: string; minVersion: string }[];
  };
  const ps = manifest.host.find((entry) => entry.app === "PS");

  it("Photoshop 항목이 있다", () => {
    expect(ps?.minVersion).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("소스가 요구하는 어떤 버전보다도 낮지 않다", () => {
    const required = requiredVersions();
    // 정규식이 아무것도 못 찾으면 아래 검사가 헛통과한다.
    expect(required.size).toBeGreaterThan(3);

    const floor = parse(ps?.minVersion ?? "0.0.0");
    const above = [...required.keys()]
      .filter((version) => compare(parse(version), floor) > 0)
      .map((version) => `${version} ← ${(required.get(version) ?? []).length}곳`);
    expect(above).toEqual([]);
  });
});
