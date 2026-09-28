import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `CANVAS_RESIZE` — 캔버스 크기를 바꾼다. (CORE_API §5 P2)
 *
 * **`image.resize` 와 다르다.** 그쪽은 픽셀을 다시 표본화해 그림이 통째로
 * 커지거나 작아진다. 이쪽은 그림은 그대로 두고 종이 크기만 바꾼다.
 */

export const CANVAS_RESIZE = "CANVAS_RESIZE";

/** `constants.AnchorPosition` 의 아홉 가지. */
export const AnchorNameSchema = z.enum([
  "topLeft",
  "topCenter",
  "topRight",
  "middleLeft",
  "middleCenter",
  "middleRight",
  "bottomLeft",
  "bottomCenter",
  "bottomRight",
]);

export const CanvasResizeParamsSchema = z
  .object({
    /** 새 너비(픽셀). **생략하면 지금 값 그대로다.** */
    width: z.number().int().positive().max(300000).optional(),
    /** 새 높이(픽셀). **생략하면 지금 값 그대로다.** */
    height: z.number().int().positive().max(300000).optional(),
    /** 기존 그림을 새 캔버스 어디에 둘지. 생략하면 Photoshop 기본값. */
    anchor: AnchorNameSchema.optional(),
  })
  .strict()
  /* 아무것도 주지 않으면 아무 일도 안 하고 성공을 돌려주게 된다.
   * 호출자는 크기가 바뀐 줄 안다 — `image.resize` 와 같은 자리다. */
  .refine((value) => value.width !== undefined || value.height !== undefined, {
    message: "width 와 height 중 최소 하나는 있어야 합니다.",
  });

export type CanvasResizeParams = z.infer<typeof CanvasResizeParamsSchema>;

const CanvasSizeSchema = z.object({ width: z.number(), height: z.number() });

export const CanvasResizeResultSchema = z.object({
  document: DocumentInfoSchema,
  before: CanvasSizeSchema,
  after: CanvasSizeSchema,
  /** 요청한 값이 실제로 들어갔는지. 요청하지 않은 것은 담기지 않는다. */
  applied: z.object({ width: z.boolean().optional(), height: z.boolean().optional() }),
  /** 실제로 쓴 기준점. 생략하면 Photoshop 기본값이라 `null` 이다. */
  anchor: AnchorNameSchema.nullable(),
});

export type CanvasResizeResult = z.infer<typeof CanvasResizeResultSchema>;

export const canvasResizeCommand: CommandHandler<CanvasResizeParams, CanvasResizeResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = CanvasResizeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
