import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  FONT_LIST,
  FontListParamsSchema,
  TEXT_CREATE,
  TEXT_SET,
  TextCreateParamsSchema,
  TextSetParamsSchema,
  type FontListResult,
  type TextResult,
} from "../commands/text.js";

/** `photoshop.text.create` — 텍스트 레이어를 만든다. (ROADMAP §17.33) */
export function createTextCreateTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof TextCreateParamsSchema>, TextResult> {
  return {
    name: "photoshop.text.create",
    description:
      "텍스트 레이어를 만든다. 내용·위치·폰트·크기·색·불투명도·정렬을 한 번에 준다. " +
      "**줄바꿈은 그냥 개행 문자로 준다** — Photoshop 은 CR 을 쓰지만 경계에서 바꿔 준다. " +
      "한동안 그대로 넘겨 **네모(□)가 그려졌다**(ROADMAP §60). " +
      "**워터마크와 서명을 위한 범위다** — 자간·행간·단락·변형은 없다. " +
      "x·y 는 문서 좌상단이 원점이고 **글자의 기준선(baseline)** 이다. " +
      "font 는 **PostScript 이름**이며 photoshop.font.list 가 주는 postScriptName 을 그대로 쓴다 — " +
      "화면에 보이는 이름이 아니다. 없는 이름을 주면 Photoshop 이 조용히 다른 폰트로 " +
      "대체하므로 미리 찾아보고 거절한다. " +
      "워터마크는 opacity 20-40 이 보통이다. " +
      "결과의 applied 는 실제로 적용한 항목이다 — 준 것과 다를 수 있다.",
    permission: "edit",
    inputSchema: TextCreateParamsSchema,
    handler: async (input, context) =>
      engine.execute<TextResult>(
        { type: TEXT_CREATE, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.text.set` — 기존 텍스트 레이어를 고친다. (ROADMAP §17.33) */
export function createTextSetTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof TextSetParamsSchema>, TextResult> {
  return {
    name: "photoshop.text.set",
    description:
      "기존 텍스트 레이어의 내용·폰트·크기·색·불투명도·정렬을 고친다. " +
      "바꿀 항목만 주면 되고 하나 이상 있어야 한다. " +
      "**텍스트 레이어가 아니면 거절한다** — photoshop.layer.list 의 type 이 text 인지 확인한다. " +
      "font 는 PostScript 이름이다(photoshop.font.list 참조). " +
      "설정마다 Tool 을 두지 않고 하나로 묶은 것은 여러 속성을 같이 바꾸는 경우가 대부분이기 때문이다.",
    permission: "edit",
    inputSchema: TextSetParamsSchema,
    handler: async (input, context) =>
      engine.execute<TextResult>(
        { type: TEXT_SET, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.font.list` — 설치된 폰트를 조회한다. (ROADMAP §17.33) */
export function createFontListTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof FontListParamsSchema>, FontListResult> {
  return {
    name: "photoshop.font.list",
    description:
      "이 기기에 설치된 폰트를 조회한다. **text.create · text.set 의 font 에 넣을 값은 postScriptName 이다.** " +
      "query 로 이름·계열을 거를 수 있고 기본 50개까지 준다 — 전체를 받으면 맥락만 먹는다. " +
      "total 은 거르기 전 전체 수다. " +
      "**폰트는 기기마다 다르다.** 이름을 짐작해서 넣지 말고 반드시 여기서 확인한다 — " +
      "없는 이름을 주면 Photoshop 이 조용히 대체한다.",
    permission: "read",
    inputSchema: FontListParamsSchema,
    handler: async (input, context) =>
      engine.execute<FontListResult>(
        { type: FONT_LIST, params: input },
        { requestId: context.requestId },
      ),
  };
}
