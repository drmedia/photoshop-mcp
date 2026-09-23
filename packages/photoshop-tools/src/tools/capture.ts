import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { CapturedImage, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  CAPTURE_DOCUMENT,
  CAPTURE_LAYER,
  CAPTURE_SELECTION,
  CaptureDocumentParams,
  CaptureLayerParams,
  CaptureSelectionParams,
} from "../commands/capture.js";

const COMMON =
  " 결과는 그림으로 돌아온다. longEdge 로 크기를 정하며 기본 1024px, 최대 2048px 다 — " +
  "원본 해상도를 받을 이유가 없고 크면 토큰만 먹는다. " +
  "문서를 바꾸지 않고 파일도 쓰지 않으므로 read 권한이면 된다.";

function tool<TSchema extends z.ZodTypeAny>(
  engine: CommandEngine,
  name: string,
  commandType: string,
  description: string,
  inputSchema: TSchema,
): ToolDefinition<z.infer<TSchema>, CapturedImage> {
  return {
    name,
    description,
    permission: "read",
    inputSchema,
    handler: async (input, context) =>
      engine.execute<CapturedImage>(
        { type: commandType, params: input as Record<string, unknown> },
        { requestId: context.requestId },
      ),
  };
}

export function createCaptureDocumentTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof CaptureDocumentParams>, CapturedImage> {
  return tool(
    engine,
    "photoshop.document.capture",
    CAPTURE_DOCUMENT,
    "현재 문서를 합성해서 **눈으로 볼 수 있는 그림으로** 돌려준다. 보이는 레이어가 " +
      "모두 반영된다. 편집이 의도대로 됐는지 확인할 때 쓴다 — 레이어 목록만으로는 " +
      "색이 틀어졌는지, 마스크 경계가 어색한지 알 수 없다. 여러 단계를 쌓기 전에 " +
      "중간중간 확인하는 편이 낫다." +
      COMMON,
    CaptureDocumentParams,
  );
}

export function createCaptureLayerTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof CaptureLayerParams>, CapturedImage> {
  return tool(
    engine,
    "photoshop.layer.capture",
    CAPTURE_LAYER,
    "레이어 하나만 그림으로 돌려준다. 다른 레이어는 반영되지 않으므로 그 레이어가 " +
      "실제로 무엇을 담고 있는지 볼 수 있다. layerId 를 생략하면 활성 레이어. " +
      "**target: 'mask' 면 레이어 마스크를 본다.** 광도 마스크가 의도한 구조를 " +
      "따라가는지 확인할 때 쓴다 — 마스크가 비어 있어도 결과 그림은 그럴듯할 수 " +
      "있어서 눈으로는 안 잡힌다. 조정 레이어는 자기 픽셀이 없으므로 그냥 찍으면 " +
      "순백만 나온다. 마스크가 없는 레이어에 주면 실패한다." +
      COMMON,
    CaptureLayerParams,
  );
}

export function createCaptureSelectionTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof CaptureSelectionParams>, CapturedImage> {
  return tool(
    engine,
    "photoshop.selection.capture",
    CAPTURE_SELECTION,
    "선택 영역을 그림으로 돌려준다. 하늘 선택이나 마스크가 의도한 범위를 잡았는지 " +
      "확인할 때 쓴다. **선택의 경계 상자를 찍는다** — 정확한 모양이 아니라 그것을 " +
      "감싸는 사각형이므로 모양이 복잡하면 바깥 영역도 함께 들어온다. " +
      "선택 영역이 없으면 실패한다." +
      COMMON,
    CaptureSelectionParams,
  );
}
