import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  SMART_OBJECT_CONVERT,
  SMART_OBJECT_GET_INFO,
  SmartObjectGetInfoParamsSchema,
  type SmartObjectGetInfoParams,
  type SmartObjectInfo,
  SmartObjectConvertParamsSchema,
  type SmartObjectConvertResult,
} from "../commands/smart-object.js";

/** `photoshop.smart_object.convert` — 레이어를 스마트 오브젝트로 만든다. (ROADMAP §17.27) */
export function createSmartObjectConvertTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof SmartObjectConvertParamsSchema>, SmartObjectConvertResult> {
  return {
    name: "photoshop.smart_object.convert",
    description:
      "레이어를 스마트 오브젝트로 변환한다. 픽셀을 버리지 않고 한 겹 감쌀 뿐이다. " +
      "**이 뒤에 거는 camera_raw.apply · filter.* 는 스마트 필터가 되어 나중에 값만 고칠 수 있다** — " +
      "변환하지 않은 레이어에 걸면 픽셀에 구워져 되돌리려면 History 뿐이다. " +
      "국소 보정은 layer.duplicate(또는 stamp_visible) → 선택 → mask.create → 이 Tool → " +
      "camera_raw.apply 순서로 한다. 마스크를 먼저 씌워야 변환된 결과에 함께 들어간다. " +
      "**변환하면 레이어 id 가 바뀐다** — 결과의 layer.id 를 이어서 쓴다. previousId 에 옛 id 가 있다. " +
      "이미 스마트 오브젝트면 아무것도 하지 않고 converted: false 로 답한다(오류가 아니다). " +
      "스마트 오브젝트 안에 스마트 오브젝트를 만들지 않기 위함이다.",
    permission: "edit",
    inputSchema: SmartObjectConvertParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectConvertResult>(
        { type: SMART_OBJECT_CONVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.smart_object.get_info` — 스마트 오브젝트의 속성을 읽는다. (ROADMAP §54) */
export function createSmartObjectGetInfoTool(
  engine: CommandEngine,
): ToolDefinition<SmartObjectGetInfoParams, SmartObjectInfo> {
  return {
    name: "photoshop.smart_object.get_info",
    description:
      "스마트 오브젝트의 속성을 읽는다. layerId 를 생략하면 활성 레이어. " +
      "**linked 가 연결(true)인지 포함(false)인지 가른다** — 연결이면 원본 파일이 " +
      "바뀔 때 문서도 따라 바뀐다. photoshop.layer.place 로 가져온 것은 기본이 포함이다. " +
      "**fileReference 는 포함이어도 값이 있다** — 포함일 때는 Photoshop 내부 이름" +
      "(예: PLAIN.psb)이고 연결일 때만 실제 경로다. " +
      "contentId 는 내용의 XMP 문서 id 로, 같은 내용을 가리키는 레이어끼리 같다 — " +
      "복제한 스마트 오브젝트가 원본과 내용을 공유하는지 이것으로 가른다. " +
      "**스마트 오브젝트가 아니면 오류가 아니라 isSmartObject: false 를 돌려준다** — " +
      "먼저 확인하는 용도로 쓸 수 있다. " +
      "**모르는 값은 null 이다.** Photoshop 이 알려주지 않으면 지어내지 않고, " +
      "해석하지 못한 키는 raw 에 원본 그대로 남는다.",
    permission: "read",
    inputSchema: SmartObjectGetInfoParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectInfo>(
        { type: SMART_OBJECT_GET_INFO, params: input },
        { requestId: context.requestId },
      ),
  };
}
