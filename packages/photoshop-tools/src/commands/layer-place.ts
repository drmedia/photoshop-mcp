import type { CommandHandler } from "@photoshop-mcp/command-engine";
import {
  ErrorCode,
  FilenameSchema,
  LayerInfoSchema,
  PhotoshopMcpError,
  type LayerInfo,
} from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 파일을 레이어로 가져온다.
 *
 * Phase 8 에서 "내보내기 → 외부 처리" 까지는 이어졌지만 **돌아오는 길이 없었다.**
 * GraXpert 나 StarNet2 가 만든 결과를 Photoshop 으로 되돌릴 방법이 없으면
 * Capability 는 반쪽이다.
 *
 * 권한은 `external` 이다. 승인된 폴더 안이라 해도 Photoshop 밖의 파일을 읽는다.
 * `export` 가 쓰기로 경계를 넘듯 `place` 는 읽기로 넘는다.
 *
 * 스마트 오브젝트로 넣는다. 원본 픽셀을 덮어쓰지 않으므로 이 프로젝트의 비파괴
 * 원칙과 맞고, 나중에 다시 조정할 수 있다.
 *
 * 실기에서 확인한 동작:
 *
 * - 놓이는 위치는 **활성 레이어 바로 위**다. 문서 맨 위가 아니다.
 * - 활성 레이어가 그룹 안이면 같은 그룹으로 들어간다.
 * - 활성 레이어의 **opacity 를 물려받는다.**
 *
 * 셋 다 처음 구현할 때 다르게 가정했던 것이다. Mock 만 보고 만들었으면
 * 조용히 어긋난 채로 남았다.
 */

export const LAYER_PLACE = "LAYER_PLACE";

export const LayerPlaceParamsSchema = z
  .object({
    /** 승인된 작업 폴더 안의 파일 이름. 경로를 쓸 수 없다. */
    filename: FilenameSchema,
    /** 만들어질 레이어 이름. 생략하면 파일 이름을 쓴다. */
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type LayerPlaceParams = z.infer<typeof LayerPlaceParamsSchema>;

export const layerPlaceCommand: CommandHandler<LayerPlaceParams, LayerInfo> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerInfoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 레이어 스키마를 만족하지 않습니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
