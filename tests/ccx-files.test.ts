import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — 순수 JS 모듈이라 타입 선언이 없다. scripts/api-coverage.mjs 를 시험하는 쪽과 같다.
import { selectOutputs } from "../scripts/ccx-files.mjs";

/**
 * `.ccx` 에 담을 산출물을 고르는 규칙. (ROADMAP §98)
 *
 * `dist/` 는 gitignore 대상이고 `tsc -b` 는 소스가 사라져도 옛 산출물을 지우지 않는다. 한동안 쓰다 지운
 * 탐침(`*-probe.tmp.ts`)의 컴파일 결과가 그대로 `.ccx` 에 실려 배포될 뻔했다.
 */

let root: string;
let src: string;
let dist: string;

function put(base: string, path: string): void {
  const full = join(base, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, "// fixture\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ccx-files-"));
  src = join(root, "src");
  dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("selectOutputs", () => {
  it("소스가 있는 산출물은 담고, 소스가 사라진 산출물은 낡은 것으로 가른다", () => {
    put(src, "index.ts");
    put(src, "dom/layers.ts");
    put(dist, "index.js");
    put(dist, "dom/layers.js");
    put(dist, "dom/text-probe.tmp.js"); // 지운 탐침
    put(dist, "dom/document-save.js"); // 이름이 바뀐 모듈의 옛 결과

    const { keep, stale } = selectOutputs(dist, src);

    expect(keep).toEqual(["dom/layers.js", "index.js"]);
    expect(stale).toEqual(["dom/document-save.js", "dom/text-probe.tmp.js"]);
  });

  it("**낡은 것은 조용히 빼지 않고 이름을 돌려준다** — dist 가 낡았다는 것을 호출자가 보이게 한다", () => {
    put(src, "a.ts");
    put(dist, "a.js");
    put(dist, "gone.js");
    expect(selectOutputs(dist, src).stale).toEqual(["gone.js"]);
  });

  it("소스맵 · .d.ts · tsbuildinfo 는 대상이 아니다", () => {
    put(src, "a.ts");
    put(dist, "a.js");
    put(dist, "a.js.map");
    put(dist, "a.d.ts");
    put(dist, "tsconfig.tsbuildinfo");
    const { keep, stale } = selectOutputs(dist, src);
    expect(keep).toEqual(["a.js"]);
    expect(stale).toEqual([]);
  });

  it("깊은 폴더도 상대 경로를 / 로 맞춘다 (Windows 에서도)", () => {
    put(src, "panel/deep/x.ts");
    put(dist, "panel/deep/x.js");
    expect(selectOutputs(dist, src).keep).toEqual(["panel/deep/x.js"]);
  });

  it("폴더가 통째로 사라졌으면 그 안의 산출물이 전부 낡은 것이다", () => {
    put(src, "index.ts");
    put(dist, "index.js");
    put(dist, "removed/a.js");
    put(dist, "removed/b.js");
    expect(selectOutputs(dist, src).stale).toEqual(["removed/a.js", "removed/b.js"]);
  });

  it("소스에 .d.ts 만 있고 .ts 가 없는 경우는 짝으로 치지 않는다", () => {
    put(src, "types/photoshop.d.ts");
    put(dist, "types/photoshop.js");
    expect(selectOutputs(dist, src).stale).toEqual(["types/photoshop.js"]);
  });

  it("**폴더가 다르면 같은 이름이어도 짝이 아니다** — src/a/x.ts 가 dist/b/x.js 를 살리지 않는다", () => {
    put(src, "a/x.ts");
    put(dist, "b/x.js");
    expect(selectOutputs(dist, src)).toEqual({ keep: [], stale: ["b/x.js"] });
  });

  it("빈 dist 는 둘 다 비어 있다", () => {
    expect(selectOutputs(dist, src)).toEqual({ keep: [], stale: [] });
  });
});
