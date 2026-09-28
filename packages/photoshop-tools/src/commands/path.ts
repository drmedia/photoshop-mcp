import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 패스. (ROADMAP §58)
 *
 * **전부 DOM 이다** — `document.pathItems`(23.3+) 와 `PathItem` 클래스로 다
 * 된다. batchPlay 를 쓰지 않는다.
 *
 * `create` 는 **선택 영역에서** 만든다. `pathItems.add` 는 베지어 기하를
 * 요구하고 `SubPathInfo` 의 인터페이스 문서가 없다.
 */

export const PATH_LIST = "PATH_LIST";
export const PATH_GET = "PATH_GET";
export const PATH_CREATE = "PATH_CREATE";
export const PATH_SELECT = "PATH_SELECT";
export const PATH_TO_SELECTION = "PATH_TO_SELECTION";
export const PATH_FILL = "PATH_FILL";
export const PATH_STROKE = "PATH_STROKE";
export const PATH_DELETE = "PATH_DELETE";

const PathName = z.string().trim().min(1).max(255);

export const PathInfoSchema = z.object({
  index: z.number().int(),
  id: z.number().nullable(),
  name: z.string(),
  /** `PathKind`. 못 읽으면 `null` 이고 `rawKind` 에 원본이 있다. */
  kind: z.string().nullable(),
  rawKind: z.string().optional(),
  /** 하위 패스 개수. 못 읽으면 `null`. */
  subPathCount: z.number().nullable(),
});

export const PathListResultSchema = z.object({ paths: z.array(PathInfoSchema) });
export const PathToSelectionResultSchema = z.object({
  path: PathInfoSchema,
  hasSelection: z.boolean(),
});
export const PathDeleteResultSchema = z.object({
  deleted: z.string(),
  remaining: z.number().int(),
});

export type PathInfo = z.infer<typeof PathInfoSchema>;
export type PathListResult = z.infer<typeof PathListResultSchema>;
export type PathToSelectionResult = z.infer<typeof PathToSelectionResultSchema>;
export type PathDeleteResult = z.infer<typeof PathDeleteResultSchema>;

export const PathListParamsSchema = z.object({}).strict();

/**
 * 이름 **또는** 색인.
 *
 * **이름이 유일하지 않다** — `getByName` 이 "the **first** PathItem matching"
 * 이라고 적혀 있다. 여럿이면 거절하고 색인을 쓰라고 말한다. (§57 과 같다)
 */
const TargetShape = {
  name: PathName.optional(),
  index: z.number().int().min(0).max(999).optional(),
};
const requireOneTarget = (value: { name?: string; index?: number }): boolean =>
  (value.name === undefined) !== (value.index === undefined);
const targetMessage = { message: "name 과 index 중 정확히 하나를 줍니다." };

export const PathGetParamsSchema = z
  .object(TargetShape)
  .strict()
  .refine(requireOneTarget, targetMessage);
export const PathDeleteParamsSchema = PathGetParamsSchema;

export const PathCreateParamsSchema = z
  .object({
    /** 만든 패스의 이름. 주면 작업 패스가 저장된 패스가 된다. */
    name: PathName.optional(),
    /**
     * 곡선 단순화 정도. 작을수록 선택에 가깝고 점이 많다.
     *
     * 레퍼런스 기본값은 2 다. Photoshop 대화상자 범위는 0.5 ~ 10.
     */
    tolerance: z.number().min(0.5).max(10).optional(),
  })
  .strict();

export const PathSelectParamsSchema = z
  .object({
    ...TargetShape,
    /** `false` 를 주면 선택을 해제한다. 기본은 선택이다. */
    selected: z.boolean().optional(),
  })
  .strict()
  .refine(requireOneTarget, targetMessage);

export const PathToSelectionParamsSchema = z
  .object({
    ...TargetShape,
    feather: z.number().min(0).max(1000).optional(),
    antiAlias: z.boolean().optional(),
    /** 기존 선택과 어떻게 합칠지. `selection.polygon` 과 같은 이름이다. */
    mode: z.enum(["replace", "add", "subtract", "intersect"]).optional(),
  })
  .strict()
  .refine(requireOneTarget, targetMessage);

export const PathFillParamsSchema = z
  .object({
    ...TargetShape,
    color: z
      .object({
        red: z.number().int().min(0).max(255),
        green: z.number().int().min(0).max(255),
        blue: z.number().int().min(0).max(255),
      })
      .strict(),
    opacity: z.number().min(0).max(100).optional(),
    feather: z.number().min(0).max(1000).optional(),
    antiAlias: z.boolean().optional(),
    /** `false` 면 선택된 하위 패스만 채운다. */
    wholePath: z.boolean().optional(),
    /** 투명 영역을 보호한다. */
    preserveTransparency: z.boolean().optional(),
  })
  .strict()
  .refine(requireOneTarget, targetMessage);

/** `constants.ToolType` 열여섯. */
export const PathStrokeToolSchema = z.enum([
  "brush",
  "pencil",
  "eraser",
  "cloneStamp",
  "healingBrush",
  "historyBrush",
  "artHistoryBrush",
  "patternStamp",
  "backgroundEraser",
  "blur",
  "sharpen",
  "smudge",
  "dodge",
  "burn",
  "sponge",
  "colorReplacement",
]);

export const PathStrokeParamsSchema = z
  .object({
    ...TargetShape,
    /** 기본은 `brush`. **굵기와 색은 그 도구의 현재 설정을 따른다.** */
    tool: PathStrokeToolSchema.optional(),
    simulatePressure: z.boolean().optional(),
  })
  .strict()
  .refine(requireOneTarget, targetMessage);

export type PathListParams = z.infer<typeof PathListParamsSchema>;
export type PathGetParams = z.infer<typeof PathGetParamsSchema>;
export type PathCreateParams = z.infer<typeof PathCreateParamsSchema>;
export type PathSelectParams = z.infer<typeof PathSelectParamsSchema>;
export type PathToSelectionParams = z.infer<typeof PathToSelectionParamsSchema>;
export type PathFillParams = z.infer<typeof PathFillParamsSchema>;
export type PathStrokeParams = z.infer<typeof PathStrokeParamsSchema>;
export type PathDeleteParams = z.infer<typeof PathDeleteParamsSchema>;

function forward<TParams, TResult>(
  schema: z.ZodType<TResult>,
  label: string,
): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues, received: raw },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const pathListCommand = forward<PathListParams, PathListResult>(
  PathListResultSchema,
  "패스 목록",
);
export const pathGetCommand = forward<PathGetParams, PathInfo>(PathInfoSchema, "패스 조회");
export const pathCreateCommand = forward<PathCreateParams, PathInfo>(PathInfoSchema, "패스 만들기");
export const pathSelectCommand = forward<PathSelectParams, PathInfo>(PathInfoSchema, "패스 선택");
export const pathToSelectionCommand = forward<PathToSelectionParams, PathToSelectionResult>(
  PathToSelectionResultSchema,
  "패스를 선택 영역으로",
);
export const pathFillCommand = forward<PathFillParams, PathInfo>(PathInfoSchema, "패스 채우기");
export const pathStrokeCommand = forward<PathStrokeParams, PathInfo>(PathInfoSchema, "패스 긋기");
export const pathDeleteCommand = forward<PathDeleteParams, PathDeleteResult>(
  PathDeleteResultSchema,
  "패스 삭제",
);
