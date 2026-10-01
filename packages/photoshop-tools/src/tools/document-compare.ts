import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_COMPARE,
  DocumentCompareParamsSchema,
  type DocumentCompareResult,
} from "../commands/document-compare.js";

/** `photoshop.document.compare` — 보정 전후를 그림과 수치로 돌려준다. (ROADMAP §91) */
export function createDocumentCompareTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentCompareParamsSchema>, DocumentCompareResult> {
  return {
    name: "photoshop.document.compare",
    description:
      "**보정 전후를 한 장의 그림과 수치로** 돌려준다 — 보정한 뒤 결과를 판단할 때 쓴다. " +
      "photoshop.document.capture 를 두 번 불러 두 장을 기억하며 견주는 것을 한 번에 해 준다. " +
      "beforeLayerId 는 보정 전 픽셀을 담은 레이어(보통 배경 — 이 프로젝트의 보정은 비파괴라 원본이 " +
      "아래에 있다)이고 afterLayerId 를 생략하면 보이는 그대로의 합성이 '후'다. 보정 전 레이어는 " +
      "캔버스 전체를 덮어야 한다. " +
      "**그림** — 가로로 이어 붙인 한 장이다. 왼쪽부터 결과의 panels 순서(before · after · " +
      "diff 를 켰다면 difference)다. **그림에는 글자가 없으므로 panels 가 유일한 표식이다.** " +
      "difference 는 |후 − 전| 에 4배 gain 을 곱한 열지도(검정 → 빨강 → 노랑 → 흰색)로 **시각용**이다 — " +
      "숫자로 읽지 않는다. 그림은 축소한 미리보기라 단일 픽셀 클리핑이 묻히므로 **수치는 따로 전체 " +
      "해상도 원본에서** 낸다. " +
      "**수치** — before · after 는 각각 채널별 중앙값 · 휘도 분위수(p1 · p5 · p50 · p95 · p99) · " +
      "클리핑(어느 한 채널이라도 끝에 닿은 픽셀의 %)이고, change 는 (후 − 전)이다. " +
      "**단위** — 밝기 값은 0–255 눈금이고 클리핑은 **퍼센트(0–100)이며 change.clipping 은 퍼센트포인트** " +
      "다(0.2 → 10.2 면 +10). tiles 는 rows × cols 격자의 타일 중앙값 변화이고 표본이 없는 타일은 " +
      "null 이다. deltaE 는 타일 중앙색의 CIE76 색차(sRGB 가정 — 문서 프로파일은 적용하지 않는다)다. " +
      "hotspots 는 ΔE 가 가장 큰 타일 셋의 **픽셀 좌표**(잰 영역의 왼쪽 위가 원점, area 가 그 크기)다 — " +
      "그 자리를 region: 'selection' 으로 좁히면 확대해서 볼 수 있다. " +
      "**휘도는 같은데 색만 옮겨 간 타일은 deltaLuminance 가 작고 deltaE 가 크다** — 둘을 함께 본다. " +
      "**판정은 없다** — 변한 양과 위치만 준다. 무엇이 좋은 변화인지는 사진이 정한다(밤하늘의 은하수를 " +
      "밝히는 것은 보정이고 하늘 전체를 밝히는 것은 사고다). 이미지를 못 받는 클라이언트에서도 수치로 " +
      "판단할 수 있다. quality 는 JPEG **1–100** 이다(document.export 의 1–12 와 다르다). " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: DocumentCompareParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCompareResult>(
        { type: DOCUMENT_COMPARE, params: input },
        { requestId: context.requestId },
      ),
  };
}
