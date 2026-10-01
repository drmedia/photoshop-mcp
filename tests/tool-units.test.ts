import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 숫자 파라미터의 **단위가 Tool 설명에 있다**. (ROADMAP §86 · §87)
 *
 * 파라미터에 붙는 `.describe()` 는 전부 비어 있어서 LLM 이 단위를 알 수 있는 곳은 Tool
 * 설명 문장뿐이다. 스키마 주석에 단위가 있어도 LLM 에게는 가지 않는다 — statistics 의
 * "클리핑 비율" 이 그렇게 100 배로 읽혔다.
 *
 * 특히 **같은 이름이 다른 눈금**인 `quality` 는 두 쪽 모두 눈금을 적어야 한다.
 * export 는 1–12, capture 는 1–100 이라 capture 에 10 을 주면 조용히 통과해
 * 극단적으로 낮은 화질이 나온다.
 *
 * 문구를 한 글자까지 고정하지 않는다 — 단위 단서가 **있는지**만 본다.
 */

const mcp = createPhotoshopMcp({
  bridge: new MockPhotoshopBridge(),
  logger: createSilentLogger(),
});

const description = (name: string): string => {
  const tool = mcp.tools.get(`photoshop.${name}`);
  expect(tool, `${name} 이 등록되어 있다`).toBeDefined();
  return tool?.description ?? "";
};

/** [Tool, 설명에 있어야 하는 단서]. 단서는 단위·눈금을 말하는 대표 문구다. */
const MUST_STATE: [string, RegExp][] = [
  // 같은 이름 `quality` 가 다른 눈금이다 — 양쪽 모두, 서로를 가리키며 적는다.
  ["document.export", /quality[^.]*1[–-]12/u],
  ["document.export", /document\.capture[^.]*1[–-]100/u],
  ["document.capture", /quality[^.]*1[–-]100/u],
  ["document.capture", /document\.export[^.]*1[–-]12/u],
  ["layer.capture", /quality[^.]*1[–-]100/u],
  ["selection.capture", /quality[^.]*1[–-]100/u],

  // 점 찍기 셋: 좌표·반지름은 문서 픽셀, strength · hardness 는 퍼센트 눈금.
  ["dodge_burn.dab", /문서 픽셀/u],
  ["dodge_burn.dab", /strength[^.]*1[–-]100/u],
  ["paint.dab", /문서 픽셀/u],
  ["paint.dab", /strength[^.]*1[–-]100/u],
  ["mask.dab", /문서 픽셀/u],
  ["mask.dab", /strength[^.]*1[–-]100/u],

  ["measure.tilt", /문서 픽셀 좌표/u],
  ["measure.tilt", /minContrast[^.]*0[–-]255/u],
  ["selection.modify", /radius[^.]*픽셀/u],
  ["canvas.resize", /width · height 는 \*\*픽셀\*\*/u],

  // text 의 size 는 실기로 쟀다 — 문서 픽셀이고 해상도와 무관하다 (§87).
  ["text.create", /size 는 문서 픽셀이다[^.]*포인트가 아니고/u],
  ["text.set", /size 는 문서 픽셀이다[^.]*포인트가 아니고/u],
  ["text.create", /문자 패널의 pt[^.]*72/u],
  ["text.set", /문자 패널의 pt[^.]*72/u],

  // path 의 feather 는 실기로 쟀다 — 문서 픽셀이고 해상도와 무관하다 (§87).
  ["path.fill", /feather 는 문서 픽셀이고 해상도와 무관하다/u],
  ["path.to_selection", /feather 는 가장자리 페더\(문서 픽셀/u],

  // §86 에서 고친 것도 함께 묶는다.
  ["document.statistics", /clippedLow[^.]*퍼센트/u],

  // analyze — 단위 · 원점 · 판정 없음 · 근사의 전제를 설명이 말한다 (§90).
  ["document.analyze", /퍼센트\(0–100\)이고 비율\(0–1\)이/u],
  ["document.analyze", /0–255 눈금/u],
  ["document.analyze", /왼쪽 위가 원점/u],
  ["document.analyze", /판정은 없다/u],
  ["document.analyze", /별은 몇~수십 픽셀 덩어리에/u],
  ["document.analyze", /sRGB 를 가정한 근사/u],
  ["document.analyze", /8비트 문서의 σ 는 정수 단위로 거칠다/u],
];

describe("Tool 설명의 단위", () => {
  for (const [name, pattern] of MUST_STATE) {
    it(`${name}: ${String(pattern)}`, () => {
      expect(description(name)).toMatch(pattern);
    });
  }

  it("**같은 이름 quality 의 두 눈금이 서로 다르다는 것을 설명이 안다**", () => {
    // 한쪽만 고치고 다른 쪽을 잊으면 비대칭이 생긴다 — 그 상태를 막는다.
    const exportText = description("document.export");
    const captureText = description("document.capture");
    expect(exportText).toMatch(/눈금이 다르다/u);
    expect(captureText).toMatch(/눈금이 다르다/u);
  });
});
