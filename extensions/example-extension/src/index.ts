import {
  DOCUMENT_GET,
  LAYER_LIST,
  type DocumentInfo,
  type ExtensionContext,
  type LayerInfo,
} from "@photoshop-mcp/extension-sdk";
import { z } from "zod";

/**
 * 예제 확장. (ROADMAP §9.4)
 *
 * Extension 이 할 수 있는 것과 할 수 없는 것을 한 곳에서 보여준다.
 *
 * - Tool 은 자신의 namespace(`example.*`)로만 등록할 수 있다.
 * - Photoshop 은 Core Command 를 통해서만 건드린다. Bridge 에 직접 닿지 않는다.
 * - batchPlay descriptor 나 JavaScript 를 Photoshop 으로 보낼 수 없다. (ARCHITECTURE §23)
 */

const HelloInput = z
  .object({
    /** 인사할 대상. 생략하면 "Photoshop". */
    name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const SummaryInput = z.object({}).strict();

export interface Summary {
  document: string;
  layerCount: number;
  /** 보이는 레이어 이름. 위에서부터. */
  visibleLayers: string[];
}

let deactivated = false;

export function activate(context: ExtensionContext): void {
  const { logger, commands, tools, manifest } = context;

  tools.register({
    name: "example.hello",
    description: "예제 확장이 살아 있는지 확인합니다. Photoshop 연결이 없어도 동작합니다.",
    inputSchema: HelloInput,
    handler: (input) => {
      const target = input.name ?? "Photoshop";
      return Promise.resolve({
        message: `안녕하세요, ${target}!`,
        extension: manifest.id,
        version: manifest.version,
      });
    },
  });

  tools.register({
    name: "example.document_summary",
    description:
      "현재 문서와 레이어를 요약합니다. Core Command 두 개를 조합하는 예입니다. " +
      "열린 문서가 없으면 오류를 반환합니다.",
    inputSchema: SummaryInput,
    handler: async (_input, toolContext): Promise<Summary> => {
      // Extension 은 MCP Tool 을 다시 호출하지 않고 Command 를 직접 실행한다.
      // requestId 를 넘겨야 Tool 호출부터 Bridge 까지 추적이 이어진다. (ARCHITECTURE §31)
      const options = { requestId: toolContext.requestId };

      const document = await commands.execute<DocumentInfo>(
        { type: DOCUMENT_GET, params: {} },
        options,
      );
      // Command 의 결과 모양은 Tool 의 결과 모양과 다르다.
      // `photoshop.layer.list` Tool 은 `{ layers }` 로 감싸지만 Command 는 배열을 그대로 준다.
      const layers = await commands.execute<LayerInfo[]>({ type: LAYER_LIST, params: {} }, options);

      return {
        document: document.name,
        layerCount: layers.length,
        visibleLayers: layers.filter((layer) => layer.visible).map((layer) => layer.name),
      };
    },
  });

  deactivated = false;
  logger.info(`${manifest.name} 활성화됨 — Tool 2개 등록`);
}

export function deactivate(): void {
  // 등록한 Tool 은 Extension Manager 가 되돌린다.
  // 여기서는 타이머 · 소켓처럼 Manager 가 모르는 자원을 정리한다.
  deactivated = true;
}

/** 테스트용. deactivate 가 실제로 호출되었는지 확인한다. */
export function isDeactivated(): boolean {
  return deactivated;
}
