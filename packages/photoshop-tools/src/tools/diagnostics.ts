import type {
  PermissionLevel,
  ProviderAvailability,
  ToolDefinition,
  WorkflowDefinition,
} from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 진단. (ROADMAP §17)
 *
 * 무엇이 왜 안 되는지 한 번에 보여준다.
 *
 * 이 Tool 이 없던 동안 상태를 보려면 매번 임시 스크립트를 짜야 했다. Bridge 연결은
 * `ping`, 작업 폴더는 `workspace.status`, 외부 처리기는 `capability.list`, Extension 은
 * 서버 로그를 따로 봐야 했고, 무엇이 막혀 있는지는 합쳐 보고 나서야 알 수 있었다.
 *
 * **막힌 이유를 함께 준다.** 상태만 나열하면 사용자가 스스로 조합해야 한다.
 */

export const DiagnosticsInputSchema = z.object({}).strict();
export type DiagnosticsInput = z.infer<typeof DiagnosticsInputSchema>;

/** 진단에 필요한 것들. 조립 시점에 주입한다. */
export interface DiagnosticsSource {
  bridgeConnected(): boolean;
  bridgeState(): string;
  allowedPermissions(): PermissionLevel[];
  toolCount(): number;
  commandCount(): number;
  providers(): Promise<ProviderAvailability[]>;
  workflows(): WorkflowDefinition[];
  extensions(): { namespace: string; name: string; tools: string[] }[];
  jobCounts(): Record<string, number>;
  eventCount(): number;
}

/**
 * 지금 막혀 있는 것과 고치는 방법.
 *
 * 기계가 읽을 상태만 주면 사용자는 여전히 무엇을 해야 할지 모른다.
 */
function blockers(input: {
  connected: boolean;
  allowed: PermissionLevel[];
  providers: ProviderAvailability[];
  extensions: unknown[];
}): string[] {
  const reasons: string[] = [];

  if (!input.connected) {
    reasons.push(
      "Photoshop 이 연결되지 않았습니다. Photoshop 을 켜고 UXP Developer Tool 에서 " +
        "플러그인을 Load 하세요. 재연결은 지수 백오프라 30초쯤 걸릴 수 있습니다.",
    );
  }

  if (!input.allowed.includes("external")) {
    reasons.push(
      "external 권한이 없어 파일 저장·외부 처리기·가져오기를 쓸 수 없습니다. " +
        "PHOTOSHOP_MCP_ALLOW 에 external 을 넣으세요.",
    );
  }
  if (!input.allowed.includes("destructive")) {
    reasons.push(
      "destructive 권한이 없어 원본 덮어쓰기와 파일 삭제를 쓸 수 없습니다. " +
        "필요하면 PHOTOSHOP_MCP_ALLOW 에 destructive 를 넣으세요.",
    );
  }

  const broken = input.providers.filter((provider) => !provider.available);
  for (const provider of broken) {
    reasons.push(
      `외부 처리기 '${provider.id}' 를 쓸 수 없습니다: ${provider.reason ?? "원인 불명"}`,
    );
  }
  if (input.providers.length === 0) {
    reasons.push(
      "외부 처리기가 설정되지 않았습니다. capabilities.example.json 을 " +
        "capabilities.json 으로 복사하고 실행 파일 경로를 고치세요.",
    );
  }

  return reasons;
}

/** `photoshop.diagnostics` — 지금 무엇이 되고 무엇이 막혀 있는지. */
export function createDiagnosticsTool(
  source: DiagnosticsSource,
): ToolDefinition<DiagnosticsInput, unknown> {
  return {
    name: "photoshop.diagnostics",
    description:
      "서버 상태를 한 번에 보고한다 — Bridge 연결, 권한, 외부 처리기, Extension, " +
      "워크플로, Job, 이벤트. **막혀 있는 것은 이유와 고치는 방법을 함께 준다.** " +
      "무언가 안 될 때 가장 먼저 부른다.",
    permission: "read",
    inputSchema: DiagnosticsInputSchema,
    handler: async () => {
      const providers = await source.providers();
      const extensions = source.extensions();
      const allowed = source.allowedPermissions();
      const connected = source.bridgeConnected();

      return {
        bridge: { connected, state: source.bridgeState() },
        permissions: { allowed },
        registry: { tools: source.toolCount(), commands: source.commandCount() },
        capabilities: providers.map((provider) => ({
          id: provider.id,
          capability: provider.capability,
          available: provider.available,
          reason: provider.reason,
        })),
        extensions,
        workflows: source.workflows().map((workflow) => ({
          id: workflow.id,
          steps: workflow.steps.length,
        })),
        jobs: source.jobCounts(),
        events: { recorded: source.eventCount() },
        blocked: blockers({ connected, allowed, providers, extensions }),
      };
    },
  };
}
