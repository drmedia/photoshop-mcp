# @photoshop-mcp/extension-sdk

Extension 이 Core 를 사용하기 위한 공개 API 표면입니다.

허용되는 의존 방향은 한 방향뿐입니다.

```text
extensions  →  extension-sdk  →  Core public API
```

Core 패키지는 Extension 을 참조하지 않습니다.

## 노출하는 것

| 구분          | 내용                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| Extension 계약 | `PhotoshopMcpExtension`, `ExtensionContext`, `ExtensionManifest(Schema)`, `Permission` |
| Tool 계약      | `ToolDefinition`, `ToolHandler`, `ToolContext`                                         |
| 도메인 타입    | `DocumentInfo`, `LayerInfo`, `LayerType`, `BlendMode`, `PhotoshopCommand`              |
| 오류           | `PhotoshopMcpError`, `ErrorCode`, `isPhotoshopMcpError`                                |
| Command 이름   | `DOCUMENT_GET`, `LAYER_LIST`, `LAYER_CREATE` … Core Command 상수                       |

## 노출하지 않는 것

Extension 이 Core 의 **구성**을 바꿀 수 없도록 의도적으로 뺐습니다.

- `PhotoshopBridge` — Extension 은 Photoshop 에 직접 닿지 않습니다. Command 를 통해서만 접근합니다.
- `CommandRegistry` / `CommandEngine` 클래스 — Command 를 등록하거나 대체할 수 없습니다.
- Command 핸들러 구현 (`layerListCommand` 등) — 호출할 수는 있어도 바꿀 수는 없습니다.
- `ToolRegistry` 클래스 — `context.tools` 로 `register` · `has` 만 받습니다.
- `mcp-core` 의 서버 구현 — Extension 은 서버를 기동하지 않습니다.

이 제약은 ARCHITECTURE §17 · §23 을 따릅니다. Extension 은 Core Command 를 우회할 수 없고,
batchPlay descriptor 나 JavaScript 를 Photoshop 으로 보낼 수 없습니다.

## Extension 작성

`extension.json`:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "0.1.0",
  "namespace": "myext",
  "main": "dist/index.js",
  "permissions": ["photoshop.read"]
}
```

`src/index.ts`:

```typescript
import { DOCUMENT_GET, type DocumentInfo, type ExtensionContext } from "@photoshop-mcp/extension-sdk";
import { z } from "zod";

export function activate(context: ExtensionContext): void {
  context.tools.register({
    // 반드시 `<namespace>.` 로 시작해야 합니다. 어기면 적재가 거부됩니다.
    name: "myext.document_name",
    description: "현재 문서 이름을 반환합니다.",
    inputSchema: z.object({}).strict(),
    handler: async (_input, toolContext) => {
      const document = await context.commands.execute<DocumentInfo>(
        { type: DOCUMENT_GET, params: {} },
        { requestId: toolContext.requestId },
      );
      return { name: document.name };
    },
  });
}

export function deactivate(): void {
  // 등록한 Tool 은 Extension Manager 가 되돌립니다.
  // 타이머 · 소켓처럼 Manager 가 모르는 자원만 여기서 정리합니다.
}
```

`activate` 는 named export 와 default export 둘 다 받습니다.

동작하는 전체 예제는 [`extensions/example-extension`](../../extensions/example-extension) 을 보세요.

## 적재

서버는 기동할 때 `extensions/` 를 한 단계 훑어 `<name>/extension.json` 을 찾습니다.
`PHOTOSHOP_MCP_EXTENSIONS` 로 다른 디렉터리를 지정할 수 있습니다.

디렉터리가 없어도 오류가 아닙니다. 하나가 잘못되어도 나머지 Extension 과 서버는 계속 기동합니다.

## 아직 없는 것

- Permission 강제 — manifest 의 `permissions` 는 **선언만 받습니다.** Phase 9 범위입니다.
- `ResourceRegistry` — Phase 12
- `CapabilityRegistry` — Phase 8
- Hot reload — 서버 재시작 없이 다시 적재하는 기능은 없습니다.
