import type { ProviderAvailability, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { CapabilityIdSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 8 Capability Tool. (ROADMAP §12)
 *
 * **조회만 노출한다.** 실행 Tool 을 만들지 않는 것은 의도다.
 *
 * Capability 실행은 "파일을 내보내고 → 외부 처리기를 돌리고 → 되돌려 놓는" 흐름의
 * 가운데 토막이다. 그 흐름을 아는 것은 Extension 이고(ARCHITECTURE §1),
 * LLM 이 토막을 직접 부르면 앞뒤가 빠진 채로 실행된다.
 *
 * 그래서 실행은 `ExtensionContext.capabilities` 로만 한다.
 * LLM 은 무엇이 있는지 볼 수 있을 뿐이다.
 */

/** 조회 대상 Capability. 생략하면 전부. */
export const CapabilityListInputSchema = z
  .object({
    capability: CapabilityIdSchema.optional(),
  })
  .strict();

export type CapabilityListInput = z.infer<typeof CapabilityListInputSchema>;

export interface CapabilityListResult {
  /** 등록된 Provider 가 있는 Capability 이름. */
  capabilities: string[];
  /** Provider 별 상태. 사용할 수 없으면 이유가 담긴다. */
  providers: ProviderAvailability[];
}

/** 실행 파일 존재까지 확인하는 조회기. */
export interface CapabilityLister {
  list(): string[];
  describeAsync(capability?: string): Promise<ProviderAvailability[]>;
}

/** `photoshop.capability.list` — 외부 처리기 목록과 사용 가능 여부. */
export function createCapabilityListTool(
  registry: CapabilityLister,
): ToolDefinition<CapabilityListInput, CapabilityListResult> {
  return {
    name: "photoshop.capability.list",
    description:
      "설정된 외부 처리기(GraXpert · StarNet2 등)와 사용 가능 여부를 반환한다. " +
      "사용할 수 없으면 이유를 함께 준다. " +
      "실행은 이 Tool 로 하지 않는다 — Extension 이 전체 흐름의 일부로 호출한다.",
    permission: "read",
    inputSchema: CapabilityListInputSchema,
    handler: async (input) => ({
      capabilities: registry.list(),
      providers: await registry.describeAsync(input.capability),
    }),
  };
}
