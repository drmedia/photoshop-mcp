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
/**
 * 지금 막혀 있는 것과 고치는 방법.
 *
 * **`photoshop.diagnostics` 와 CLI `doctor` 가 이 하나를 같이 쓴다.** 판정을
 * 두 벌 만들면 둘이 다른 말을 하게 되고, 그때 어느 쪽을 믿어야 할지 알 수 없다.
 */
export interface Blocker {
  /** 기계가 가리는 이름. */
  code: string;
  /** 로그 한 줄에 여러 개를 나열할 때 쓰는 짧은 이름. */
  label: string;
  /** 무엇이 막혔고 어떻게 고치는지. */
  detail: string;
}

/**
 * 막힌 것들을 구조화해서 돌려준다.
 *
 * {@link describeBlockers} 가 여기서 `detail` 만 뽑는다. **판정은 한 곳에만
 * 둔다** — 짧은 이름과 긴 설명을 따로 만들면 둘이 어긋난다.
 */
export function listBlockers(input: {
  /**
   * Photoshop 연결 여부. **`null` 이면 아직 모른다** — 기동 직후가 그렇다.
   *
   * 그때 "연결되지 않았습니다" 를 내면 정상 기동마다 경고가 뜬다. Bridge 는
   * 서버가 뜬 뒤에 붙으므로 처음 몇 초는 반드시 끊긴 상태다.
   */
  connected: boolean | null;
  allowed: PermissionLevel[];
  providers: ProviderAvailability[];
  extensions: unknown[];
}): Blocker[] {
  const found: Blocker[] = [];

  if (input.connected === false) {
    found.push({
      code: "photoshop_disconnected",
      label: "Photoshop 연결 끊김",
      detail:
        "Photoshop 이 연결되지 않았습니다. Photoshop 을 켜고 UXP Developer Tool 에서 " +
        "플러그인을 Load 하세요. 재연결은 지수 백오프라 30초쯤 걸릴 수 있습니다.",
    });
  }

  if (!input.allowed.includes("external")) {
    found.push({
      code: "no_external",
      label: "external 권한",
      detail:
        "external 권한이 없어 파일 저장·외부 처리기·가져오기를 쓸 수 없습니다. " +
        "PHOTOSHOP_MCP_ALLOW 에 external 을 넣으세요.",
    });
  }
  if (!input.allowed.includes("destructive")) {
    found.push({
      code: "no_destructive",
      label: "destructive 권한",
      detail:
        "destructive 권한이 없어 원본 덮어쓰기와 파일 삭제를 쓸 수 없습니다. " +
        "필요하면 PHOTOSHOP_MCP_ALLOW 에 destructive 를 넣으세요.",
    });
  }

  for (const provider of input.providers.filter((candidate) => !candidate.available)) {
    found.push({
      code: "provider_unavailable",
      label: `외부 처리기 ${provider.id}`,
      detail: `외부 처리기 '${provider.id}' 를 쓸 수 없습니다: ${provider.reason ?? "원인 불명"}`,
    });
  }
  if (input.providers.length === 0) {
    found.push({
      code: "no_providers",
      label: "외부 처리기 미설정",
      detail:
        "외부 처리기가 설정되지 않았습니다. capabilities.example.json 을 " +
        "capabilities.json 으로 복사하고 실행 파일 경로를 고치세요.",
    });
  }

  return found;
}

/** 막힌 것들을 사람이 읽는 문장으로. `photoshop.diagnostics` 의 `blocked` 다. */
export function describeBlockers(input: Parameters<typeof listBlockers>[0]): string[] {
  return listBlockers(input).map((blocker) => blocker.detail);
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
        blocked: describeBlockers({ connected, allowed, providers, extensions }),
      };
    },
  };
}
