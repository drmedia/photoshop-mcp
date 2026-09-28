import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_MERGE_VISIBLE` — 보이는 레이어를 하나로 합친다. (CORE_API §5)
 *
 * **`layer.stamp_visible` · `document.flatten` 과 셋이 다르다.** 이쪽은
 * 원본이 사라지고(`stamp_visible` 과 다름) 숨긴 레이어는 남는다(`flatten` 과 다름).
 */

export const DOCUMENT_MERGE_VISIBLE = "DOCUMENT_MERGE_VISIBLE";

export const DocumentMergeVisibleParamsSchema = z.object({}).strict();

export type DocumentMergeVisibleParams = z.infer<typeof DocumentMergeVisibleParamsSchema>;

const LayerCountsSchema = z.object({
  total: z.number(),
  visible: z.number(),
  hidden: z.number(),
});

export const MergeVisibleResultSchema = z.object({
  /** 병합 뒤 활성 레이어. **읽은 값이지 "이것이 결과다" 라는 주장이 아니다.** */
  activeLayer: LayerInfoSchema.nullable(),
  before: LayerCountsSchema,
  after: LayerCountsSchema,
  /** 사라진 레이어 수. */
  removed: z.number(),
});

export type MergeVisibleResult = z.infer<typeof MergeVisibleResultSchema>;

export const documentMergeVisibleCommand: CommandHandler<
  DocumentMergeVisibleParams,
  MergeVisibleResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = MergeVisibleResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
