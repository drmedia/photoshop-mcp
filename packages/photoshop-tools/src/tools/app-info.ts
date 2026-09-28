import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  COLOR_GET_FOREGROUND_BACKGROUND,
  COLOR_SET_BACKGROUND,
  COLOR_SET_FOREGROUND,
  ColorGetParamsSchema,
  ColorSetParamsSchema,
  PREFERENCES_GET,
  PreferencesGetParamsSchema,
  type ColorGetParams,
  type ColorGetResult,
  type ColorSetParams,
  type ColorSetResult,
  type PreferencesGetParams,
  type PreferencesGetResult,
} from "../commands/app-info.js";

/** 앱 설정과 색. (ROADMAP §61) */

/** `photoshop.preferences.get` */
export function createPreferencesGetTool(
  engine: CommandEngine,
): ToolDefinition<PreferencesGetParams, PreferencesGetResult> {
  return {
    name: "photoshop.preferences.get",
    description:
      "Photoshop 환경 설정을 읽는다. category 를 주면 그 범주만, 생략하면 열두 범주를 " +
      "전부 준다 — cursors · fileHandling · general · guidesGridsAndSlices · history · " +
      "interface · notifications · performance · tools · transparencyAndGamut · type · " +
      "unitsAndRulers. " +
      "**unitsAndRulers 가 눈금자 단위를 담는다**(rulerUnits · typeUnits · pointSize) — " +
      "photoshop.guide.* 의 좌표나 텍스트의 72ppi 기준값을 해석할 때 본다. " +
      "**해상도는 여기 없다** — 문서 해상도는 photoshop.document.get 이 준다. " +
      "history.numberOfHistoryStates 는 undo 가 몇 단계까지 가는지다. " +
      "**속성 이름을 짐작하지 않고 읽히는 것만 담는다** — 하위 객체 안쪽이 Adobe " +
      "레퍼런스에 없다. 중첩 객체와 함수는 빼고 문자열·숫자·불린만 준다. " +
      "읽지 못한 범주는 null 이다. " +
      "**바꾸는 Tool 은 없다** — 환경 설정은 사용자의 것이고 LLM 이 말없이 바꾸면 " +
      "이후 사용자의 모든 작업이 달라진다. 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: PreferencesGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<PreferencesGetResult>(
        { type: PREFERENCES_GET, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.color.get_foreground_background` */
export function createColorGetTool(
  engine: CommandEngine,
): ToolDefinition<ColorGetParams, ColorGetResult> {
  return {
    name: "photoshop.color.get_foreground_background",
    description:
      "전경색과 배경색을 읽는다. 각각 {red, green, blue} 0~255 와 hex 를 준다. " +
      "**photoshop.path.stroke 가 이 색으로 긋는다** — strokePath 에 색을 주는 인자가 " +
      "없어 도구의 현재 설정을 그대로 쓴다. 긋기 전에 무슨 색이 나올지 여기서 본다. " +
      "지우개·그레이디언트 도구도 이 두 색을 쓴다. " +
      "**바꾸려면 photoshop.color.set_foreground · set_background 다** — 전경색은 " +
      "사용자가 Photoshop UI 에서 쓰는 상태이므로 이것으로 먼저 읽어 두었다가 " +
      "끝나고 되돌린다(그쪽 결과의 previous 도 같은 값을 준다). " +
      "**색을 정해 칠하는 것이 목적이면 둘 다 아니다** — 색을 인자로 받는 " +
      "photoshop.paint.dab · path.fill · text.create 를 쓴다. " +
      "**모르는 값은 null 이다.** 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: ColorGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<ColorGetResult>(
        { type: COLOR_GET_FOREGROUND_BACKGROUND, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** 둘이 공유하는 문장. (ROADMAP §62) */
const SET_COMMON =
  "red · green · blue 는 0~255 다. " +
  "**결과의 previous 에 바꾸기 전 색이 들어 있다** — 끝나고 그 previous 의 " +
  "red · green · blue 를 다시 넣어 되돌린다. **previous 를 통째로 넘기지 않는다** — " +
  "hex 가 함께 들어 있고 스키마가 셋만 받는다. " +
  "사용자가 Photoshop UI 에서 쓰는 상태를 빌려 쓰는 것이므로 " +
  "**빌렸으면 돌려놓는다.** " +
  "applied 는 요청한 값이 실제로 들어갔는지다 — 읽지 못했으면 false 다. " +
  "**색을 정해 칠하는 것이 목적이면 이것이 아니다** — photoshop.paint.dab · " +
  "path.fill · text.create 가 색을 인자로 받는다. ";

/** `photoshop.color.set_foreground` */
export function createColorSetForegroundTool(
  engine: CommandEngine,
): ToolDefinition<ColorSetParams, ColorSetResult> {
  return {
    name: "photoshop.color.set_foreground",
    description:
      "전경색을 바꾼다. " +
      "**photoshop.path.stroke 가 이 색으로 긋는다** — strokePath 에 색을 주는 인자가 " +
      "없어 이것이 유일한 통로다. 긋기 전에 바꾸고 끝나면 previous 로 되돌린다. " +
      "지우개·그레이디언트 도구도 이 색을 쓴다. " +
      SET_COMMON,
    permission: "edit",
    inputSchema: ColorSetParamsSchema,
    handler: async (input, context) =>
      engine.execute<ColorSetResult>(
        { type: COLOR_SET_FOREGROUND, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.color.set_background` */
export function createColorSetBackgroundTool(
  engine: CommandEngine,
): ToolDefinition<ColorSetParams, ColorSetResult> {
  return {
    name: "photoshop.color.set_background",
    description:
      "배경색을 바꾼다. **배경 레이어에서 지우거나 캔버스를 넓힐 때 채워지는 색**이고 " +
      "그레이디언트 도구의 끝 색이다. " +
      "photoshop.canvas.resize 로 넓힌 영역이 이 색으로 찬다 — 넓히기 전에 정한다. " +
      SET_COMMON,
    permission: "edit",
    inputSchema: ColorSetParamsSchema,
    handler: async (input, context) =>
      engine.execute<ColorSetResult>(
        { type: COLOR_SET_BACKGROUND, params: input },
        { requestId: context.requestId },
      ),
  };
}
