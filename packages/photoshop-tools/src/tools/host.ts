import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  HOST_GET,
  HostGetParamsSchema,
  type HostGetParams,
  type HostInfo,
} from "../commands/host.js";

/** `photoshop.host.get` — 호스트 버전과 이 플러그인이 쓰는 API 의 유무. */
export function createHostGetTool(engine: CommandEngine): ToolDefinition<HostGetParams, HostInfo> {
  return {
    name: "photoshop.host.get",
    description:
      "Photoshop 버전과 **이 서버가 쓰는 API 가 이 Photoshop 에 있는지**를 돌려준다. " +
      "버전 문자열만으로는 무엇이 되는지 알 수 없어서 기능 유무를 함께 준다 — " +
      "imaging.getPixels(캡처·통계의 전제) · imaging.getLayerMask(마스크를 보고 재는 길) · " +
      "document.rotate · document.histogram · SaveOptions.DONOTSAVECHANGES(문서 닫기) · " +
      "RasterizeType.ENTIRELAYER · action.addNotificationListener · document.selection. " +
      "layerComps · pathItems 도 함께 보는데 **이 서버가 Tool 로 노출한 것이 아니라** " +
      "호스트가 가졌는지를 말한다 — 만들 수 있는지 미리 판단하는 근거다. " +
      "Camera Raw 는 batchPlay 필터라 걸어 보기 전에는 유무를 알 수 없어 담지 않는다. " +
      "**document.* 는 활성 문서가 없으면 false 가 아니라 null 이다** — 문서 메서드는 " +
      "문서에 붙어 있어 문서 없이는 확인할 수 없고, false 로 답하면 '이 Photoshop 에는 " +
      "없다' 는 틀린 사실을 말하게 된다. openDocuments 가 그 이유를 설명한다. " +
      "**platform 은 서버의 것이다**(win32 · darwin 등). Bridge 가 localhost 라 " +
      "서버와 Photoshop 은 같은 기계다. photoshop.window.capture 가 Windows 전용인 " +
      "것처럼 플랫폼에 따라 갈리는 기능이 있다. " +
      "무언가 안 될 때는 photoshop.diagnostics 를 먼저 부른다 — 이쪽은 호스트가 " +
      "무엇을 할 수 있는지이고, 그쪽은 서버 설정이 무엇을 막고 있는지다. " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: HostGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<HostInfo>({ type: HOST_GET, params: input }, { requestId: context.requestId }),
  };
}
