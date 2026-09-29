import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  CAMERA_RAW_APPLY,
  CameraRawParamsSchema,
  type CameraRawResult,
} from "../commands/camera-raw.js";

/** `photoshop.camera_raw.apply` — Camera Raw 필터. (ROADMAP §17.17) */
export function createCameraRawApplyTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof CameraRawParamsSchema>, CameraRawResult> {
  return {
    name: "photoshop.camera_raw.apply",
    description:
      "Camera Raw 필터를 건다. 노출·대비·밝은영역·어두운영역·색온도·부분대비·디헤이즈 " +
      "그리고 **노이즈 감소**까지 한 번에 적용한다. " +
      "**필요한 설정을 한 번의 호출에 모두 담아라.** 나눠서 여러 번 부르면 픽셀이 " +
      "반복해서 구워져 결과가 달라진다 — 실기에서 같은 네 설정을 네 번 나눠 걸었더니 " +
      "중간값이 19% 어긋났다. 고치려면 photoshop.history.undo 로 되돌린 뒤 전체를 다시 적용한다. " +
      "노이즈 감소는 Photoshop 의 노이즈 감소 필터보다 훨씬 잘 듣는다 — " +
      "실기에서 σ 6.72 → 3.42(49%) 이면서 색은 소수점 둘째 자리까지 그대로였다. " +
      "픽셀을 직접 바꾸므로 원본을 남기려면 photoshop.layer.duplicate 로 복제한 뒤 건다. " +
      "숨긴 레이어와 조정 레이어에는 걸 수 없다. " +
      "temperature 는 켈빈이 아니라 -100~100 상대값이다. " +
      "**색상 혼합(HSL)** 은 hue/saturation/luminance × Red·Orange·Yellow·Green·Aqua·Blue·Purple·Magenta " +
      "24개 파라미터다(예: saturationOrange, luminanceBlue). " +
      "전역 vibrance·saturation 과 달리 **특정 색만** 건드리므로, 야경에서 조명색만 " +
      "살리고 하늘은 그대로 두는 식의 조정에 쓴다. " +
      "레이어를 photoshop.smart_object.convert 로 먼저 감싸면 스마트 필터로 남아 " +
      "**사람이 Photoshop 대화상자에서 값을 고칠 수 있고**, " +
      "photoshop.smart_object.get_info 의 raw.filterFX 로 무엇이 들어갔는지 되읽을 수 있다. " +
      "**다만 이 Tool 을 다시 불러도 고쳐지지 않는다 — 필터가 하나 더 쌓인다.** " +
      "그래서 '한 번에 담아라' 는 스마트 오브젝트에서도 그대로다. " +
      "**곡선**은 파라메트릭(curveHighlights·curveLights·curveDarks·curveShadows 와 " +
      "구간 경계 curveShadowSplit·curveMidtoneSplit·curveHighlightSplit)과 " +
      "포인트(curveRgb·curveRed·curveGreen·curveBlue)를 모두 받는다. " +
      "포인트 곡선은 [{x,y}, …] 점 목록이며 0-255 이고 x 가 엄격히 증가해야 한다. " +
      "curveHighlights 는 기본 패널의 highlights 와 **다른 것이다** — " +
      "저쪽은 톤 범위를 직접 밀고 이쪽은 곡선의 해당 구간을 구부린다. " +
      "**샤픈**은 sharpenAmount(0-150) · sharpenRadius(0.5-3.0 실수) · " +
      "sharpenDetail(0-100) · sharpenMasking(0-100) 이다. " +
      "노이즈 감소와 같은 패널이고 **서로를 상쇄한다** — 노이즈를 줄이면 디테일이 " +
      "뭉개지고 샤픈은 노이즈까지 세운다. 그래서 둘을 한 호출에 함께 담는다. " +
      "**sharpenMasking 이 평탄한 영역을 샤픈에서 뺀다** — 하늘처럼 고른 면의 " +
      "노이즈가 같이 서는 것을 막으므로 천체사진에서는 이것부터 올린다. " +
      "건 뒤에는 photoshop.document.statistics 의 noise 로 확인한다 — " +
      "샤픈은 σ 를 올리고 노이즈 감소는 내리므로 숫자로 갈린다. " +
      "**국소 보정**은 localCorrections 로 준다 — 마스크를 씌운 보정을 전역 설정과 " +
      "**한 번에** 건다. 마스크는 선형(linearGradient) · 방사형(radialGradient) · " +
      "광도 범위(luminanceRange) 셋이다. " +
      "좌표는 0-1 정규화이고 왼쪽 위가 0,0 이며 **캔버스 밖 음수도 된다.** " +
      "선형은 {from:{x,y}, to:{x,y}} 로 from 이 효과 0, to 가 효과 100% 쪽이다. " +
      "**방사형은 중심·반지름이 아니라 경계 상자다** — {bounds:{top,left,bottom,right}} 이고 " +
      "효과는 타원 **안**에 들어간다. angle(도) · feather(0-100) · roundness 는 원시값이다. " +
      "**inverted: true 로 안팎을 뒤집는다** — 방사형이면 효과가 타원 밖으로, " +
      "선형이면 방향이 반대로 간다. " +
      "**광도 범위는 위치가 아니라 밝기로 고른다** — {range:{min,max}} 이고 0-100 이다. " +
      "하늘의 밝은 부분만, 또는 어두운 부분만 골라 거는 데 쓴다. " +
      "photoshop.selection.luminosity + mask.create 와 결과는 비슷하지만 " +
      "**이쪽은 굽는 횟수가 늘지 않고 레이어도 안 는다.** " +
      "**경계가 부드럽지 않다** — 구간 밖 픽셀은 그대로 남아 실기에서 히스토그램이 " +
      "둘로 갈라졌다. 부드러운 전환이 필요하면 그레이디언트 마스크 쪽이다. " +
      "**구간은 Camera Raw 의 눈금이라 document.statistics 의 0-255 와 정확히 " +
      "맞지 않는다** — 걸고 나서 재서 확인한다. " +
      "**combine 으로 바탕 마스크와 합친다** — [{mode:'subtract'|'add', mask:{...}}] " +
      "형태다. 하늘에서 은하수를 빼거나, 하늘에 지평선 부근을 더하는 식이다. " +
      "**레이어 마스크와 다르다** — Camera Raw 안에서 계산되므로 굽는 횟수가 늘지 않는다. " +
      "**겹치는 곳이 두 번 먹지 않는다** — 실기에서 겹침과 바탕만의 밝기가 " +
      "210.88 로 같았다. **교차(intersect)는 없다** — 부호화를 아직 모른다. " +
      "**슬라이더는 Camera Raw UI 에 보이는 값 그대로 준다** — exposure 는 EV(±4)이고 " +
      "hue 는 각도(±180), 나머지는 ±100 이다. amount 는 보정 전체의 배율로 " +
      "100 이 기본이고 200 까지 올릴 수 있다. " +
      "**레이어를 따로 만들어 거는 것과 결과가 다르다** — 이쪽은 한 번만 굽는다. " +
      "**앞서 건 것이 사라지지 않고 쌓인다** — 픽셀 레이어면 구워진 위에 다시 굽고, " +
      "스마트 오브젝트면 스마트 필터가 하나 더 붙는다. 실기에서 같은 보정을 두 번 " +
      "걸었더니 노출 +3 이 두 번 먹어 하이라이트 19.7% 가 날아갔다. " +
      "**결과의 smartFilterCount 가 몇 개 쌓였는지 말한다** — 2 이상이면 " +
      "photoshop.history.undo 로 되돌린 뒤 전부 한 번에 다시 건다. " +
      "여러 마스크가 필요하면 **배열에 전부 담아 한 번에 건다.** " +
      "**색 보정**은 colorGrade 로 준다 — shadows · midtones · highlights · global 에 " +
      "각각 {hue, saturation, luminance} 를 주고 blending · balance 는 공통 하나씩이다. " +
      "**전역 색상 혼합(HSL)과 다르다** — 저쪽은 이미 있는 색을 골라 바꾸고 이쪽은 " +
      "밝기 구간에 색을 얹는다. 야경 토닝은 이쪽이다. " +
      "**여기의 hue 는 0-359 한 바퀴다** — 같은 보정 안의 슬라이더 hue(±180)와 " +
      "다른 물건이라 355 를 -5 로 바꿔 주지 않는다. " +
      "blending 을 생략하면 50(Camera Raw 기본값)이고 0 이 아니다.",
    permission: "edit",
    inputSchema: CameraRawParamsSchema,
    handler: async (input, context) =>
      engine.execute<CameraRawResult>(
        { type: CAMERA_RAW_APPLY, params: input },
        { requestId: context.requestId },
      ),
  };
}
