# @photoshop-mcp/extension-sdk

Extension 이 Core 를 사용하기 위한 공개 API 표면입니다.

허용되는 의존 방향은 한 방향뿐입니다.

```text
extensions  →  extension-sdk  →  Core public API
```

Core 패키지는 Extension 을 참조하지 않습니다.

노출 범위는 `command-engine` 과 `photoshop-bridge` contracts 입니다.
MCP 서버 구현(`mcp-core`)은 노출하지 않습니다 — Extension 은 Tool 을 등록하고 Command Engine 을
호출할 뿐, 서버를 직접 기동하지 않습니다.

## Phase 1 범위

Core 타입 재노출만 제공합니다. 다음은 **Phase 5** 범위이며 아직 없습니다.

- `ExtensionManifest` / `extension.json`
- `ExtensionManager` (discover / load / activate / deactivate)
- `ExtensionContext`
- namespace 검증 (`photoshop.*` 사용 금지 규칙)
- Permission 모델
- `ResourceRegistry`, `CapabilityRegistry`

이 타입들은 대응하는 런타임 구현이 생길 때 함께 추가합니다.
