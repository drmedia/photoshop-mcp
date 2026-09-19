import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 문서 자르기. (ROADMAP §17.12)
 *
 * ## 왜 필요했나
 *
 * 실기 보정에서 가장 큰 문제가 **아웃포커스 전경이 피사체를 덮는 것**이었는데,
 * 조정 레이어로는 손댈 수 없었다. 구도를 바꾸는 일은 톤·색과 다른 종류다.
 *
 * ## **픽셀을 버리지 않는다**
 *
 * batchPlay 에 `delete: false` 를 명시한다. 캔버스 경계만 줄이고 바깥 픽셀은
 * 레이어에 남는다. 그래서 `edit` 이다 — 되돌릴 수 있고 잃는 것이 없다.
 *
 * 버리는 자르기를 옵션으로 두지 않았다. 파라미터 하나로 permission 이 `edit` 에서
 * `destructive` 로 올라가면 정적 선언이 거짓이 된다. 이 프로젝트에서 Permission 을
 * 필수 정적 필드로 둔 이유가 그것이다. 정말 버려야 하면 export 나 flatten 이 한다.
 *
 * 대신 파일 크기는 줄지 않는다. 그 사실을 결과에 담아 알린다.
 */

export const DOCUMENT_CROP = "DOCUMENT_CROP";

const CropBoundsSchema = z
  .object({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    right: z.number().int().min(1),
    bottom: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    // 빈 사각형은 Photoshop 이 알 수 없는 오류로 거부한다. 여기서 이유를 말한다.
    if (value.right <= value.left) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "right 는 left 보다 커야 합니다.",
        path: ["right"],
      });
    }
    if (value.bottom <= value.top) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bottom 은 top 보다 커야 합니다.",
        path: ["bottom"],
      });
    }
  });

export const DocumentCropParamsSchema = z
  .object({
    /**
     * 남길 영역. 문서 픽셀 좌표이며 왼쪽 위가 (0, 0) 이다.
     *
     * 문서 밖으로 나가면 거부한다. 캔버스를 **넓히는** 것은 자르기가 아니다 —
     * 조용히 넓혀 주면 호출자는 잘린 줄 안다.
     */
    bounds: CropBoundsSchema,
  })
  .strict();

export type DocumentCropParams = z.infer<typeof DocumentCropParamsSchema>;

export const DocumentCropResultSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  /** 자르기 전 크기. 무엇이 얼마나 줄었는지 호출자가 알아야 한다. */
  previousWidth: z.number().int(),
  previousHeight: z.number().int(),
  /**
   * 캔버스 밖 픽셀이 남아 있는지. 항상 `true` 다.
   *
   * 값이 뻔해도 담는다 — 자르기를 되돌릴 수 있다는 사실과 파일이 작아지지 않는다는
   * 사실을 둘 다 여기서 읽을 수 있어야 한다.
   */
  pixelsRetained: z.boolean(),
});

export type DocumentCropResult = z.infer<typeof DocumentCropResultSchema>;

export const documentCropCommand: CommandHandler<DocumentCropParams, DocumentCropResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentCropResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "자르기 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
