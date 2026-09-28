import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `IMAGE_RESIZE` — 이미지 크기를 바꾼다. (CORE_API §5 P1)
 *
 * **`document.crop` 과 다르다.** `crop` 은 캔버스만 줄이고 픽셀을 레이어에
 * 남기므로 `edit` 이다. 이쪽은 픽셀을 다시 표본화하고, 줄이면 버려진 해상도가
 * 문서 어디에도 남지 않는다 — 그래서 `destructive` 다.
 */

export const IMAGE_RESIZE = "IMAGE_RESIZE";

/** `constants.ResampleMethod` 에 있는 것만. `NONE` 은 Adobe 가 미지원이라 뺐다. */
export const ResampleNameSchema = z.enum([
  "automatic",
  "bicubic",
  "bicubicSharper",
  "bicubicSmoother",
  "bilinear",
  "nearestNeighbor",
  "preserveDetails",
  "deepUpscale",
]);

export const ImageResizeParamsSchema = z
  .object({
    /** 새 너비(픽셀). */
    width: z.number().int().positive().max(300000).optional(),
    /** 새 높이(픽셀). */
    height: z.number().int().positive().max(300000).optional(),
    /** ppi. */
    resolution: z.number().positive().max(10000).optional(),
    resample: ResampleNameSchema.optional(),
  })
  .strict()
  /* **아무것도 주지 않은 호출을 막는다.** 통과시키면 Photoshop 이 아무 일도
   * 안 하고 성공을 돌려주고, 호출자는 크기가 바뀐 줄 안다. 이 프로젝트의
   * "조용한 실패" 를 스키마에서 미리 끊는다. */
  .refine(
    (value) =>
      value.width !== undefined || value.height !== undefined || value.resolution !== undefined,
    { message: "width · height · resolution 중 최소 하나는 있어야 합니다." },
  );

export type ImageResizeParams = z.infer<typeof ImageResizeParamsSchema>;

const ImageSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
  /** 못 읽으면 `null`. */
  resolution: z.number().nullable(),
});

/**
 * **`before` 와 `after` 를 함께 준다.**
 *
 * 한쪽만 주면 비율이 유지되는지 Adobe 레퍼런스가 말하지 않는다. 짐작해 적는
 * 대신 바꾼 뒤 읽어서 실제 값을 돌려준다 — 호출자가 무엇이 일어났는지 스스로 본다.
 */
export const ImageResizeResultSchema = z.object({
  document: DocumentInfoSchema,
  before: ImageSizeSchema,
  after: ImageSizeSchema,
  /** 요청한 값이 실제로 들어갔는지. 요청하지 않은 것은 담기지 않는다. */
  applied: z.object({
    width: z.boolean().optional(),
    height: z.boolean().optional(),
    resolution: z.boolean().optional(),
  }),
});

export type ImageResizeResult = z.infer<typeof ImageResizeResultSchema>;

export const imageResizeCommand: CommandHandler<ImageResizeParams, ImageResizeResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ImageResizeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
