# @photoshop-mcp/photoshop-tools

Photoshop Core 의 MCP Tool 과 내부 Command 정의.

Phase 1 범위 (ROADMAP §5.3, §5.6):

| MCP Tool                 | Command        | Bridge 호출         |
| ------------------------ | -------------- | ------------------- |
| `photoshop.ping`         | `PING`         | `isConnected()`     |
| `photoshop.document.get` | `DOCUMENT_GET` | `getDocumentInfo()` |
| `photoshop.layer.list`   | `LAYER_LIST`   | `getLayers()`       |

Tool 핸들러는 Bridge 를 직접 호출하지 않고 반드시 Command Engine 을 거칩니다. (ARCHITECTURE §34)

의존은 `command-engine` 과 `photoshop-bridge` contracts 뿐입니다. `mcp-core` 를 참조하지 않습니다 —
의존 방향이 `mcp-core → photoshop-tools` 이기 때문입니다.

- `registerPhotoshopCommands(registry)` — Command 일괄 등록
- `registerPhotoshopTools(registry, engine)` — Tool 일괄 등록

`masks/` `selections/` `adjustments/` `filters/` 는 Phase 3~4 범위이므로 아직 만들지 않았습니다.
