import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { ZodType } from "zod";
import { ZodError } from "zod";

/**
 * Command 파라미터 검증. (ROADMAP §5.4)
 *
 * Tool 계층에도 입력 검증이 있지만, Extension 은 MCP Tool 을 거치지 않고
 * Command Engine 을 직접 호출한다. (ARCHITECTURE §3.2)
 * 그러므로 Command 계층에서도 검증해야 잘못된 파라미터가 Photoshop 까지 가지 않는다.
 *
 * @throws {PhotoshopMcpError} 스키마 불일치 시 `INVALID_PARAMETER`.
 */
export function validateParams<TParams>(
  type: string,
  schema: ZodType<TParams>,
  params: unknown,
): TParams {
  try {
    return schema.parse(params ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `Command 파라미터가 올바르지 않습니다: ${type}`,
        { details: { type, issues: error.issues }, cause: error },
      );
    }
    throw PhotoshopMcpError.from(error, ErrorCode.INVALID_PARAMETER);
  }
}
