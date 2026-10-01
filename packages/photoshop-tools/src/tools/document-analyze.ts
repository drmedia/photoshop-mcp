import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_ANALYZE,
  DocumentAnalyzeParamsSchema,
  type DocumentAnalyzeResult,
} from "../commands/document-analyze.js";

/** `photoshop.document.analyze` — 이미지의 구조를 숫자로 본다. (ROADMAP §90) */
export function createDocumentAnalyzeTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentAnalyzeParamsSchema>, DocumentAnalyzeResult> {
  return {
    name: "photoshop.document.analyze",
    description:
      "이미지의 **구조**를 숫자로 분석한다. photoshop.document.statistics 가 전체 요약(채널 평균 · " +
      "백분위 · 채널별 클리핑 % · 전체 σ)이라면 이쪽은 **어디에, 어떤 모양으로**를 맡는다. " +
      "전체 해상도에서 픽셀을 한 번 읽는다. analyses 로 histogram · clipping · gradient · noise · " +
      "colorCast 를 고른다(생략하면 다섯 모두, 필요한 것만 고르면 빠르다). " +
      "**판정은 없다** — 숫자와 방향만 준다. 임계는 장르와 영역 크기에 따라 달라서 담지 않는다. " +
      "**단위** — 밝기 값은 모두 0–255 눈금이다(16비트도 환산). percent · pairsPercent · " +
      "scatteredPercent 같은 *Percent 와 tiles · histogram 의 값은 **퍼센트(0–100)이고 비율(0–1)이 " +
      "아니다.** bounds · flattest · area 는 픽셀이고 **잰 영역의 왼쪽 위가 원점**이다(source 가 " +
      "selection 이면 그 선택의 경계 상자). tiles 는 rows × cols 격자이고 grid 는 짧은 변의 타일 수다(기본 8). " +
      "**histogram** — 채널별(red · green · blue · luminance) 64구간 분포(%), 톤 구간 비중(shadows " +
      "휘도 0–63 · midtones 64–191 · highlights 192–255), peak, usedRange(휘도 0.1%–99.9%)와 headroom. " +
      "**clipping** — 어느 한 채널이라도 끝에 닿으면 클리핑이다. 4방향으로 이어진 덩어리의 **크기별 " +
      "비중**을 blobs.bySize 로 준다(클리핑된 픽셀 중 %: px1 · px2to9 · px10to99 · px100to999 · " +
      "px1000plus). **별은 몇~수십 픽셀 덩어리에, 날아간 하늘은 1000픽셀 이상에 몰린다** — 이웃의 " +
      "유무로 점과 면을 가르면 별이 면으로 센다. 덩어리가 너무 많으면 blobs 는 null 이다. " +
      "tiles 격자와 bounds 로 위치를, blownTiles 로 절반 이상 날아간 타일 수를 준다. " +
      "**gradient** — 타일마다 중앙값을 재고 평면을 맞춘다. 지평선 아래 전경 · 은하수 같은 이상 타일은 " +
      "걸러내며 usedTiles / totalTiles 로 알린다. acrossX · acrossY 는 왼쪽→오른쪽 · 위→아래 **전체에서 " +
      "변하는 양**(0–255 눈금, 양수면 오른쪽 · 아래가 높다)이고 directionDegrees 는 값이 커지는 쪽이다" +
      "(0=오른쪽 · 90=아래 · 180=왼쪽 · 270=위). residualRms 가 크면 평면이 아니다. colorDrift 의 " +
      "redMinusGreen · blueMinusGreen 이 광해의 **색** 기울기다. vignette 는 중앙과 모서리 타일의 차다. " +
      "전경이 넓으면 region: 'selection' 으로 하늘만 좁힌다(선택의 **경계 상자**만 쓴다, 모양은 아니다). " +
      "**noise** — luminance 는 statistics 의 σ 와 같은 추정이다. byZone 은 밝기 구간별 σ 이고 " +
      "pairsPercent 가 그 σ 의 대표성이다(작으면 경계 쌍 같은 구조가 만든 값이다). chroma 는 R−G · B−G " +
      "이웃 차의 σ 로, 채널 잡음이 독립이면 휘도 σ 의 약 √2 배 근처다. flat 은 가장 평탄한 타일들의 σ 와 " +
      "그 위치(flattest)라 **노이즈는 평탄한 곳에서 재야** 한다는 규칙을 자동으로 해 준다. " +
      "8비트 문서의 σ 는 정수 단위로 거칠다. " +
      "**colorCast** — 톤 구간별(shadows · midtones · highlights · all) 채널 중앙값, 비율(redOverGreen · " +
      "blueOverGreen), Lab 의 a · b, chroma, hueDegrees 와 direction(+a 붉은-자홍 · −a 초록 · +b 노랑 · " +
      "−b 파랑을 여덟 방향 이름으로). **sRGB 를 가정한 근사**다 — 문서 프로파일은 적용하지 않는다. " +
      "무엇이 중립이어야 하는지는 호출자가 안다(밤하늘의 은하수는 중립이 아니다). " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: DocumentAnalyzeParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentAnalyzeResult>(
        { type: DOCUMENT_ANALYZE, params: input },
        { requestId: context.requestId },
      ),
  };
}
