import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  METADATA_GET,
  MetadataGetParamsSchema,
  type MetadataGetParams,
  type MetadataInfo,
} from "../commands/metadata.js";

/** `photoshop.metadata.get` — 활성 문서의 촬영 정보. (ROADMAP §76) */
export function createMetadataGetTool(
  engine: CommandEngine,
): ToolDefinition<MetadataGetParams, MetadataInfo> {
  return {
    name: "photoshop.metadata.get",
    description:
      "활성 문서의 **촬영 정보(EXIF)** 를 읽는다 — 카메라·렌즈·노출 시간·조리개·ISO· " +
      "초점 거리·노출 보정·촬영 시각. " +
      "**photoshop.document.statistics 와 짝이다** — 저쪽은 '지금 픽셀이 어떤가' 이고 " +
      "이쪽은 '왜 그런가' 다. σ 6.7 이 ISO 6400 의 노이즈인지 ISO 200 의 것인지는 " +
      "픽셀만 봐서는 알 수 없고, 보정을 얼마나 밀어도 되는지가 거기서 갈린다. " +
      "초점 거리를 알면 별이 흐른 것인지 초점이 나간 것인지도 가릴 수 있다. " +
      "exposureTime 은 사람이 읽는 형태(1/125s · 30s)이고 exposureSeconds 가 같은 값의 " +
      "초 단위다 — 길이를 비교할 때는 뒤쪽을 쓴다. " +
      "**GPS 좌표와 촬영자 이름은 담지 않는다.** 촬영 정보를 물었을 뿐인데 위치가 " +
      "대화에 올라가면 안 되기 때문이다. 좌표가 있는지만 hasLocation 으로 알린다. " +
      "**아는 것만 낸다** — XMP 전체는 Camera Raw 설정과 편집 이력까지 담아 수십 KB 라 " +
      "그대로 주면 토큰만 먹는다. xmpBytes 가 얼마나 더 있는지 말한다. " +
      "**없으면 지어내지 않고 null 이다.** 새로 만든 문서나 촬영 정보가 지워진 파일은 " +
      "대부분의 칸이 null 이다. " +
      "Photoshop 25.0 이상이 필요하다 — UXP XMP 모듈을 쓴다. " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: MetadataGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<MetadataInfo>(
        { type: METADATA_GET, params: input },
        { requestId: context.requestId },
      ),
  };
}
