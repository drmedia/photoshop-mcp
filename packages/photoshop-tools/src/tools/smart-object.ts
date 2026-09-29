import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  SMART_OBJECT_CONVERT,
  SMART_OBJECT_GET_INFO,
  SMART_OBJECT_NEW_VIA_COPY,
  SMART_OBJECT_RELINK,
  SMART_OBJECT_UPDATE,
  SmartObjectNewViaCopyParamsSchema,
  SmartObjectRelinkParamsSchema,
  SmartObjectUpdateParamsSchema,
  type SmartObjectNewViaCopyParams,
  type SmartObjectNewViaCopyResult,
  type SmartObjectRelinkParams,
  type SmartObjectUpdateParams,
  type SmartObjectUpdateResult,
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
      "**마스크가 있으면 스마트 오브젝트가 그 경계로 잘린다** — 실기에서 2000×2000 " +
      "마스크가 4032×6048 레이어를 정확히 그 크기로 만들었다(ROADMAP §82). " +
      "hasMask 가 false 가 되는 것이 흡수됐다는 뜻이다. **다만 Camera Raw 국소 마스크의 " +
      "0-1 좌표는 잘린 SO 가 아니라 여전히 문서 기준이다**(§72) — 두 가지가 다르다. " +
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
      "**linkMissing 이 true 면 연결된 파일이 사라져 문서가 깨진 상태다** — " +
      "photoshop.workspace.delete 로 정리한 뒤 이것으로 확인한다. " +
      "linkChanged 가 true 면 photoshop.smart_object.update 가 할 일이 있다. " +
      "linkPath 는 전체 경로이고 fileReference 는 이름만이다. " +
      "**contentId 는 '어디서 온 내용인가' 이지 '지금 내용을 공유하는가' 가 아니다** — " +
      "같은 파일에서 온 두 레이어는 new_via_copy 로 갈라 놓아도 같은 값이다. " +
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

/** `photoshop.smart_object.new_via_copy` — 내용을 공유하지 않는 사본. (ROADMAP §55) */
export function createSmartObjectNewViaCopyTool(
  engine: CommandEngine,
): ToolDefinition<SmartObjectNewViaCopyParams, SmartObjectNewViaCopyResult> {
  return {
    name: "photoshop.smart_object.new_via_copy",
    description:
      "스마트 오브젝트의 **내용을 공유하지 않는 사본**을 만든다. layerId 를 생략하면 활성 레이어. " +
      "**photoshop.layer.duplicate 와 다르다** — 복제본은 내용을 공유해서 한쪽을 고치면 " +
      "다른 쪽도 바뀐다. 이것은 내용을 복사해 연결을 끊는다. " +
      "같은 소재에 서로 다른 Camera Raw 설정을 걸어 비교할 때 쓴다. " +
      "**contentId 로는 끊겼는지 확인할 수 없다** — 같은 파일에서 온 것이면 사본도 " +
      "같은 값을 갖는다(실기 확인). 그 값은 내용의 출처를 가리킨다. " +
      "**연결(linked) 스마트 오브젝트에는 쓸 수 없다** — 내용이 파일에 있어 복사해 낼 " +
      "것이 없다. 그때는 photoshop.layer.place 로 다시 가져온다. " +
      "스마트 오브젝트가 아닌 레이어도 거절한다. 원본은 그대로 남고 결과는 새 레이어다.",
    permission: "edit",
    inputSchema: SmartObjectNewViaCopyParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectNewViaCopyResult>(
        { type: SMART_OBJECT_NEW_VIA_COPY, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.smart_object.relink` — 내용을 다른 파일로 바꾼다. (ROADMAP §55) */
export function createSmartObjectRelinkTool(
  engine: CommandEngine,
): ToolDefinition<SmartObjectRelinkParams, SmartObjectInfo> {
  return {
    name: "photoshop.smart_object.relink",
    description:
      "스마트 오브젝트의 내용을 **승인된 작업 폴더의 다른 파일로 바꾼다**. " +
      "filename 은 파일 이름만 받으며 경로를 쓸 수 없다. layerId 를 생략하면 활성 레이어. " +
      "**걸어 둔 스마트 필터 · 변형 · 마스크는 그대로 남고 내용만 바뀐다** — " +
      "그래서 photoshop.layer.place 로 새 레이어를 놓는 것과 다르다. " +
      "외부 처리기를 다시 돌린 결과를 같은 자리에 끼워 넣을 때 쓴다. " +
      "결과는 photoshop.smart_object.get_info 와 같은 모양이라 바뀐 연결을 바로 확인할 수 있다.",
    permission: "external",
    inputSchema: SmartObjectRelinkParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectInfo>(
        { type: SMART_OBJECT_RELINK, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.smart_object.update` — 수정된 연결 내용을 새로 읽는다. (ROADMAP §55) */
export function createSmartObjectUpdateTool(
  engine: CommandEngine,
): ToolDefinition<SmartObjectUpdateParams, SmartObjectUpdateResult> {
  return {
    name: "photoshop.smart_object.update",
    description:
      "원본 파일이 바뀐 **연결 스마트 오브젝트를 새로 읽는다**. " +
      "**레이어 하나가 아니라 문서 전체다** — Photoshop 의 이 명령이 원래 " +
      "'Update All Modified Smart Objects' 이고 레이어를 고르는 인자가 없다. " +
      "포함(embedded) 스마트 오브젝트에는 할 일이 없다 — 원본 파일이 없기 때문이다. " +
      "연결로 가져오려면 photoshop.layer.place 의 linked 를 켠다. " +
      "바뀐 것이 없으면 조용히 아무 일도 하지 않는다 — 오류가 아니다. " +
      "무엇이 바뀌었는지는 photoshop.document.statistics 로 확인한다.",
    permission: "edit",
    inputSchema: SmartObjectUpdateParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectUpdateResult>(
        { type: SMART_OBJECT_UPDATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
