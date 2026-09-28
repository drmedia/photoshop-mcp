import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  COLOR_GET_FOREGROUND_BACKGROUND,
  ColorGetParamsSchema,
  PREFERENCES_GET,
  PreferencesGetParamsSchema,
  type ColorGetParams,
  type ColorGetResult,
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
      "**바꾸는 Tool 은 없다** — 전경색은 사용자가 Photoshop UI 에서 쓰는 상태이고, " +
      "말없이 바꾸면 사용자가 다음에 칠할 때 엉뚱한 색이 나온다. " +
      "색을 정해 칠하려면 색을 인자로 받는 photoshop.paint.dab · path.fill · " +
      "text.create 를 쓴다. " +
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
